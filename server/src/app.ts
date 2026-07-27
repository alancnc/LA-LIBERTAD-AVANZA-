import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { publish, subscribe } from './events.js';
import { Service, ServiceError } from './service.js';
import { Store } from './store.js';
import type { ClusterStatus } from './types.js';

const VALID_STATUSES: ClusterStatus[] = ['pending', 'answering', 'answered', 'discarded'];

export interface AppOptions {
  /** Ruta del JSON de datos, o null para trabajar sólo en memoria. */
  dataFile?: string | null;
  /** Carpeta con el build del cliente, si se quiere servir desde el mismo proceso. */
  clientDir?: string | null;
}

export function createApp(options: AppOptions = {}) {
  const store = new Store(options.dataFile ?? null);
  const service = new Service(store);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));

  const api = express.Router();

  /** Identidad anónima del visitante: la genera el cliente y viaja en cada request. */
  function viewerId(req: Request): string {
    const fromHeader = req.header('x-viewer-id');
    const fromQuery = typeof req.query.viewerId === 'string' ? req.query.viewerId : '';
    const fromBody =
      typeof req.body === 'object' && req.body !== null && 'voterId' in req.body
        ? String((req.body as { voterId?: unknown }).voterId ?? '')
        : '';
    return (fromHeader ?? '') || fromQuery || fromBody;
  }

  function adminKey(req: Request): string | undefined {
    const fromHeader = req.header('x-admin-key');
    if (fromHeader) return fromHeader;
    return typeof req.query.adminKey === 'string' ? req.query.adminKey : undefined;
  }

  // ------------------------------------------------------------ salas

  api.post('/rooms', (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title : '';
    const { room, adminKey: key } = service.createRoom(title);
    res.status(201).json({
      code: room.code,
      title: room.title,
      adminKey: key,
      threshold: room.threshold,
      createdAt: room.createdAt,
    });
  });

  api.get('/rooms/:code', (req, res) => {
    const room = service.getRoomByCode(req.params.code);
    res.json({
      code: room.code,
      title: room.title,
      closed: room.closed,
      createdAt: room.createdAt,
    });
  });

  api.patch('/rooms/:code', (req, res) => {
    const room = service.requireAdmin(req.params.code, adminKey(req));
    const updated = service.updateRoom(room, {
      title: typeof req.body?.title === 'string' ? req.body.title : undefined,
      closed: typeof req.body?.closed === 'boolean' ? req.body.closed : undefined,
      threshold: typeof req.body?.threshold === 'number' ? req.body.threshold : undefined,
    });
    publish(room.id, 'room');
    res.json({
      code: updated.code,
      title: updated.title,
      closed: updated.closed,
      threshold: updated.threshold,
    });
  });

  /** Vista pública: el tablero tal como lo ven los alumnos. */
  api.get('/rooms/:code/board', (req, res) => {
    const room = service.getRoomByCode(req.params.code);
    res.json({
      room: { code: room.code, title: room.title, closed: room.closed },
      clusters: service.getBoard(room, viewerId(req)),
    });
  });

  /** Vista del docente: mismo tablero más métricas y configuración. */
  api.get('/rooms/:code/admin', (req, res) => {
    const room = service.requireAdmin(req.params.code, adminKey(req));
    res.json({
      room: {
        code: room.code,
        title: room.title,
        closed: room.closed,
        threshold: room.threshold,
      },
      stats: service.getStats(room),
      clusters: service.getBoard(room, viewerId(req)),
    });
  });

  /** Flujo de novedades de la sala (SSE). */
  api.get('/rooms/:code/stream', (req, res) => {
    const room = service.getRoomByCode(req.params.code);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write('event: ready\ndata: {}\n\n');

    const unsubscribe = subscribe(room.id, res);
    // Ping periódico para que proxies y balanceadores no corten la conexión.
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // -------------------------------------------------------- preguntas

  api.post('/rooms/:code/questions', (req, res) => {
    const room = service.getRoomByCode(req.params.code);
    const result = service.addQuestion(room, {
      text: typeof req.body?.text === 'string' ? req.body.text : '',
      author: typeof req.body?.author === 'string' ? req.body.author : '',
      voterId: viewerId(req),
    });

    publish(room.id, 'question');
    res.status(201).json({
      questionId: result.question.id,
      clusterId: result.cluster.id,
      isNewCluster: result.isNewCluster,
      // Cuánto se pareció a un tema ya existente: el cliente lo usa para
      // avisar "tu pregunta se sumó a un tema que ya estaba".
      similarity: Number(result.score.toFixed(3)),
      clusterLabel: result.cluster.label,
    });
  });

  api.post('/rooms/:code/questions/:questionId/vote', (req, res) => {
    const room = service.getRoomByCode(req.params.code);
    const result = service.toggleUpvote(room, req.params.questionId, viewerId(req));
    publish(room.id, 'vote');
    res.json(result);
  });

  api.post('/rooms/:code/questions/:questionId/hide', (req, res) => {
    const room = service.requireAdmin(req.params.code, adminKey(req));
    service.hideQuestion(room, req.params.questionId);
    publish(room.id, 'question');
    res.json({ ok: true });
  });

  api.post('/rooms/:code/questions/:questionId/split', (req, res) => {
    const room = service.requireAdmin(req.params.code, adminKey(req));
    const cluster = service.splitQuestion(room, req.params.questionId);
    publish(room.id, 'cluster');
    res.json({ clusterId: cluster.id });
  });

  // ----------------------------------------------------------- grupos

  api.patch('/rooms/:code/clusters/:clusterId', (req, res) => {
    const room = service.requireAdmin(req.params.code, adminKey(req));

    const rawStatus = req.body?.status;
    if (rawStatus !== undefined && !VALID_STATUSES.includes(rawStatus as ClusterStatus)) {
      throw new ServiceError(400, `Estado inválido: ${String(rawStatus)}`);
    }

    const cluster = service.updateCluster(room, req.params.clusterId, {
      status: rawStatus as ClusterStatus | undefined,
      label: typeof req.body?.label === 'string' ? req.body.label : undefined,
      note: typeof req.body?.note === 'string' ? req.body.note : undefined,
    });
    publish(room.id, 'cluster');
    res.json({ id: cluster.id, status: cluster.status, label: cluster.label, note: cluster.note });
  });

  api.post('/rooms/:code/clusters/:clusterId/merge', (req, res) => {
    const room = service.requireAdmin(req.params.code, adminKey(req));
    const targetId = typeof req.body?.targetId === 'string' ? req.body.targetId : '';
    if (!targetId) throw new ServiceError(400, 'Falta el grupo destino');

    const cluster = service.mergeClusters(room, req.params.clusterId, targetId);
    publish(room.id, 'cluster');
    res.json({ id: cluster.id });
  });

  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', api);

  // Build del cliente servido por el mismo proceso en producción.
  const clientDir = options.clientDir ?? null;
  if (clientDir && fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    // Cualquier ruta que no sea de la API la resuelve el router del cliente.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ServiceError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('Error no controlado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return { app, service, store };
}
