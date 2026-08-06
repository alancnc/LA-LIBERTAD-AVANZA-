import { timingSafeEqual } from 'node:crypto';
import { DEFAULT_THRESHOLD, findBestCluster } from './text/cluster.js';
import { DEFAULT_SEMANTIC_THRESHOLD, type Embedder } from './text/embeddings.js';
import type { TopicMatcher, TopicOption } from './text/claude.js';
import { generateAdminKey, generateRoomCode, newId } from './ids.js';
import type { Repository } from './repository/types.js';
import type {
  AdminPrompt,
  Answer,
  Cluster,
  ClusterStatus,
  LivePrompt,
  Prompt,
  PublicAnswer,
  PublicQuestion,
  Question,
  RankedCluster,
  Room,
} from './types.js';

export const MAX_QUESTION_LENGTH = 400;
export const MAX_AUTHOR_LENGTH = 40;
export const MIN_AUTHOR_LENGTH = 2;
export const MAX_TITLE_LENGTH = 120;
/** Tope de preguntas por participante por minuto, contra ráfagas y bromas. */
export const MAX_QUESTIONS_PER_MINUTE = 4;
/** Consigna del docente y respuesta del alumno. */
export const MAX_PROMPT_LENGTH = 300;
export const MAX_ANSWER_LENGTH = 500;

export class ServiceError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

/**
 * Comparación en tiempo constante, para que el tiempo de respuesta no permita
 * ir adivinando la contraseña carácter por carácter.
 */
function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Nombre con el que se firma. No hay anónimos: ni preguntas ni respuestas.
 */
function normalizeAuthor(raw: string): string {
  const author = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_AUTHOR_LENGTH);
  if (author.length < MIN_AUTHOR_LENGTH) {
    throw new ServiceError(400, 'Ingresá tu nombre para poder participar');
  }
  return author;
}

function toPublicAnswer(answer: Answer, viewerId: string): PublicAnswer {
  return {
    id: answer.id,
    text: answer.text,
    author: answer.author,
    createdAt: answer.createdAt,
    mine: viewerId !== '' && answer.voterId === viewerId,
  };
}

export class Service {
  /**
   * @param masterPassword Contraseña del panel general del docente. Si es null,
   *   ese panel queda deshabilitado y sólo se puede entrar sala por sala con su
   *   clave propia.
   */
  constructor(
    private readonly repository: Repository,
    private readonly masterPassword: string | null = null,
    /** Comparación por significado. Sin esto sólo se compara por palabras. */
    private readonly embedder: Embedder | null = null,
    private readonly semanticThreshold: number = DEFAULT_SEMANTIC_THRESHOLD,
    /** Clasificador por lenguaje. Es la señal más precisa de las tres. */
    private readonly matcher: TopicMatcher | null = null,
  ) {}

  get semanticEnabled(): boolean {
    return this.embedder !== null;
  }

  get matcherEnabled(): boolean {
    return this.matcher !== null;
  }

  /**
   * Le pregunta al clasificador a qué tema pertenece la pregunta.
   *
   * Se resuelve antes de abrir la transacción a propósito: sostener el lock de
   * la sala durante una llamada de red serializaría a toda la clase detrás de
   * cada pregunta. Cualquier fallo devuelve null y se agrupa como siempre.
   */
  private async preselectTopic(room: Room, text: string): Promise<string | null> {
    if (!this.matcher) return null;
    try {
      const { clusters, questions } = await this.repository.getBoardData(room.id);
      const abiertos = clusters.filter(
        (cluster) => cluster.status === 'pending' || cluster.status === 'answering',
      );
      if (abiertos.length === 0) return null;

      const opciones: TopicOption[] = abiertos.map((cluster) => ({
        id: cluster.id,
        label: cluster.label,
        examples: questions
          .filter((question) => question.clusterId === cluster.id)
          .map((question) => question.text),
      }));
      return await this.matcher.match(text, opciones);
    } catch (error) {
      console.error('El clasificador de temas no respondió:', error);
      return null;
    }
  }

