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
import { createSemanticConfig, type Embedder } from './text/embeddings.js';
import { createTopicMatcher, type TopicMatcher } from './text/claude.js';
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
  /** Contraseña del panel general del docente. Sin ella ese panel no existe. */
  adminPassword?: string | null;
  /** Comparación por significado. Por defecto se toma del entorno. */
  embedder?: Embedder | null;
  semanticThreshold?: number;
  /** Clasificador de temas por lenguaje. Por defecto se toma del entorno. */
  matcher?: TopicMatcher | null;
  /**
   * Si es true y no hay base de datos configurada, la API responde 503 en lugar
   * de trabajar en memoria. En serverless esto es imprescindible: sin base, cada
   * invocación arranca vacía, así que crear una sala "funciona" pero la sala
   * desaparece de inmediato. Es preferible un error claro a ese comportamiento.
   */
  requirePersistence?: boolean;
  /**
   * Orígenes autorizados a llamar a esta API desde otro dominio, separados por
   * coma. Vacío (lo habitual) significa sin CORS: sólo el mismo origen.
   */
  allowedOrigins?: string;
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

/**
 * Host de la cadena de conexión, sin usuario ni contraseña.
 *
 * Se publica en el diagnóstico para poder confirmar contra qué base se está
 * hablando y si pasa por un pooler, que es lo que corresponde en serverless.
 */
export function describeHost(connectionString: string | null): string | null {
  if (!connectionString) return null;
  try {
    const url = new URL(connectionString);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return 'cadena de conexión ilegible';
  }
}

