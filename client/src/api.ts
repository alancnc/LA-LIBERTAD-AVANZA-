export type ClusterStatus = 'pending' | 'answering' | 'answered' | 'discarded';

export interface PublicQuestion {
  id: string;
  text: string;
  author: string;
  upvotes: number;
  createdAt: number;
  votedByMe: boolean;
  mine: boolean;
}

export interface RankedCluster {
  id: string;
  label: string;
  status: ClusterStatus;
  note: string;
  questionCount: number;
  upvotes: number;
  score: number;
  createdAt: number;
  lastActivityAt: number;
  answeredAt: number | null;
  questions: PublicQuestion[];
}

export interface RoomInfo {
  code: string;
  title: string;
  closed: boolean;
  threshold?: number;
}

export interface RoomStats {
  questionCount: number;
  clusterCount: number;
  pendingCount: number;
  answeredCount: number;
  participants: number;
}

export interface PublicAnswer {
  id: string;
  text: string;
  author: string;
  createdAt: number;
  mine: boolean;
}

/** La pregunta que el docente le lanzó a la clase, tal como la ve un alumno. */
export interface LivePrompt {
  id: string;
  text: string;
  closed: boolean;
  createdAt: number;
  answerCount: number;
  /** Lo que respondió este navegador, o null si todavía no respondió. */
  myAnswer: string | null;
  /** Vacío hasta que uno responde: no se ven las respuestas ajenas antes. */
  answers: PublicAnswer[];
}

export interface AdminPrompt {
  id: string;
  text: string;
  closed: boolean;
  createdAt: number;
  closedAt: number | null;
  answerCount: number;
  answers: PublicAnswer[];
}

export interface BoardResponse {
  room: RoomInfo;
  clusters: RankedCluster[];
  prompt: LivePrompt | null;
}

export interface AdminResponse extends BoardResponse {
  stats: RoomStats;
  prompts: AdminPrompt[];
}

/** Una clase abierta, tal como la ve un alumno en la portada. */
export interface OpenRoom {
  code: string;
  title: string;
  createdAt: number;
}

/** Una sala en el listado del panel general del docente. */
export interface RoomSummary {
  code: string;
  title: string;
  closed: boolean;
  createdAt: number;
  adminKey: string;
  questionCount: number;
  pendingCount: number;
}

export interface AskResponse {
  questionId: string;
  clusterId: string;
  isNewCluster: boolean;
  similarity: number;
  clusterLabel: string;
}

/** Error de la API con el mensaje que devolvió el servidor. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const VIEWER_STORAGE_KEY = 'preguntas-en-vivo:viewer-id';
const ADMIN_PASSWORD_KEY = 'preguntas-en-vivo:admin-password';

/** Contraseña del panel general, guardada en este navegador. */
export function loadAdminPassword(): string | null {
  return localStorage.getItem(ADMIN_PASSWORD_KEY);
}

export function saveAdminPassword(password: string): void {
  localStorage.setItem(ADMIN_PASSWORD_KEY, password);
}

export function clearAdminPassword(): void {
  localStorage.removeItem(ADMIN_PASSWORD_KEY);
}

/**
 * Identidad anónima del navegador. No hay login: alcanza con un id estable
 * para saber qué preguntas escribió y votó cada persona.
 */
export function getViewerId(): string {
  let id = localStorage.getItem(VIEWER_STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VIEWER_STORAGE_KEY, id);
  }
  return id;
}

function adminStorageKey(code: string): string {
  return `preguntas-en-vivo:admin:${code.toUpperCase()}`;
}

/** Guarda la clave de docente para que no haya que volver a pegarla. */
export function saveAdminKey(code: string, key: string): void {
  localStorage.setItem(adminStorageKey(code), key);
}

export function loadAdminKey(code: string): string | null {
  return localStorage.getItem(adminStorageKey(code));
}

export function clearAdminKey(code: string): void {
  localStorage.removeItem(adminStorageKey(code));
}