  /**
   * Vector del texto, o null si no hay comparación semántica configurada.
   *
   * Un fallo del proveedor no puede impedir que alguien pregunte: se registra
   * y la pregunta entra igual, agrupada sólo por palabras.
   */
  private async embed(text: string): Promise<number[] | null> {
    if (!this.embedder) return null;
    try {
      const [vector] = await this.embedder.embed([text]);
      return vector && vector.length > 0 ? vector : null;
    } catch (error) {
      console.error('No se pudo calcular el vector de la pregunta:', error);
      return null;
    }
  }

  get masterAdminEnabled(): boolean {
    return this.masterPassword !== null;
  }

  /** Valida la contraseña del panel general. */
  checkMasterPassword(password: string | undefined): boolean {
    if (!this.masterPassword || !password) return false;
    return secretsMatch(password, this.masterPassword);
  }

  /** Exige la contraseña del panel general. */
  requireMasterAdmin(password: string | undefined): void {
    if (!this.masterPassword) {
      throw new ServiceError(501, 'El panel general no está habilitado en este despliegue');
    }
    if (!this.checkMasterPassword(password)) {
      throw new ServiceError(403, 'Contraseña incorrecta');
    }
  }

  /** Todas las salas con sus números, para el panel general. */
  async listRooms(): Promise<
    Array<{
      code: string;
      title: string;
      closed: boolean;
      createdAt: number;
      adminKey: string;
      questionCount: number;
      pendingCount: number;
    }>
  > {
    const rooms = await this.repository.listRooms();
    return Promise.all(
      rooms.map(async (room) => {
        const stats = await this.getStats(room);
        return {
          code: room.code,
          title: room.title,
          closed: room.closed,
          createdAt: room.createdAt,
          adminKey: room.adminKey,
          questionCount: stats.questionCount,
          pendingCount: stats.pendingCount,
        };
      }),
    );
  }

  /**
   * Las clases abiertas, para que el alumno elija sin tener que tipear código.
   *
   * Devuelve lo mínimo —código, nombre y fecha— y nunca la clave de admin:
   * esto lo sirve una ruta pública, así que lo que salga de acá lo puede leer
   * cualquiera que abra la portada. Tampoco calcula estadísticas: es la
   * consulta más pedida de la app y no vale la pena recorrer las preguntas de
   * cada sala para adornar un listado.
   *
   * Las salas cerradas no se listan: una clase terminada no es un lugar al que
   * ofrecerle entrar a nadie.
   */
  async listOpenRooms(): Promise<Array<{ code: string; title: string; createdAt: number }>> {
    const rooms = await this.repository.listRooms();
    return rooms
      .filter((room) => !room.closed)
      .map((room) => ({ code: room.code, title: room.title, createdAt: room.createdAt }));
  }

  // ---------------------------------------------------------------- salas

  async createRoom(title: string): Promise<{ room: Room; adminKey: string }> {
    const cleanTitle = title.trim().slice(0, MAX_TITLE_LENGTH) || 'Clase sin título';
    const code = await generateRoomCode((candidate) => this.repository.isRoomCodeTaken(candidate));

    const room: Room = {
      id: newId(),
      code,
      title: cleanTitle,
      adminKey: generateAdminKey(),
      threshold: DEFAULT_THRESHOLD,
      closed: false,
      createdAt: Date.now(),
    };
    await this.repository.createRoom(room);
    return { room, adminKey: room.adminKey };
  }

  async getRoomByCode(code: string): Promise<Room> {
    const room = await this.repository.getRoomByCode(code.trim().toUpperCase());
    if (!room) throw new ServiceError(404, 'No existe una sala con ese código');
    return room;
  }

  /**
   * Valida el acceso al panel de una sala y la devuelve.
   *
   * Se entra de dos formas: con la clave propia de la sala (la que se guarda al
   * crearla y se puede compartir con un ayudante) o con la contraseña del panel
   * general, que abre todas.
   */
  async requireAdmin(
    code: string,
    adminKey: string | undefined,
    masterPassword?: string,
  ): Promise<Room> {
    return this.requireAdminOn(await this.getRoomByCode(code), adminKey, masterPassword);
  }

