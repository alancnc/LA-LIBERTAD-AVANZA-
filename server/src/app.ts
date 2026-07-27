import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { publish, subscribe } from './events.js';
import { Service, ServiceError } from './service.js';
import { JsonRepository } from './repository/memory.js';
import { PostgresRepository } from './repository/postgres.js';
import type { Repository } from './repository/types.js';
import type { ClusterStatus } from './types.js';

const VALID_STATUSES: ClusterStatus[] = ['pending', 'answering', 'answered', 'discarded'];

/**
 * Cómo se entera el cliente de que el tablero cambió.
 *
 * - `sse`: el servidor mantiene la conexión abierta y empuja los cambios.
 * - `poll`: el cliente pregunta cada pocos segundos. Es lo único viable en
 *   serverless, donde no hay proceso persistente que sostenga la conexión ni
 *   memoria compartida entre instancias para difundir el evento.
 */
export type RealtimeMode = 'sse' | 'poll';

export interface AppOptions {
  /** Repositorio ya construido. Tiene prioridad sobre el resto de las opciones. */
  repository?: Repository;
  /** Ruta del JSON de datos, o null para trabajar sólo en memoria. */
  dataFile?: string | null;
  /** Cadena de conexión a Postgres. Si está presente, se usa Postgres. */
  databaseUrl?: string | null;
  /** Carpeta con el build del cliente, si se quiere servir desde el mismo proceso. */
  clientDir?: string | null;
  realtime?: RealtimeMode;
}

/**
 * Envuelve un handler async para que los errores lleguen al middleware de error:
 * Express 4 no captura promesas rechazadas por su cuenta.
 */
function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/**
 * Lee un parámetro de ruta. Siempre está presente si la ruta hizo match; la
 * comprobación existe para satisfacer al compilador sin recurrir a un cast.
 */
function param(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined) throw new ServiceError(400, `Falta el parámetro ${name}`);
  return value;
}