export function createApp(options: AppOptions = {}) {
  const repository =
    options.repository ??
    (options.databaseUrl
      ? new PostgresRepository(options.databaseUrl)
      : new JsonRepository(options.dataFile ?? null));

  const realtime: RealtimeMode = options.realtime ?? (options.databaseUrl ? 'poll' : 'sse');
  const adminPassword = options.adminPassword?.trim() || null;
  const semantica = createSemanticConfig();
  const embedder = options.embedder !== undefined ? options.embedder : semantica.embedder;
  const matcher = options.matcher !== undefined ? options.matcher : createTopicMatcher();
  const service = new Service(
    repository,
    adminPassword,
    embedder,
    options.semanticThreshold ?? semantica.threshold,
    matcher,
  );
  const persistenceMissing = Boolean(options.requirePersistence) && !options.databaseUrl;

  // El almacenamiento se prepara en la primera petición y el repositorio cachea
  // el resultado. Se lo llama en cada una a propósito, en lugar de guardar una
  // única promesa al construir la app: si el primer intento falla (una base
  // suspendida que tarda en despertar), esa promesa quedaría rechazada para
  // siempre y la instancia no se recuperaría nunca.
  let storageError: Error | null = null;
  function prepareStorage(): Promise<void> {
    return repository.init().then(
      () => {
        storageError = null;
      },
      (cause: unknown) => {
        storageError = cause instanceof Error ? cause : new Error(String(cause));
        console.error('No se pudo inicializar el almacenamiento:', cause);
        throw storageError;
      },
    );
  }
  // Se dispara al arrancar para que la instancia llegue caliente, sin que nadie
  // dependa de este intento en particular.
  prepareStorage().catch(() => undefined);

  /** Rutas que tienen que contestar aunque el almacenamiento esté caído. */
  const DIAGNOSTIC_PATHS = ['/api/health', '/api/config'];

  const app = express();

  // El cliente se sirve desde el mismo origen que la API (en desarrollo, a
  // través del proxy de Vite), así que no hace falta CORS para que la app
  // funcione. Abrirlo a todo el mundo sólo habilita que cualquier sitio use
  // esta API desde el navegador de un tercero. Queda disponible para quien lo
  // necesite, pero hay que nombrar los orígenes.
  const allowedOrigins = (options.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.use(cors({ origin: allowedOrigins }));
  }

  app.use((_req, res, next) => {
    // No se sirve nada que deba interpretarse fuera de su tipo declarado, ni
    // hay motivo para que esta app viva dentro de un iframe ajeno.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // 'unsafe-inline' en style-src es por los atributos `style` de React; los
    // scripts, en cambio, sólo pueden venir de este origen.
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    next();
  });

  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    // Si la base no conecta, estas dos son las únicas que pueden explicar por
    // qué falla todo lo demás: dejarlas caer con el resto convierte un problema
    // de conexión en un misterio.
    if (DIAGNOSTIC_PATHS.includes(req.path)) {
      next();
      return;
    }
    prepareStorage().then(() => next()).catch(next);
  });

  const api = express.Router();

  // Sin almacenamiento persistente no se atiende nada: es preferible un error
  // explicable a que las preguntas se pierdan en medio de una clase.
  if (persistenceMissing) {
    api.use((req, res, next) => {
      // /health y /config siguen respondiendo: son justamente las que sirven
      // para diagnosticar por qué el resto no anda.
      if (req.path === '/health' || req.path === '/config') {
        next();
        return;
      }
      res.status(503).json({
        error:
          'Falta configurar la base de datos. Sin ella las salas se pierden entre ' +
          'una petición y la siguiente. Configurá DATABASE_URL y volvé a desplegar.',
      });
    });
  }

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

  /** Contraseña del panel general, que abre cualquier sala. */
  function adminPasswordOf(req: Request): string | undefined {
    return req.header('x-admin-password') ?? undefined;
  }

  /**
   * Freno a la prueba de contraseñas.
   *
   * Cada fallo cuesta una espera fija y, pasados unos cuantos, ese cliente
   * queda bloqueado un rato. En serverless el contador vive en la instancia,
   * así que no es una barrera absoluta; la espera por fallo, en cambio, vale
   * siempre y es lo que convierte "miles de intentos por minuto" en unos pocos.
   */
  const VENTANA_FALLOS_MS = 5 * 60_000;
  const MAX_FALLOS = 10;
  const ESPERA_POR_FALLO_MS = 400;
  const fallos = new Map<string, { intentos: number; hasta: number }>();

  function identificarCliente(req: Request): string {
    const reenviado = req.header('x-forwarded-for')?.split(',')[0]?.trim();
    return reenviado || req.ip || 'desconocido';
  }

  /** Ejecuta una comprobación de contraseña con el freno puesto. */
  async function conFreno<T>(req: Request, comprobar: () => T): Promise<T> {
    const cliente = identificarCliente(req);
    const estado = fallos.get(cliente);
    const vigente = estado && Date.now() < estado.hasta ? estado : undefined;
    if (vigente && vigente.intentos >= MAX_FALLOS) {
      throw new ServiceError(429, 'Demasiados intentos fallidos. Esperá unos minutos.');
    }
    try {
      const resultado = comprobar();
      fallos.delete(cliente);
      return resultado;
    } catch (error) {
      if (error instanceof ServiceError && error.status === 403) {
        // El mapa se poda cuando crece: no debe convertirse en una fuga de
        // memoria en un proceso de larga vida.
        if (fallos.size > 1_000) {
          for (const [clave, valor] of fallos) {
            if (Date.now() >= valor.hasta) fallos.delete(clave);
          }
        }
        fallos.set(cliente, {
          intentos: (vigente?.intentos ?? 0) + 1,
          hasta: Date.now() + VENTANA_FALLOS_MS,
        });
        await new Promise((resolve) => setTimeout(resolve, ESPERA_POR_FALLO_MS));
      }
      throw error;
    }
  }

  /** Acceso al panel de una sala: con su clave propia o con la contraseña general. */
  async function roomAdmin(req: Request) {
    const room = await service.getRoomByCode(param(req, 'code'));
    return conFreno(req, () =>
      service.requireAdminOn(room, adminKey(req), adminPasswordOf(req)),
    );
  }

  /** Sólo tiene efecto cuando hay un proceso persistente detrás. */
  function notify(roomId: string, event: string): void {
    if (realtime === 'sse') publish(roomId, event);
  }

  // ------------------------------------------------------------ salas

  api.get(
    '/config',
    route(async (_req, res) => {
      res.json({
        realtime,
        masterAdmin: service.masterAdminEnabled,
        semantic: service.semanticEnabled,
        // Nunca se expone la clave, sólo si la función está activa.
        smartGrouping: service.matcherEnabled,
      });
    }),
  );

  /** Valida la contraseña del panel general. */
  api.post(
    '/admin/session',
    route(async (req, res) => {
      const password = typeof req.body?.password === 'string' ? req.body.password : undefined;
      await conFreno(req, () => service.requireMasterAdmin(password));
      res.json({ ok: true });
    }),
  );

  /** Todas las salas del docente, con sus números. */
  api.get(
    '/admin/rooms',
    route(async (req, res) => {
      await conFreno(req, () => service.requireMasterAdmin(adminPasswordOf(req)));
      res.json({ rooms: await service.listRooms() });
    }),
  );

  api.post(
    '/rooms',
    route(async (req, res) => {
      // Crear clases es del docente. Antes cualquiera con la URL podía abrir
      // salas sin límite en el despliegue: la contraseña ya estaba configurada,
      // sólo que esta ruta no la miraba. Cuando no hay contraseña (desarrollo
      // local, sin ADMIN_PASSWORD) se mantiene abierto: no hay nada que exigir.
      if (service.masterAdminEnabled) {
        await conFreno(req, () => service.requireMasterAdmin(adminPasswordOf(req)));
      }
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
      const room = await roomAdmin(req);
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
      const room = await roomAdmin(req);
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
        // Deja ver si el clasificador por lenguaje intervino o si agrupó el
        // motor de palabras: sin esto, "no parece estar usándose" es indemostrable.
        groupedBy: result.groupedBy,
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
      const room = await roomAdmin(req);
      await service.hideQuestion(room, param(req, 'questionId'));
      notify(room.id, 'question');
      res.json({ ok: true });
    }),
  );

  api.post(
    '/rooms/:code/questions/:questionId/split',
    route(async (req, res) => {
      const room = await roomAdmin(req);
      const cluster = await service.splitQuestion(room, param(req, 'questionId'));
      notify(room.id, 'cluster');
      res.json({ clusterId: cluster.id });
    }),
  );

  // ----------------------------------------------------------- grupos

  api.patch(
    '/rooms/:code/clusters/:clusterId',
    route(async (req, res) => {
      const room = await roomAdmin(req);

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
      const room = await roomAdmin(req);
      const targetId = typeof req.body?.targetId === 'string' ? req.body.targetId : '';
      if (!targetId) throw new ServiceError(400, 'Falta el grupo destino');

      const cluster = await service.mergeClusters(room, param(req, 'clusterId'), targetId);
      notify(room.id, 'cluster');
      res.json({ id: cluster.id });
    }),
  );

  api.get(
    '/health',
    route(async (_req, res) => {
      // Se reintenta acá mismo: si la base estaba suspendida, consultar el
      // estado es también la forma de despertarla.
      await prepareStorage().catch(() => undefined);
      const almacenamiento: Error | null = storageError;
      res.json({
        ok: !persistenceMissing && almacenamiento === null,
        realtime,
        database: options.databaseUrl ? 'postgres' : 'archivo',
        // Host sin credenciales, para poder ver si la conexión pasa por el
        // pooler sin exponer la contraseña de la base.
        databaseHost: describeHost(options.databaseUrl ?? null),
        masterAdmin: service.masterAdminEnabled,
        // Si está en false, la app agrupa sólo por palabras compartidas.
        semantic: service.semanticEnabled,
        smartGrouping: service.matcherEnabled,
        // Se informa el motivo exacto: sin esto, un fallo de conexión se
        // manifiesta como errores sueltos en pantallas que no tienen que ver.
        storage: almacenamiento === null ? 'ok' : 'error',
        storageError: almacenamiento === null ? undefined : almacenamiento.message,
      });
    }),
  );

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
