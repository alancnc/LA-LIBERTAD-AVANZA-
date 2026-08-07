import type { Answer, Cluster, ClusterStatus, Prompt, Question, Room } from '../types.js';

/** Grupo candidato con los textos de sus preguntas, para decidir dónde cae una nueva. */
export interface ClusterWithTexts {
  clusterId: string;
  texts: string[];
  /** Vectores de esos textos, en el mismo orden; null donde no haya. */
  embeddings: Array<number[] | null>;
}

/** Todo lo que hace falta para armar el tablero de una sala. */
export interface BoardData {
  clusters: Cluster[];
  questions: Question[];
}

/** Las consignas de una sala con sus respuestas visibles. */
export interface PromptData {
  prompts: Prompt[];
  answers: Answer[];
}

export interface CreateQuestionInput {
  roomId: string;
  text: string;
  author: string;
  voterId: string;
  /** Vector del texto, o null si la comparación semántica no está activa. */
  embedding: number[] | null;
  /**
   * Tema elegido de antemano, cuando lo decidió un clasificador externo.
   *
   * Esa decisión necesita una llamada de red, y hacerla dentro de la
   * transacción dejaría el lock de la sala tomado durante todo ese tiempo,
   * serializando a la clase entera. Se resuelve antes y se valida acá: si el
   * grupo ya no existe o dejó de estar abierto, se recae en `assign`.
   */
  preferredClusterId?: string | null;
}

export interface CreatedQuestion {
  question: Question;
  cluster: Cluster;
  isNewCluster: boolean;
  score: number;
}

/**
 * Contrato de persistencia.
 *
 * Está definido por operación y no como "leer y escribir toda la base" a
 * propósito: en un entorno serverless conviven varias instancias, y un
 * read-modify-write completo haría que dos alumnos que preguntan a la vez se
 * pisen y una pregunta se pierda. Cada implementación resuelve la concurrencia
 * con las herramientas que tenga.
 */
export interface Repository {
  /** Prepara el almacenamiento (crear tablas, cargar el archivo, etc.). */
  init(): Promise<void>;

  createRoom(room: Room): Promise<Room>;
  getRoomByCode(code: string): Promise<Room | null>;
  /** Todas las salas, de la más reciente a la más vieja. Para el panel maestro. */
  listRooms(): Promise<Room[]>;
  isRoomCodeTaken(code: string): Promise<boolean>;
  updateRoom(
    roomId: string,
    changes: { title?: string; closed?: boolean; threshold?: number },
  ): Promise<Room>;

  /**
   * Borra la sala y todo lo que cuelga de ella: temas, preguntas, votos,
   * consignas y respuestas. No hay papelera: lo que se borra, se fue.
   */
  deleteRoom(roomId: string): Promise<void>;

  /**
   * Inserta una pregunta asignándola a un grupo.
   *
   * `assign` recibe los grupos que pueden absorberla y devuelve el elegido (o
   * null para abrir uno nuevo). Se le pasa como callback para que la decisión
   * ocurra dentro de la misma transacción que la inserción: así dos preguntas
   * simultáneas sobre el mismo tema no crean dos grupos duplicados.
   */
  addQuestion(
    input: CreateQuestionInput,
    assign: (candidates: ClusterWithTexts[]) => { clusterId: string | null; score: number },
  ): Promise<CreatedQuestion>;

  getQuestion(roomId: string, questionId: string): Promise<Question | null>;
  hideQuestion(roomId: string, questionId: string): Promise<void>;
  /** Mueve la pregunta a un grupo nuevo y lo devuelve. */
  splitQuestion(roomId: string, questionId: string, cluster: Cluster): Promise<Cluster>;

  /** Alterna el voto y devuelve el total resultante. */
  toggleVote(
    roomId: string,
    questionId: string,
    voterId: string,
  ): Promise<{ upvotes: number; voted: boolean }>;

  getCluster(roomId: string, clusterId: string): Promise<Cluster | null>;
  updateCluster(
    roomId: string,
    clusterId: string,
    changes: { status?: ClusterStatus; label?: string; note?: string },
  ): Promise<Cluster>;
  /** Pasa las preguntas de `sourceId` a `targetId` y borra el grupo origen. */
  mergeClusters(roomId: string, sourceId: string, targetId: string): Promise<Cluster>;

  getBoardData(roomId: string): Promise<BoardData>;

  // ------------------------------------------------- consignas del docente

  /**
   * Guarda una consigna nueva. Las anteriores no se tocan: pueden convivir
   * varias abiertas y el alumno las ve y responde todas.
   */
  createPrompt(prompt: Prompt): Promise<Prompt>;
  getPrompt(roomId: string, promptId: string): Promise<Prompt | null>;
  updatePrompt(roomId: string, promptId: string, changes: { closed?: boolean }): Promise<Prompt>;
  /** Borra la consigna y, con ella, sus respuestas. */
  deletePrompt(roomId: string, promptId: string): Promise<void>;

  /**
   * Registra la respuesta de un participante, reemplazando la anterior si ya
   * había respondido esa consigna: una persona, una respuesta.
   */
  saveAnswer(answer: Answer): Promise<Answer>;
  hideAnswer(roomId: string, answerId: string): Promise<void>;

  getPromptData(roomId: string): Promise<PromptData>;

  /** Cierra conexiones abiertas. */
  close(): Promise<void>;
}