export function createApp(options: AppOptions = {}) {
  const repository =
    options.repository ??
    (options.databaseUrl
      ? new PostgresRepository(options.databaseUrl)
      : new JsonRepository(options.dataFile ?? null));

  const realtime: RealtimeMode = options.realtime ?? (options.databaseUrl ? 'poll' : 'sse');
  const service = new Service(repository);

  // El esquema/archivo se prepara una sola vez y todas las peticiones esperan
  // esa misma promesa: en serverless cada instancia arranca en frío.
  const ready = repository.init();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));
  app.use((_req, _res, next) => {
    ready.then(() => next()).catch(next);
  });

  const api = express.Router();

  /** Identidad anónima del visitante: la genera el cliente y viaja en cada request. */
  function viewerId(req: Request): string {
    const fromHeader = req.header('x-viewer-id');
    const fromQuery = typeof req.query.viewerId === 'string' ? req.query.viewerId : '';
    return (fromHeader ?? '') || fromQuery;
  }

  function adminKey(req: Request): string | undefined {
    const fromHeader = req.header('x-admin-key');
    if (fromHeader) return fromHeader;
    return typeof req.query.adminKey === 'string' ? req.query.adminKey : undefined;
  }

  /** Sólo tiene efecto cuando hay un proceso persistente detrás. */
  function notify(roomId: string, event: string): void {
    if (realtime === 'sse') publish(roomId, event);
  }

  // ------------------------------------------------------------ salas

  api.get(
    '/config',
    route(async (_req, res) => {
      res.json({ realtime });
    }),
  );

  api.post(
    '/rooms',
    route(async (req, res) => {
      const title = typeof req.body?.title === 'string' ? req.body.title : '';
      const { room, adminKey: key } = await service.createRoom(title);
      res.status(201).json({
        code: room.code,
        title: room.title,
        adminKey: key,
        threshold: room.threshold,
        createdAt: room.createdAt,
      });
    }),
  );

  api.get(
    '/rooms/:code',
    route(async (req, res) => {
      const room = await service.getRoomByCode(param(req, 'code'));
      res.json({
        code: room.code,
        title: room.title,
        closed: room.closed,
        createdAt: room.createdAt,
      });
    }),
  );

  api.patch(
    '/rooms/:code',
    route(async (req, res) => {
      const room = await service.requireAdmin(param(req, 'code'), adminKey(req));
      const updated = await service.updateRoom(room, {
        title: typeof req.body?.title === 'string' ? req.body.title : undefined,
        closed: typeof req.body?.closed === 'boolean' ? req.body.closed : undefined,
        threshold: typeof req.body?.threshold === 'number' ? req.body.threshold : undefined,
      });
      notify(room.id, 'room');
      res.json({
        code: updated.code,
        title: updated.title,
        closed: updated.closed,
        threshold: updated.threshold,
      });
    }),
  );

  /** Vista pública: el tablero tal como lo ven los alumnos. */
  api.get(
    '/rooms/:code/board',
    route(async (req, res) => {
      const room = await service.getRoomByCode(param(req, 'code'));
      res.json({
        room: { code: room.code, title: room.title, closed: room.closed },
        clusters: await service.getBoard(room, viewerId(req)),
      });
    }),
  );

  /** Vista del docente: mismo tablero más métricas y configuración. */
  api.get(
    '/rooms/:code/admin',
    route(async (req, res) => {
      const room = await service.requireAdmin(param(req, 'code'), adminKey(req));
      res.json({
        room: {
          code: room.code,
          title: room.title,
          closed: room.closed,
          threshold: room.threshold,
        },
        stats: await service.getStats(room),
        clusters: await service.getBoard(room, viewerId(req)),
      });
    }),
  );

  /** Flujo de novedades de la sala (SSE). No disponible en modo `poll`. */
  api.get(
    '/rooms/:code/stream',
    route(async (req, res) => {
      if (realtime !== 'sse') {
        res.status(501).json({ error: 'Este despliegue usa sondeo, no SSE' });
        return;
      }
      const room = await service.getRoomByCode(param(req, 'code'));

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
    }),
  );

  // -------------------------------------------------------- preguntas

  api.post(
    '/rooms/:code/questions',
    route(async (req, res) => {
      const room = await service.getRoomByCode(param(req, 'code'));
      const result = await service.addQuestion(room, {
        text: typeof req.body?.text === 'string' ? req.body.text : '',
        author: typeof req.body?.author === 'string' ? req.body.author : '',
        voterId: viewerId(req),
      });

      notify(room.id, 'question');
      res.status(201).json({
        questionId: result.question.id,
        clusterId: result.cluster.id,
        isNewCluster: result.isNewCluster,
        // Cuánto se pareció a un tema ya existente: el cliente lo usa para
        // avisar "tu pregunta se sumó a un tema que ya estaba".
        similarity: Number(result.score.toFixed(3)),
        clusterLabel: result.cluster.label,
      });
    }),
  );

  api.post(
    '/rooms/:code/questions/:questionId/vote',
    route(async (req, res) => {
      const room = await service.getRoomByCode(param(req, 'code'));
      const result = await service.toggleUpvote(room, param(req, 'questionId'), viewerId(req));
      notify(room.id, 'vote');
      res.json(result);
    }),
  );

  api.post(
    '/rooms/:code/questions/:questionId/hide',
    route(async (req, res) => {
      const room = await service.requireAdmin(param(req, 'code'), adminKey(req));
      await service.hideQuestion(room, param(req, 'questionId'));
      notify(room.id, 'question');
      res.json({ ok: true });
    }),
  );

  api.post(
    '/rooms/:code/questions/:questionId/split',
    route(async (req, res) => {
      const room = await service.requireAdmin(param(req, 'code'), adminKey(req));
      const cluster = await service.splitQuestion(room, param(req, 'questionId'));
      notify(room.id, 'cluster');
      res.json({ clusterId: cluster.id });
    }),
  );

  // ----------------------------------------------------------- grupos

  api.patch(
    '/rooms/:code/clusters/:clusterId',
    route(async (req, res) => {
      const room = await service.requireAdmin(param(req, 'code'), adminKey(req));

      const rawStatus = req.body?.status;
      if (rawStatus !== undefined && !VALID_STATUSES.includes(rawStatus as ClusterStatus)) {
        throw new ServiceError(400, `Estado inválido: ${String(rawStatus)}`);
      }

      const cluster = await service.updateCluster(room, param(req, 'clusterId'), {
        status: rawStatus as ClusterStatus | undefined,
        label: typeof req.body?.label === 'string' ? req.body.label : undefined,
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
      });
      notify(room.id, 'cluster');
      res.json({
        id: cluster.id,
        status: cluster.status,
        label: cluster.label,
        note: cluster.note,
      });
    }),
  );

  api.post(
    '/rooms/:code/clusters/:clusterId/merge',
    route(async (req, res) => {
      const room = await service.requireAdmin(param(req, 'code'), adminKey(req));
      const targetId = typeof req.body?.targetId === 'string' ? req.body.targetId : '';
      if (!targetId) throw new ServiceError(400, 'Falta el grupo destino');

      const cluster = await service.mergeClusters(room, param(req, 'clusterId'), targetId);
      notify(room.id, 'cluster');
      res.json({ id: cluster.id });
    }),
  );

  api.get('/health', (_req, res) => {
    res.json({ ok: true, realtime });
  });

  app.use('/api', api);

  // Build del cliente servido por el mismo proceso. En Vercel no aplica: los
  // estáticos los sirve la CDN y la función sólo atiende /api.
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

  return { app, service, repository, realtime };
}