  /**
   * Igual que `requireAdmin`, pero sobre una sala ya leída.
   *
   * Existe para que quien tenga que contar los intentos fallidos pueda separar
   * "no existe la sala" (404) de "la credencial no sirve" (403): con la sala ya
   * en la mano, lo único que puede fallar acá es la credencial.
   */
  requireAdminOn(room: Room, adminKey: string | undefined, masterPassword?: string): Room {
    if (this.checkMasterPassword(masterPassword)) return room;
    if (!adminKey || !secretsMatch(adminKey, room.adminKey)) {
      throw new ServiceError(403, 'Clave de administrador inválida');
    }
    return room;
  }

  async updateRoom(
    room: Room,
    changes: { title?: string; closed?: boolean; threshold?: number },
  ): Promise<Room> {
    let title: string | undefined;
    if (changes.title !== undefined) {
      const cleanTitle = changes.title.trim().slice(0, MAX_TITLE_LENGTH);
      if (cleanTitle) title = cleanTitle;
    }
    if (changes.threshold !== undefined) {
      if (
        !Number.isFinite(changes.threshold) ||
        changes.threshold < 0.15 ||
        changes.threshold > 0.9
      ) {
        throw new ServiceError(400, 'El umbral debe estar entre 0.15 y 0.9');
      }
    }
    return this.repository.updateRoom(room.id, {
      title,
      closed: changes.closed,
      threshold: changes.threshold,
    });
  }

  // ------------------------------------------------------------ preguntas

  /**
   * Registra una pregunta y la asigna al grupo que le corresponda.
   * Si ninguna similitud supera el umbral de la sala, abre un tema nuevo.
   */
  async addQuestion(
    room: Room,
    input: { text: string; author: string; voterId: string },
  ): Promise<{
    question: Question;
    cluster: Cluster;
    isNewCluster: boolean;
    score: number;
    /** Qué señal decidió el agrupamiento. Sirve para ver si Claude actuó. */
    groupedBy: 'claude' | 'palabras' | 'tema-nuevo';
  }> {
    if (room.closed) {
      throw new ServiceError(409, 'La sala está cerrada: ya no se aceptan preguntas');
    }

    const text = input.text.trim().replace(/\s+/g, ' ').slice(0, MAX_QUESTION_LENGTH);
    if (text.length < 3) {
      throw new ServiceError(400, 'La pregunta es demasiado corta');
    }
    // El nombre es obligatorio: cada pregunta lleva la firma de quien la hizo.
    const author = normalizeAuthor(input.author);
    const voterId = input.voterId.trim();
    if (!voterId) throw new ServiceError(400, 'Falta el identificador del participante');

    // Límite por participante, contado contra la base para que valga aunque la
    // petición caiga en otra instancia serverless.
    const { questions: existentes } = await this.repository.getBoardData(room.id);
    const haceUnMinuto = Date.now() - 60_000;
    const recientes = existentes.filter(
      (question) => question.voterId === voterId && question.createdAt > haceUnMinuto,
    ).length;
    if (recientes >= MAX_QUESTIONS_PER_MINUTE) {
      throw new ServiceError(429, 'Estás enviando preguntas muy seguido. Esperá un momento.');
    }

    // Las dos consultas externas van en paralelo: una espera, no dos.
    const [embedding, preferredClusterId] = await Promise.all([
      this.embed(text),
      this.preselectTopic(room, text),
    ]);

    const result = await this.repository.addQuestion(
      { roomId: room.id, text, author, voterId, embedding, preferredClusterId },
      (candidates) =>
        findBestCluster(text, candidates, {
          threshold: room.threshold,
          embedding,
          semanticThreshold: this.semanticThreshold,
        }),
    );

    // Si el tema es el que eligió el clasificador, fue él quien decidió.
    const porClaude =
      preferredClusterId !== null && result.cluster.id === preferredClusterId;
    return {
      ...result,
      groupedBy: result.isNewCluster ? 'tema-nuevo' : porClaude ? 'claude' : 'palabras',
    };
  }

