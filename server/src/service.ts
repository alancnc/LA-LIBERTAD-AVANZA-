import { DEFAULT_THRESHOLD, findBestCluster, type ClusterCandidate } from './text/cluster.js';
import { generateAdminKey, generateRoomCode, newId, type Store } from './store.js';
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
  constructor(private readonly store: Store) {}

  // ---------------------------------------------------------------- salas

  createRoom(title: string): { room: Room; adminKey: string } {
    const cleanTitle = title.trim().slice(0, MAX_TITLE_LENGTH) || 'Clase sin título';
    return this.store.update((data) => {
      const code = generateRoomCode((candidate) =>
        data.rooms.some((room) => room.code === candidate),
      );
      const room: Room = {
        id: newId(),
        code,
        title: cleanTitle,
        adminKey: generateAdminKey(),
        threshold: DEFAULT_THRESHOLD,
        closed: false,
        createdAt: Date.now(),
      };
      data.rooms.push(room);
      return { room, adminKey: room.adminKey };
    });
  }

  getRoomByCode(code: string): Room {
    const normalized = code.trim().toUpperCase();
    const room = this.store.read().rooms.find((item) => item.code === normalized);
    if (!room) throw new ServiceError(404, 'No existe una sala con ese código');
    return room;
  }

  /** Valida la clave de administrador de una sala y devuelve la sala. */
  requireAdmin(code: string, adminKey: string | undefined): Room {
    const room = this.getRoomByCode(code);
    if (!adminKey || adminKey !== room.adminKey) {
      throw new ServiceError(403, 'Clave de administrador inválida');
    }
    return room;
  }

  updateRoom(
    room: Room,
    changes: { title?: string; closed?: boolean; threshold?: number },
  ): Room {
    return this.store.update((data) => {
      const target = data.rooms.find((item) => item.id === room.id)!;
      if (changes.title !== undefined) {
        const cleanTitle = changes.title.trim().slice(0, MAX_TITLE_LENGTH);
        if (cleanTitle) target.title = cleanTitle;
      }
      if (changes.closed !== undefined) target.closed = changes.closed;
      if (changes.threshold !== undefined) {
        if (
          !Number.isFinite(changes.threshold) ||
          changes.threshold < 0.15 ||
          changes.threshold > 0.9
        ) {
          throw new ServiceError(400, 'El umbral debe estar entre 0.15 y 0.9');
        }
        target.threshold = changes.threshold;
      }
      return target;
    });
  }

  // ------------------------------------------------------------ preguntas

  /**
   * Registra una pregunta y la asigna al grupo que le corresponda.
   * Si ninguna similitud supera el umbral de la sala, abre un tema nuevo.
   */
  addQuestion(
    room: Room,
    input: { text: string; author: string; voterId: string },
  ): { question: Question; cluster: Cluster; isNewCluster: boolean; score: number } {
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

    return this.store.update((data) => {
      const roomQuestions = data.questions.filter(
        (question) => question.roomId === room.id && !question.hidden,
      );
      const roomClusters = data.clusters.filter((cluster) => cluster.roomId === room.id);

      const candidates: ClusterCandidate[] = roomClusters
        // Un tema ya respondido o descartado no debería absorber preguntas nuevas:
        // si vuelven a preguntar lo mismo, el docente necesita verlo de nuevo.
        .filter((cluster) => cluster.status === 'pending' || cluster.status === 'answering')
        .map((cluster) => ({
          clusterId: cluster.id,
          texts: roomQuestions
            .filter((question) => question.clusterId === cluster.id)
            .map((question) => question.text),
        }))
        .filter((candidate) => candidate.texts.length > 0);

      const match = findBestCluster(text, candidates, room.threshold);

      let cluster: Cluster;
      let isNewCluster = false;
      if (match.clusterId) {
        cluster = data.clusters.find((item) => item.id === match.clusterId)!;
      } else {
        cluster = {
          id: newId(),
          roomId: room.id,
          label: text,
          status: 'pending',
          note: '',
          createdAt: Date.now(),
          answeredAt: null,
        };
        data.clusters.push(cluster);
        isNewCluster = true;
      }

      const question: Question = {
        id: newId(),
        roomId: room.id,
        clusterId: cluster.id,
        text,
        author,
        voterId,
        upvotes: [],
        createdAt: Date.now(),
        hidden: false,
      };
      data.questions.push(question);

      return { question, cluster, isNewCluster, score: match.score };
    });
  }

  /** Alterna el voto de un participante sobre una pregunta. */
  toggleUpvote(room: Room, questionId: string, voterId: string): { upvotes: number; voted: boolean } {
    if (room.closed) throw new ServiceError(409, 'La sala está cerrada');
    if (!voterId) throw new ServiceError(400, 'Falta el identificador del participante');

    return this.store.update((data) => {
      const question = data.questions.find(
        (item) => item.id === questionId && item.roomId === room.id,
      );
      if (!question) throw new ServiceError(404, 'No existe esa pregunta');
      if (question.voterId === voterId) {
        throw new ServiceError(400, 'No podés votar tu propia pregunta');
      }

      const index = question.upvotes.indexOf(voterId);
      if (index >= 0) {
        question.upvotes.splice(index, 1);
        return { upvotes: question.upvotes.length, voted: false };
      }
      question.upvotes.push(voterId);
      return { upvotes: question.upvotes.length, voted: true };
    });
  }

  /** Oculta una pregunta (moderación). No se borra, para poder revisarla luego. */
  hideQuestion(room: Room, questionId: string): void {
    this.store.update((data) => {
      const question = data.questions.find(
        (item) => item.id === questionId && item.roomId === room.id,
      );
      if (!question) throw new ServiceError(404, 'No existe esa pregunta');
      question.hidden = true;
    });
  }

  /** Saca una pregunta de su grupo y le abre un tema propio. */
  splitQuestion(room: Room, questionId: string): Cluster {
    return this.store.update((data) => {
      const question = data.questions.find(
        (item) => item.id === questionId && item.roomId === room.id,
      );
      if (!question) throw new ServiceError(404, 'No existe esa pregunta');

      const siblings = data.questions.filter(
        (item) => item.clusterId === question.clusterId && !item.hidden,
      );
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
      data.clusters.push(cluster);
      question.clusterId = cluster.id;
      return cluster;
    });
  }

  // -------------------------------------------------------------- grupos

  updateCluster(
    room: Room,
    clusterId: string,
    changes: { status?: ClusterStatus; label?: string; note?: string },
  ): Cluster {
    return this.store.update((data) => {
      const cluster = data.clusters.find(
        (item) => item.id === clusterId && item.roomId === room.id,
      );
      if (!cluster) throw new ServiceError(404, 'No existe ese grupo');

      if (changes.status !== undefined) {
        cluster.status = changes.status;
        cluster.answeredAt = changes.status === 'answered' ? Date.now() : null;
      }
      if (changes.label !== undefined) {
        const label = changes.label.trim().slice(0, MAX_QUESTION_LENGTH);
        if (label) cluster.label = label;
      }
      if (changes.note !== undefined) {
        cluster.note = changes.note.trim().slice(0, MAX_QUESTION_LENGTH);
      }
      return cluster;
    });
  }

  /** Fusiona dos grupos que en realidad son el mismo tema. */
  mergeClusters(room: Room, sourceId: string, targetId: string): Cluster {
    if (sourceId === targetId) {
      throw new ServiceError(400, 'No se puede fusionar un grupo consigo mismo');
    }
    return this.store.update((data) => {
      const source = data.clusters.find(
        (item) => item.id === sourceId && item.roomId === room.id,
      );
      const target = data.clusters.find(
        (item) => item.id === targetId && item.roomId === room.id,
      );
      if (!source || !target) throw new ServiceError(404, 'No existe alguno de los grupos');

      for (const question of data.questions) {
        if (question.clusterId === source.id) question.clusterId = target.id;
      }
      data.clusters = data.clusters.filter((item) => item.id !== source.id);
      return target;
    });
  }

  // ------------------------------------------------------------- ranking

  /**
   * Tablero de la sala, ordenado por demanda.
   *
   * El puntaje suma una unidad por cada persona que quiere ese tema: quien lo
   * preguntó (aunque haya reformulado) más quien votó una de esas preguntas.
   * Los temas ya respondidos o descartados caen al final.
   */
  getBoard(room: Room, viewerId: string): RankedCluster[] {
    const data = this.store.read();
    const questions = data.questions.filter(
      (question) => question.roomId === room.id && !question.hidden,
    );
    const clusters = data.clusters.filter((cluster) => cluster.roomId === room.id);

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
  getStats(room: Room): {
    questionCount: number;
    clusterCount: number;
    pendingCount: number;
    answeredCount: number;
    participants: number;
  } {
    const data = this.store.read();
    const questions = data.questions.filter(
      (question) => question.roomId === room.id && !question.hidden,
    );
    const clusters = data.clusters.filter((cluster) => cluster.roomId === room.id);
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