async function call<T>(
  method: string,
  path: string,
  options: { body?: unknown; adminKey?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'x-viewer-id': getViewerId() };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.adminKey) headers['x-admin-key'] = options.adminKey;
  // La contraseña del panel general abre cualquier sala, así que viaja siempre
  // que esté guardada: evita tener que recordar la clave de cada sala.
  const password = loadAdminPassword();
  if (password) headers['x-admin-password'] = password;

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, payload?.error ?? `Error ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  /** Valida la contraseña del panel general contra el servidor. */
  login: (password: string) =>
    call<{ ok: true }>('POST', '/admin/session', { body: { password } }),

  listRooms: () => call<{ rooms: RoomSummary[] }>('GET', '/admin/rooms'),

  createRoom: (title: string) =>
    call<{ code: string; title: string; adminKey: string }>('POST', '/rooms', { body: { title } }),

  /** Clases abiertas, para que el alumno elija de una lista. Sin credenciales. */
  listOpenRooms: () =>
    call<{ rooms: OpenRoom[] }>('GET', '/rooms'),

  getRoom: (code: string) => call<RoomInfo>('GET', `/rooms/${code}`),

  /**
   * Borra la clase con todo lo que juntó. La contraseña del docente viaja sola
   * en cada llamada; la clave de la sala no alcanza para esto.
   */
  deleteRoom: (code: string) => call<void>('DELETE', `/rooms/${code}`),

  getBoard: (code: string) => call<BoardResponse>('GET', `/rooms/${code}/board`),

  getAdminBoard: (code: string, adminKey: string) =>
    call<AdminResponse>('GET', `/rooms/${code}/admin`, { adminKey }),

  ask: (code: string, text: string, author: string) =>
    call<AskResponse>('POST', `/rooms/${code}/questions`, { body: { text, author } }),

  vote: (code: string, questionId: string) =>
    call<{ upvotes: number; voted: boolean }>(
      'POST',
      `/rooms/${code}/questions/${questionId}/vote`,
    ),

  /** El docente lanza una pregunta para que la responda la clase. */
  createPrompt: (code: string, text: string, adminKey: string) =>
    call<{ id: string; text: string; closed: boolean }>('POST', `/rooms/${code}/prompts`, {
      body: { text },
      adminKey,
    }),

  setPromptClosed: (code: string, promptId: string, closed: boolean, adminKey: string) =>
    call<{ id: string; closed: boolean }>('PATCH', `/rooms/${code}/prompts/${promptId}`, {
      body: { closed },
      adminKey,
    }),

  deletePrompt: (code: string, promptId: string, adminKey: string) =>
    call<void>('DELETE', `/rooms/${code}/prompts/${promptId}`, { adminKey }),

  /** Responder de nuevo reemplaza la respuesta anterior de esta persona. */
  answerPrompt: (code: string, promptId: string, text: string, author: string) =>
    call<{ id: string; text: string; author: string }>(
      'POST',
      `/rooms/${code}/prompts/${promptId}/answers`,
      { body: { text, author } },
    ),

  hideAnswer: (code: string, answerId: string, adminKey: string) =>
    call<{ ok: true }>('POST', `/rooms/${code}/answers/${answerId}/hide`, { adminKey }),

  hideQuestion: (code: string, questionId: string, adminKey: string) =>
    call<{ ok: true }>('POST', `/rooms/${code}/questions/${questionId}/hide`, { adminKey }),

  splitQuestion: (code: string, questionId: string, adminKey: string) =>
    call<{ clusterId: string }>('POST', `/rooms/${code}/questions/${questionId}/split`, {
      adminKey,
    }),

  updateCluster: (
    code: string,
    clusterId: string,
    changes: { status?: ClusterStatus; label?: string; note?: string },
    adminKey: string,
  ) => call<unknown>('PATCH', `/rooms/${code}/clusters/${clusterId}`, { body: changes, adminKey }),

  mergeClusters: (code: string, sourceId: string, targetId: string, adminKey: string) =>
    call<{ id: string }>('POST', `/rooms/${code}/clusters/${sourceId}/merge`, {
      body: { targetId },
      adminKey,
    }),

  updateRoom: (
    code: string,
    changes: { title?: string; closed?: boolean; threshold?: number },
    adminKey: string,
  ) => call<RoomInfo>('PATCH', `/rooms/${code}`, { body: changes, adminKey }),
};

/**
 * Cómo se entera esta app de que el tablero cambió.
 *
 * - `sse`: el servidor empuja los cambios por una conexión abierta.
 * - `poll`: el cliente pregunta cada pocos segundos. Es lo que corresponde en
 *   despliegues serverless (Vercel), donde no hay un proceso persistente que
 *   sostenga la conexión.
 */
export type RealtimeMode = 'sse' | 'poll';

let realtimeMode: Promise<RealtimeMode> | null = null;

/** Se consulta una vez por carga de página y se reutiliza. */
export function getRealtimeMode(): Promise<RealtimeMode> {
  realtimeMode ??= call<{ realtime: RealtimeMode }>('GET', '/config')
    .then((config) => config.realtime)
    // Ante la duda, sondear: funciona en todos lados.
    .catch(() => 'poll' as const);
  return realtimeMode;
}

/**
 * Qué ofrece este despliegue: sirve para no mostrar lo que no está habilitado.
 *
 * Propaga el error a propósito. Antes lo tragaba y devolvía `masterAdmin:false`,
 * con lo cual un problema de conexión con la base se mostraba en pantalla como
 * "falta configurar la contraseña": un mensaje que apunta al lugar equivocado y
 * manda a buscar el problema donde no está.
 */
export function getConfig(): Promise<{ realtime: RealtimeMode; masterAdmin: boolean }> {
  return call<{ realtime: RealtimeMode; masterAdmin: boolean }>('GET', '/config');
}

/**
 * Escucha las novedades de la sala y avisa cada vez que hay que refrescar.
 * Devuelve la función para cortar la conexión.
 */
export function listenToRoom(code: string, onChange: () => void): () => void {
  const source = new EventSource(`/api/rooms/${code}/stream`);
  for (const event of ['question', 'vote', 'cluster', 'room', 'prompt', 'answer']) {
    source.addEventListener(event, onChange);
  }
  return () => source.close();
}