  /** Alterna el voto de un participante sobre una pregunta. */
  async toggleUpvote(
    room: Room,
    questionId: string,
    voterId: string,
  ): Promise<{ upvotes: number; voted: boolean }> {
    if (room.closed) throw new ServiceError(409, 'La sala está cerrada');
    if (!voterId) throw new ServiceError(400, 'Falta el identificador del participante');

    const question = await this.repository.getQuestion(room.id, questionId);
    if (!question) throw new ServiceError(404, 'No existe esa pregunta');
    if (question.voterId === voterId) {
      throw new ServiceError(400, 'No podés votar tu propia pregunta');
    }
    return this.repository.toggleVote(room.id, questionId, voterId);
  }

  /** Oculta una pregunta (moderación). No se borra, para poder revisarla luego. */
  async hideQuestion(room: Room, questionId: string): Promise<void> {
    const question = await this.repository.getQuestion(room.id, questionId);
    if (!question) throw new ServiceError(404, 'No existe esa pregunta');
    await this.repository.hideQuestion(room.id, questionId);
  }

  /** Saca una pregunta de su grupo y le abre un tema propio. */
  async splitQuestion(room: Room, questionId: string): Promise<Cluster> {
    const question = await this.repository.getQuestion(room.id, questionId);
    if (!question) throw new ServiceError(404, 'No existe esa pregunta');

    const board = await this.repository.getBoardData(room.id);
    const siblings = board.questions.filter((item) => item.clusterId === question.clusterId);
    if (siblings.length <= 1) {
      throw new ServiceError(400, 'La pregunta ya es el único tema de su grupo');
    }

    const cluster: Cluster = {
      id: newId(),
      roomId: room.id,
      label: question.text,
      status: 'pending',
      note: '',
      createdAt: Date.now(),
      answeredAt: null,
    };
    return this.repository.splitQuestion(room.id, questionId, cluster);
  }

  // -------------------------------------------------------------- grupos

  async updateCluster(
    room: Room,
    clusterId: string,
    changes: { status?: ClusterStatus; label?: string; note?: string },
  ): Promise<Cluster> {
    const cluster = await this.repository.getCluster(room.id, clusterId);
    if (!cluster) throw new ServiceError(404, 'No existe ese grupo');

    let label: string | undefined;
    if (changes.label !== undefined) {
      const clean = changes.label.trim().slice(0, MAX_QUESTION_LENGTH);
      if (clean) label = clean;
    }
    const note =
      changes.note === undefined ? undefined : changes.note.trim().slice(0, MAX_QUESTION_LENGTH);

    return this.repository.updateCluster(room.id, clusterId, {
      status: changes.status,
      label,
      note,
    });
  }

  /** Fusiona dos grupos que en realidad son el mismo tema. */
  async mergeClusters(room: Room, sourceId: string, targetId: string): Promise<Cluster> {
    if (sourceId === targetId) {
      throw new ServiceError(400, 'No se puede fusionar un grupo consigo mismo');
    }
    const source = await this.repository.getCluster(room.id, sourceId);
    const target = await this.repository.getCluster(room.id, targetId);
    if (!source || !target) throw new ServiceError(404, 'No existe alguno de los grupos');

    return this.repository.mergeClusters(room.id, sourceId, targetId);
  }

  // ------------------------------------------------------------- ranking

