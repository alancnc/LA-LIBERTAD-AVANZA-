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

export interface BoardResponse {
  room: RoomInfo;
  clusters: RankedCluster[];
}

export interface AdminResponse extends BoardResponse {
  stats: RoomStats;
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
  createRoom: (title: string) =>
    call<{ code: string; title: string; adminKey: string }>('POST', '/rooms', { body: { title } }),

  getRoom: (code: string) => call<RoomInfo>('GET', `/rooms/${code}`),

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
 * Escucha las novedades de la sala por SSE y avisa cada vez que hay que refrescar.
 * Devuelve la función para cortar la conexión.
 */
export function listenToRoom(code: string, onChange: () => void): () => void {
  const source = new EventSource(`/api/rooms/${code}/stream`);
  for (const event of ['question', 'vote', 'cluster', 'room']) {
    source.addEventListener(event, onChange);
  }
  return () => source.close();
}
