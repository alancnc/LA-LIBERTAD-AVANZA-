export type ClusterStatus = 'pending' | 'answering' | 'answered' | 'discarded';

export interface Room {
  id: string;
  /** Código corto que comparte el docente con los alumnos, ej. "K7QP2M". */
  code: string;
  title: string;
  adminKey: string;
  /** Umbral de similitud [0..1] a partir del cual dos preguntas se consideran "la misma". */
  threshold: number;
  /** Si está cerrada, no se aceptan preguntas ni votos nuevos. */
  closed: boolean;
  createdAt: number;
}

export interface Question {
  id: string;
  roomId: string;
  clusterId: string;
  text: string;
  author: string;
  /** Id anónimo del navegador que la envió (localStorage). */
  voterId: string;
  /** Ids de quienes votaron esta pregunta puntual. */
  upvotes: string[];
  createdAt: number;
  hidden: boolean;
}

export interface Cluster {
  id: string;
  roomId: string;
  /** Texto representativo del grupo: por defecto, la primera pregunta recibida. */
  label: string;
  status: ClusterStatus;
  /** Notas del docente sobre cómo respondió el tema. */
  note: string;
  createdAt: number;
  answeredAt: number | null;
}

export interface Database {
  rooms: Room[];
  clusters: Cluster[];
  questions: Question[];
}

/** Grupo de preguntas ya rankeado, tal como lo consumen el tablero y el panel admin. */
export interface RankedCluster {
  id: string;
  label: string;
  status: ClusterStatus;
  note: string;
  /** Cantidad de preguntas distintas que cayeron en este grupo. */
  questionCount: number;
  /** Suma de votos de todas las preguntas del grupo. */
  upvotes: number;
  /** questionCount + upvotes: cuánta gente quiere que se responda esto. */
  score: number;
  createdAt: number;
  lastActivityAt: number;
  answeredAt: number | null;
  questions: PublicQuestion[];
}

export interface PublicQuestion {
  id: string;
  text: string;
  author: string;
  upvotes: number;
  createdAt: number;
  /** true si el visitante actual ya votó esta pregunta. */
  votedByMe: boolean;
  /** true si el visitante actual es quien la escribió. */
  mine: boolean;
}