  /**
   * Tablero de la sala, ordenado por demanda.
   *
   * El puntaje suma una unidad por cada persona que quiere ese tema: quien lo
   * preguntó (aunque haya reformulado) más quien votó una de esas preguntas.
   * Los temas ya respondidos o descartados caen al final.
   */
  async getBoard(room: Room, viewerId: string): Promise<RankedCluster[]> {
    const { clusters, questions } = await this.repository.getBoardData(room.id);

    const byCluster = new Map<string, Question[]>();
    for (const question of questions) {
      const list = byCluster.get(question.clusterId) ?? [];
      list.push(question);
      byCluster.set(question.clusterId, list);
    }

    const ranked: RankedCluster[] = [];
    for (const cluster of clusters) {
      const members = byCluster.get(cluster.id) ?? [];
      if (members.length === 0) continue;

      const upvotes = members.reduce((total, question) => total + question.upvotes.length, 0);
      const lastActivityAt = members.reduce(
        (latest, question) => Math.max(latest, question.createdAt),
        cluster.createdAt,
      );

      const publicQuestions: PublicQuestion[] = members
        .slice()
        .sort((a, b) => b.upvotes.length - a.upvotes.length || a.createdAt - b.createdAt)
        .map((question) => ({
          id: question.id,
          text: question.text,
          author: question.author,
          upvotes: question.upvotes.length,
          createdAt: question.createdAt,
          votedByMe: question.upvotes.includes(viewerId),
          mine: question.voterId === viewerId,
        }));

      ranked.push({
        id: cluster.id,
        label: cluster.label,
        status: cluster.status,
        note: cluster.note,
        questionCount: members.length,
        upvotes,
        score: members.length + upvotes,
        createdAt: cluster.createdAt,
        lastActivityAt,
        answeredAt: cluster.answeredAt,
        questions: publicQuestions,
      });
    }

    const statusRank: Record<ClusterStatus, number> = {
      answering: 0,
      pending: 1,
      answered: 2,
      discarded: 3,
    };

    return ranked.sort((a, b) => {
      const byStatus = statusRank[a.status] - statusRank[b.status];
      if (byStatus !== 0) return byStatus;
      if (b.score !== a.score) return b.score - a.score;
      return b.lastActivityAt - a.lastActivityAt;
    });
  }

  /**
   * Borra una clase con todo lo que juntó.
   *
   * No hay papelera ni borrado lógico: una clase terminada no tiene por qué
   * quedar ocupando lugar, y guardar preguntas de alumnos "por las dudas" es
   * justamente lo que no corresponde hacer con datos que ya no se usan.
   */
  async deleteRoom(room: Room): Promise<void> {
    await this.repository.deleteRoom(room.id);
  }

  // ------------------------------------------------- consignas del docente

  /**
   * Lanza una consigna a la clase. Cierra automáticamente la anterior: la
   * pantalla del alumno muestra una sola, la que está viva ahora.
   */
  async createPrompt(room: Room, text: string): Promise<Prompt> {
    if (room.closed) {
      throw new ServiceError(409, 'La sala está cerrada: no se puede lanzar una pregunta');
    }
    const clean = text.trim().replace(/\s+/g, ' ').slice(0, MAX_PROMPT_LENGTH);
    if (clean.length < 3) {
      throw new ServiceError(400, 'Escribí la pregunta que querés hacerle a la clase');
    }
    return this.repository.createPrompt({
      id: newId(),
      roomId: room.id,
      text: clean,
      closed: false,
      createdAt: Date.now(),
      closedAt: null,
    });
  }

  async setPromptClosed(room: Room, promptId: string, closed: boolean): Promise<Prompt> {
    await this.requirePrompt(room, promptId);
    return this.repository.updatePrompt(room.id, promptId, { closed });
  }

  async deletePrompt(room: Room, promptId: string): Promise<void> {
    await this.requirePrompt(room, promptId);
    await this.repository.deletePrompt(room.id, promptId);
  }

  async hideAnswer(room: Room, answerId: string): Promise<void> {
    await this.repository.hideAnswer(room.id, answerId).catch(() => {
      throw new ServiceError(404, 'Respuesta inexistente');
    });
  }

  private async requirePrompt(room: Room, promptId: string): Promise<Prompt> {
    const prompt = await this.repository.getPrompt(room.id, promptId);
    if (!prompt) throw new ServiceError(404, 'Esa pregunta del docente no existe');
    return prompt;
  }

