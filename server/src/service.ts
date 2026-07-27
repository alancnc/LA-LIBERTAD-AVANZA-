import { DEFAULT_THRESHOLD, findBestCluster } from './text/cluster.js';
import { generateAdminKey, generateRoomCode, newId } from './ids.js';
import type { Repository } from './repository/types.js';
import type {
  Cluster,
  ClusterStatus,
  PublicQuestion,
  Question,
  RankedCluster,
  Room,
} from './types.js';

export const MAX_QUESTION_LENGTH = 400;
export const MAX_AUTHOR_LENGTH = 40;
export const MAX_TITLE_LENGTH = 120;

export class ServiceError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

export class Service {
  constructor(private readonly repository: Repository) {}

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

  /** Valida la clave de administrador de una sala y devuelve la sala. */
  async requireAdmin(code: string, adminKey: string | undefined): Promise<Room> {
    const room = await this.getRoomByCode(code);
    if (!adminKey || adminKey !== room.adminKey) {
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
  ): Promise<{ question: Question; cluster: Cluster; isNewCluster: boolean; score: number }> {
    if (room.closed) {
      throw new ServiceError(409, 'La sala está cerrada: ya no se aceptan preguntas');
    }

    const text = input.text.trim().replace(/\s+/g, ' ').slice(0, MAX_QUESTION_LENGTH);
    if (text.length < 3) {
      throw new ServiceError(400, 'La pregunta es demasiado corta');
    }
    const author = input.author.trim().slice(0, MAX_AUTHOR_LENGTH) || 'Anónimo';
    const voterId = input.voterId.trim();
    if (!voterId) throw new ServiceError(400, 'Falta el identificador del participante');

    return this.repository.addQuestion({ roomId: room.id, text, author, voterId }, (candidates) =>
      findBestCluster(text, candidates, room.threshold),
    );
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
