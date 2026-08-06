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
  /**
   * Vector del texto, si la comparación semántica está activa. Se guarda para
   * no recalcularlo cada vez que llega una pregunta nueva.
   */
  embedding?: number[] | null;
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

/**
 * Consigna: una pregunta que lanza el docente para que la clase responda.
 *
 * Es el sentido inverso al del resto de la app. Las preguntas de los alumnos se
 * agrupan porque son muchas versiones de lo mismo y hay que reducirlas; una
 * consigna es una sola y lo que interesa es la variedad de lo que contesta cada
 * uno, así que las respuestas no se agrupan: se muestran todas.
 */
export interface Prompt {
  id: string;
  roomId: string;
  text: string;
  /**
   * Opciones para elegir. Vacío = pregunta abierta, se responde escribiendo.
   *
   * La respuesta a una consigna con opciones se guarda como el texto de la
   * opción elegida, no como un índice: si el docente edita o reordena las
   * opciones, lo que contestó cada uno sigue queriendo decir lo mismo.
   */
  options: string[];
  /** Cerrada: queda en pantalla pero ya no admite respuestas nuevas. */
  closed: boolean;
  createdAt: number;
  closedAt: number | null;
}

/** Cuántos eligieron cada opción. */
export interface OptionTally {
  option: string;
  count: number;
}

export interface Answer {
  id: string;
  promptId: string;
  roomId: string;
  text: string;
  author: string;
  /** Id anónimo del navegador. Hay una sola respuesta por persona y consigna. */
  voterId: string;
  createdAt: number;
  hidden: boolean;
}

export interface Database {
  rooms: Room[];
  clusters: Cluster[];
  questions: Question[];
  prompts: Prompt[];
  answers: Answer[];
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

export interface PublicAnswer {
  id: string;
  text: string;
  author: string;
  createdAt: number;
  /** true si el visitante actual es quien la escribió. */
  mine: boolean;
}

/** La consigna vigente, tal como la ve un alumno. */
export interface LivePrompt {
  id: string;
  text: string;
  /** Opciones para elegir; vacío si la consigna es de respuesta abierta. */
  options: string[];
  closed: boolean;
  createdAt: number;
  /** Cuántas personas respondieron. Visible siempre, aun sin haber respondido. */
  answerCount: number;
  /** Lo que respondió el visitante, o null si todavía no respondió. */
  myAnswer: string | null;
  /**
   * El reparto por opción. Sigue la misma regla que `answers`: llega vacío
   * hasta que el visitante responde, porque ver el recuento antes de elegir
   * arrastra a la mayoría igual que ver las respuestas ajenas.
   */
  tally: OptionTally[];
  /**
   * Las respuestas de los demás.
   *
   * Llega vacío hasta que el visitante responde: si viera las respuestas ajenas
   * antes de escribir la suya, la consigna dejaría de medir lo que piensa la
   * clase y pasaría a medir lo que copió del primero que contestó. Con la
   * consigna cerrada se muestran a todos, hayan respondido o no.
   */
  answers: PublicAnswer[];
}

/** La consigna con todo lo que respondieron, para el panel del docente. */
export interface AdminPrompt {
  id: string;
  text: string;
  options: string[];
  closed: boolean;
  createdAt: number;
  closedAt: number | null;
  answerCount: number;
  answers: PublicAnswer[];
  /** El docente ve el reparto siempre: es para lo que lanzó la consigna. */
  tally: OptionTally[];
}