  /** Registra la respuesta de un alumno a la consigna vigente. */
  async answerPrompt(
    room: Room,
    promptId: string,
    input: { text: string; author: string; voterId: string },
  ): Promise<Answer> {
    if (room.closed) {
      throw new ServiceError(409, 'La sala está cerrada: ya no se aceptan respuestas');
    }
    const prompt = await this.requirePrompt(room, promptId);
    if (prompt.closed) {
      throw new ServiceError(409, 'El docente cerró esta pregunta: ya no se aceptan respuestas');
    }

    const text = input.text.trim().replace(/\s+/g, ' ').slice(0, MAX_ANSWER_LENGTH);
    if (text.length === 0) throw new ServiceError(400, 'Escribí tu respuesta');
    const author = normalizeAuthor(input.author);
    const voterId = input.voterId.trim();
    if (!voterId) throw new ServiceError(400, 'Falta el identificador del participante');

    return this.repository.saveAnswer({
      id: newId(),
      promptId: prompt.id,
      roomId: room.id,
      text,
      author,
      voterId,
      createdAt: Date.now(),
      hidden: false,
    });
  }

  /**
   * La consigna vigente tal como la ve un alumno.
   *
   * Las respuestas ajenas se entregan sólo si el visitante ya respondió o si la
   * consigna está cerrada. Ver lo que contestaron los demás antes de escribir
   * convierte la consigna en un ejercicio de copiar al primero.
   */
  async getLivePrompt(room: Room, viewerId: string): Promise<LivePrompt | null> {
    const { prompts, answers } = await this.repository.getPromptData(room.id);
    const prompt = prompts[0];
    if (!prompt) return null;

    const suyas = answers.filter((answer) => answer.promptId === prompt.id);
    const mia = suyas.find((answer) => answer.voterId === viewerId) ?? null;
    const puedeVer = mia !== null || prompt.closed;

    return {
      id: prompt.id,
      text: prompt.text,
      closed: prompt.closed,
      createdAt: prompt.createdAt,
      answerCount: suyas.length,
      myAnswer: mia?.text ?? null,
      answers: puedeVer ? suyas.map((answer) => toPublicAnswer(answer, viewerId)) : [],
    };
  }

  /** Todas las consignas con sus respuestas, para el panel del docente. */
  async getPromptsForAdmin(room: Room): Promise<AdminPrompt[]> {
    const { prompts, answers } = await this.repository.getPromptData(room.id);
    return prompts.map((prompt) => {
      const suyas = answers.filter((answer) => answer.promptId === prompt.id);
      return {
        id: prompt.id,
        text: prompt.text,
        closed: prompt.closed,
        createdAt: prompt.createdAt,
        closedAt: prompt.closedAt,
        answerCount: suyas.length,
        answers: suyas.map((answer) => toPublicAnswer(answer, '')),
      };
    });
  }

  /** Números de cabecera para el panel del docente. */
  async getStats(room: Room): Promise<{
    questionCount: number;
    clusterCount: number;
    pendingCount: number;
    answeredCount: number;
    participants: number;
  }> {
    const { clusters, questions } = await this.repository.getBoardData(room.id);

    const activeClusterIds = new Set(questions.map((question) => question.clusterId));
    const participants = new Set(questions.map((question) => question.voterId));
    for (const question of questions) {
      for (const voter of question.upvotes) participants.add(voter);
    }

    return {
      questionCount: questions.length,
      clusterCount: clusters.filter((cluster) => activeClusterIds.has(cluster.id)).length,
      pendingCount: clusters.filter(
        (cluster) =>
          activeClusterIds.has(cluster.id) &&
          (cluster.status === 'pending' || cluster.status === 'answering'),
      ).length,
      answeredCount: clusters.filter(
        (cluster) => activeClusterIds.has(cluster.id) && cluster.status === 'answered',
      ).length,
      participants: participants.size,
    };
  }
}
