import fs from 'node:fs';
import path from 'node:path';
import { newId } from '../ids.js';
import type {
  Answer,
  Cluster,
  ClusterStatus,
  Database,
  Prompt,
  Question,
  Room,
} from '../types.js';
import type {
  BoardData,
  ClusterWithTexts,
  CreatedQuestion,
  CreateQuestionInput,
  PromptData,
  Repository,
} from './types.js';

const EMPTY_DB: Database = { rooms: [], clusters: [], questions: [], prompts: [], answers: [] };

/**
 * Repositorio respaldado por un único archivo JSON (o sólo memoria).
 *
 * Es el que se usa en desarrollo, en los tests y en cualquier despliegue de un
 * solo proceso. No sirve para serverless: el disco de una función no sobrevive
 * entre invocaciones. Para eso está `PostgresRepository`.
 */
export class JsonRepository implements Repository {
  private data: Database = structuredClone(EMPTY_DB);
  private writeScheduled = false;

  /** `file: null` mantiene todo en memoria (se usa en los tests). */
  constructor(private readonly file: string | null) {}

  async init(): Promise<void> {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Database>;
      this.data = {
        rooms: parsed.rooms ?? [],
        clusters: parsed.clusters ?? [],
        questions: parsed.questions ?? [],
        // Un archivo escrito por una versión anterior no tiene estas dos, y sus
        // consignas no tienen `options`: se completan para no arrastrar
        // `undefined` por el resto del código.
        prompts: (parsed.prompts ?? []).map((prompt) => ({
          ...prompt,
          options: prompt.options ?? [],
        })),
        answers: parsed.answers ?? [],
      };
    } catch (error) {
      // Un archivo corrupto no debe impedir que arranque el servidor: se
      // preserva a un lado para poder inspeccionarlo y se empieza limpio.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, backup);
      console.error(`No se pudo leer la base, se movió a ${backup}:`, error);
      this.data = structuredClone(EMPTY_DB);
    }
  }

  /**
   * Vuelca la base al disco. Se agrupa en un microtask para que una operación
   * que toca varias tablas escriba una sola vez, y se hace vía archivo temporal
   * + rename para que nunca quede un JSON a medio escribir.
   */
  private persist(): void {
    if (!this.file || this.writeScheduled) return;
    this.writeScheduled = true;
    queueMicrotask(() => {
      this.writeScheduled = false;
      if (!this.file) return;
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(temp, this.file);
    });
  }

  async createRoom(room: Room): Promise<Room> {
    this.data.rooms.push(room);
    this.persist();
    return room;
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    return this.data.rooms.find((room) => room.code === code) ?? null;
  }

  async listRooms(): Promise<Room[]> {
    return [...this.data.rooms].sort((a, b) => b.createdAt - a.createdAt);
  }

  async isRoomCodeTaken(code: string): Promise<boolean> {
    return this.data.rooms.some((room) => room.code === code);
  }

  async updateRoom(
    roomId: string,
    changes: { title?: string; closed?: boolean; threshold?: number },
  ): Promise<Room> {
    const room = this.data.rooms.find((item) => item.id === roomId);
    if (!room) throw new Error(`Sala inexistente: ${roomId}`);
    if (changes.title !== undefined) room.title = changes.title;
    if (changes.closed !== undefined) room.closed = changes.closed;
    if (changes.threshold !== undefined) room.threshold = changes.threshold;
    this.persist();
    return room;
  }

  async deleteRoom(roomId: string): Promise<void> {
    const room = this.data.rooms.find((item) => item.id === roomId);
    if (!room) throw new Error(`Sala inexistente: ${roomId}`);
    this.data.rooms = this.data.rooms.filter((item) => item.id !== roomId);
    this.data.clusters = this.data.clusters.filter((item) => item.roomId !== roomId);
    this.data.questions = this.data.questions.filter((item) => item.roomId !== roomId);
    this.data.prompts = this.data.prompts.filter((item) => item.roomId !== roomId);
    this.data.answers = this.data.answers.filter((item) => item.roomId !== roomId);
    this.persist();
  }

  async addQuestion(
    input: CreateQuestionInput,
    assign: (candidates: ClusterWithTexts[]) => { clusterId: string | null; score: number },
  ): Promise<CreatedQuestion> {
    const visible = this.data.questions.filter(
      (question) => question.roomId === input.roomId && !question.hidden,
    );

    const candidates: ClusterWithTexts[] = this.data.clusters
      .filter(
        (cluster) =>
          cluster.roomId === input.roomId &&
          // Un tema ya respondido o descartado no debería absorber preguntas
          // nuevas: si vuelven a preguntar lo mismo, hay que verlo de nuevo.
          (cluster.status === 'pending' || cluster.status === 'answering'),
      )
      .map((cluster) => {
        const miembros = visible.filter((question) => question.clusterId === cluster.id);
        return {
          clusterId: cluster.id,
          texts: miembros.map((question) => question.text),
          embeddings: miembros.map((question) => question.embedding ?? null),
        };
      })
      .filter((candidate) => candidate.texts.length > 0);

    // Un tema preseleccionado sólo vale si sigue siendo candidato válido.
    const preferido = input.preferredClusterId
      ? candidates.find((c) => c.clusterId === input.preferredClusterId)
      : undefined;
    const match = preferido
      ? { clusterId: preferido.clusterId, score: 1 }
      : assign(candidates);

    let cluster: Cluster;
    let isNewCluster = false;
    if (match.clusterId) {
      cluster = this.data.clusters.find((item) => item.id === match.clusterId)!;
    } else {
      cluster = {
        id: newId(),
        roomId: input.roomId,
        label: input.text,
        status: 'pending',
        note: '',
        createdAt: Date.now(),
        answeredAt: null,
      };
      this.data.clusters.push(cluster);
      isNewCluster = true;
    }

    const question: Question = {
      id: newId(),
      roomId: input.roomId,
      clusterId: cluster.id,
      text: input.text,
      author: input.author,
      voterId: input.voterId,
      upvotes: [],
      createdAt: Date.now(),
      hidden: false,
      embedding: input.embedding,
    };
    this.data.questions.push(question);
    this.persist();

    return { question, cluster, isNewCluster, score: match.score };
  }

  async getQuestion(roomId: string, questionId: string): Promise<Question | null> {
    return (
      this.data.questions.find(
        (question) => question.id === questionId && question.roomId === roomId,
      ) ?? null
    );
  }

  async hideQuestion(roomId: string, questionId: string): Promise<void> {
    const question = await this.getQuestion(roomId, questionId);
    if (!question) throw new Error('Pregunta inexistente');
    question.hidden = true;
    this.persist();
  }

  async splitQuestion(roomId: string, questionId: string, cluster: Cluster): Promise<Cluster> {
    const question = await this.getQuestion(roomId, questionId);
    if (!question) throw new Error('Pregunta inexistente');
    this.data.clusters.push(cluster);
    question.clusterId = cluster.id;
    this.persist();
    return cluster;
  }

  async toggleVote(
    roomId: string,
    questionId: string,
    voterId: string,
  ): Promise<{ upvotes: number; voted: boolean }> {
    const question = await this.getQuestion(roomId, questionId);
    if (!question) throw new Error('Pregunta inexistente');

    const index = question.upvotes.indexOf(voterId);
    if (index >= 0) {
      question.upvotes.splice(index, 1);
    } else {
      question.upvotes.push(voterId);
    }
    this.persist();
    return { upvotes: question.upvotes.length, voted: index < 0 };
  }

  async getCluster(roomId: string, clusterId: string): Promise<Cluster | null> {
    return (
      this.data.clusters.find(
        (cluster) => cluster.id === clusterId && cluster.roomId === roomId,
      ) ?? null
    );
  }

  async updateCluster(
    roomId: string,
    clusterId: string,
    changes: { status?: ClusterStatus; label?: string; note?: string },
  ): Promise<Cluster> {
    const cluster = await this.getCluster(roomId, clusterId);
    if (!cluster) throw new Error('Grupo inexistente');
    if (changes.status !== undefined) {
      cluster.status = changes.status;
      cluster.answeredAt = changes.status === 'answered' ? Date.now() : null;
    }
    if (changes.label !== undefined) cluster.label = changes.label;
    if (changes.note !== undefined) cluster.note = changes.note;
    this.persist();
    return cluster;
  }

  async mergeClusters(roomId: string, sourceId: string, targetId: string): Promise<Cluster> {
    const source = await this.getCluster(roomId, sourceId);
    const target = await this.getCluster(roomId, targetId);
    if (!source || !target) throw new Error('Grupo inexistente');

    for (const question of this.data.questions) {
      if (question.clusterId === source.id) question.clusterId = target.id;
    }
    this.data.clusters = this.data.clusters.filter((cluster) => cluster.id !== source.id);
    this.persist();
    return target;
  }

  async getBoardData(roomId: string): Promise<BoardData> {
    return {
      clusters: this.data.clusters.filter((cluster) => cluster.roomId === roomId),
      questions: this.data.questions.filter(
        (question) => question.roomId === roomId && !question.hidden,
      ),
    };
  }

  // ------------------------------------------------- consignas del docente

  async createPrompt(prompt: Prompt): Promise<Prompt> {
    const ahora = Date.now();
    for (const anterior of this.data.prompts) {
      if (anterior.roomId === prompt.roomId && !anterior.closed) {
        anterior.closed = true;
        anterior.closedAt = ahora;
      }
    }
    this.data.prompts.push(prompt);
    this.persist();
    return prompt;
  }

  async getPrompt(roomId: string, promptId: string): Promise<Prompt | null> {
    return (
      this.data.prompts.find((prompt) => prompt.id === promptId && prompt.roomId === roomId) ??
      null
    );
  }

  async updatePrompt(
    roomId: string,
    promptId: string,
    changes: { closed?: boolean },
  ): Promise<Prompt> {
    const prompt = await this.getPrompt(roomId, promptId);
    if (!prompt) throw new Error('Consigna inexistente');
    if (changes.closed !== undefined) {
      prompt.closed = changes.closed;
      prompt.closedAt = changes.closed ? Date.now() : null;
    }
    this.persist();
    return prompt;
  }

  async deletePrompt(roomId: string, promptId: string): Promise<void> {
    const prompt = await this.getPrompt(roomId, promptId);
    if (!prompt) throw new Error('Consigna inexistente');
    this.data.prompts = this.data.prompts.filter((item) => item.id !== promptId);
    this.data.answers = this.data.answers.filter((answer) => answer.promptId !== promptId);
    this.persist();
  }

  async saveAnswer(answer: Answer): Promise<Answer> {
    const previa = this.data.answers.find(
      (item) => item.promptId === answer.promptId && item.voterId === answer.voterId,
    );
    if (previa) {
      // Se conserva el id y el momento original: es la misma respuesta corregida,
      // no una nueva, y así no salta de lugar en la lista al reescribirla.
      previa.text = answer.text;
      previa.author = answer.author;
      previa.hidden = false;
      this.persist();
      return previa;
    }
    this.data.answers.push(answer);
    this.persist();
    return answer;
  }

  async hideAnswer(roomId: string, answerId: string): Promise<void> {
    const answer = this.data.answers.find(
      (item) => item.id === answerId && item.roomId === roomId,
    );
    if (!answer) throw new Error('Respuesta inexistente');
    answer.hidden = true;
    this.persist();
  }

  async getPromptData(roomId: string): Promise<PromptData> {
    return {
      prompts: this.data.prompts
        .filter((prompt) => prompt.roomId === roomId)
        .sort((a, b) => b.createdAt - a.createdAt),
      answers: this.data.answers.filter(
        (answer) => answer.roomId === roomId && !answer.hidden,
      ),
    };
  }

  async close(): Promise<void> {
    this.flushSync();
  }

  /** Fuerza la escritura pendiente (usado al apagar el proceso). */
  flushSync(): void {
    if (!this.file) return;
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }
}
