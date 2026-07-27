import pg from 'pg';
import { newId } from '../ids.js';
import type { Cluster, ClusterStatus, Question, Room } from '../types.js';
import type {
  BoardData,
  ClusterWithTexts,
  CreatedQuestion,
  CreateQuestionInput,
  Repository,
} from './types.js';

/**
 * Repositorio sobre Postgres, pensado para despliegues serverless (Vercel).
 *
 * Funciona con cualquier proveedor que dé una URL de conexión: Vercel Postgres,
 * Neon, Supabase o un Postgres propio.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  admin_key   TEXT NOT NULL,
  threshold   DOUBLE PRECISION NOT NULL,
  closed      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS clusters (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  status      TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  BIGINT NOT NULL,
  answered_at BIGINT
);

CREATE TABLE IF NOT EXISTS questions (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  cluster_id  TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  author      TEXT NOT NULL,
  voter_id    TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  hidden      BOOLEAN NOT NULL DEFAULT FALSE
);

-- Un voto por persona y pregunta: la unicidad la garantiza la clave primaria,
-- no la lógica de la aplicación.
CREATE TABLE IF NOT EXISTS votes (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  voter_id    TEXT NOT NULL,
  PRIMARY KEY (question_id, voter_id)
);

CREATE INDEX IF NOT EXISTS clusters_room_idx  ON clusters(room_id);
CREATE INDEX IF NOT EXISTS questions_room_idx ON questions(room_id);
CREATE INDEX IF NOT EXISTS questions_cluster_idx ON questions(cluster_id);
`;

interface RoomRow {
  id: string;
  code: string;
  title: string;
  admin_key: string;
  threshold: number;
  closed: boolean;
  created_at: string;
}

interface ClusterRow {
  id: string;
  room_id: string;
  label: string;
  status: string;
  note: string;
  created_at: string;
  answered_at: string | null;
}

interface QuestionRow {
  id: string;
  room_id: string;
  cluster_id: string;
  text: string;
  author: string;
  voter_id: string;
  created_at: string;
  hidden: boolean;
  upvotes: string[] | null;
}

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    adminKey: row.admin_key,
    threshold: Number(row.threshold),
    closed: row.closed,
    createdAt: Number(row.created_at),
  };
}

function toCluster(row: ClusterRow): Cluster {
  return {
    id: row.id,
    roomId: row.room_id,
    label: row.label,
    status: row.status as ClusterStatus,
    note: row.note,
    createdAt: Number(row.created_at),
    answeredAt: row.answered_at === null ? null : Number(row.answered_at),
  };
}

function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    roomId: row.room_id,
    clusterId: row.cluster_id,
    text: row.text,
    author: row.author,
    voterId: row.voter_id,
    upvotes: row.upvotes ?? [],
    createdAt: Number(row.created_at),
    hidden: row.hidden,
  };
}

export class PostgresRepository implements Repository {
  private readonly pool: pg.Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      // En serverless conviven muchas instancias efímeras: pocas conexiones por
      // instancia y cierre rápido de las ociosas para no agotar el servidor.
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: connectionString.includes('sslmode=disable')
        ? undefined
        : { rejectUnauthorized: false },
    });
  }

  /** Crea el esquema si falta. Idempotente y cacheado por instancia. */
  init(): Promise<void> {
    this.ready ??= this.pool.query(SCHEMA).then(() => undefined);
    return this.ready;
  }

  async createRoom(room: Room): Promise<Room> {
    await this.pool.query(
      `INSERT INTO rooms (id, code, title, admin_key, threshold, closed, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        room.id,
        room.code,
        room.title,
        room.adminKey,
        room.threshold,
        room.closed,
        room.createdAt,
      ],
    );
    return room;
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    const result = await this.pool.query<RoomRow>('SELECT * FROM rooms WHERE code = $1', [code]);
    return result.rows[0] ? toRoom(result.rows[0]) : null;
  }

  async isRoomCodeTaken(code: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM rooms WHERE code = $1', [code]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async updateRoom(
    roomId: string,
    changes: { title?: string; closed?: boolean; threshold?: number },
  ): Promise<Room> {
    const result = await this.pool.query<RoomRow>(
      `UPDATE rooms SET
         title     = COALESCE($2, title),
         closed    = COALESCE($3, closed),
         threshold = COALESCE($4, threshold)
       WHERE id = $1
       RETURNING *`,
      [roomId, changes.title ?? null, changes.closed ?? null, changes.threshold ?? null],
    );
    if (!result.rows[0]) throw new Error(`Sala inexistente: ${roomId}`);
    return toRoom(result.rows[0]);
  }

  /**
   * Inserta la pregunta dentro de una transacción que primero toma el lock de
   * la fila de la sala.
   *
   * Sin ese lock, dos alumnos preguntando lo mismo en el mismo instante leerían
   * ambos un estado sin el grupo del otro y crearían dos grupos duplicados. Con
   * el lock, las preguntas de una misma sala se procesan de a una; las de salas
   * distintas siguen en paralelo.
   */
  async addQuestion(
    input: CreateQuestionInput,
    assign: (candidates: ClusterWithTexts[]) => { clusterId: string | null; score: number },
  ): Promise<CreatedQuestion> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [input.roomId]);

      const candidateRows = await client.query<{ cluster_id: string; texts: string[] }>(
        `SELECT c.id AS cluster_id, array_agg(q.text ORDER BY q.created_at) AS texts
           FROM clusters c
           JOIN questions q ON q.cluster_id = c.id AND q.hidden = FALSE
          WHERE c.room_id = $1 AND c.status IN ('pending', 'answering')
          GROUP BY c.id`,
        [input.roomId],
      );

      const match = assign(
        candidateRows.rows.map((row) => ({ clusterId: row.cluster_id, texts: row.texts })),
      );

      let cluster: Cluster;
      let isNewCluster = false;
      if (match.clusterId) {
        const found = await client.query<ClusterRow>('SELECT * FROM clusters WHERE id = $1', [
          match.clusterId,
        ]);
        cluster = toCluster(found.rows[0]!);
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
        await client.query(
          `INSERT INTO clusters (id, room_id, label, status, note, created_at, answered_at)
           VALUES ($1, $2, $3, $4, '', $5, NULL)`,
          [cluster.id, cluster.roomId, cluster.label, cluster.status, cluster.createdAt],
        );
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
      };
      await client.query(
        `INSERT INTO questions
           (id, room_id, cluster_id, text, author, voter_id, created_at, hidden)
         VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)`,
        [
          question.id,
          question.roomId,
          question.clusterId,
          question.text,
          question.author,
          question.voterId,
          question.createdAt,
        ],
      );

      await client.query('COMMIT');
      return { question, cluster, isNewCluster, score: match.score };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getQuestion(roomId: string, questionId: string): Promise<Question | null> {
    const result = await this.pool.query<QuestionRow>(
      `SELECT q.*, COALESCE(array_agg(v.voter_id) FILTER (WHERE v.voter_id IS NOT NULL), '{}')
                AS upvotes
         FROM questions q
         LEFT JOIN votes v ON v.question_id = q.id
        WHERE q.id = $1 AND q.room_id = $2
        GROUP BY q.id`,
      [questionId, roomId],
    );
    return result.rows[0] ? toQuestion(result.rows[0]) : null;
  }

  async hideQuestion(roomId: string, questionId: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE questions SET hidden = TRUE WHERE id = $1 AND room_id = $2',
      [questionId, roomId],
    );
    if (!result.rowCount) throw new Error('Pregunta inexistente');
  }

  async splitQuestion(roomId: string, questionId: string, cluster: Cluster): Promise<Cluster> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO clusters (id, room_id, label, status, note, created_at, answered_at)
         VALUES ($1, $2, $3, $4, '', $5, NULL)`,
        [cluster.id, cluster.roomId, cluster.label, cluster.status, cluster.createdAt],
      );
      const result = await client.query(
        'UPDATE questions SET cluster_id = $1 WHERE id = $2 AND room_id = $3',
        [cluster.id, questionId, roomId],
      );
      if (!result.rowCount) throw new Error('Pregunta inexistente');
      await client.query('COMMIT');
      return cluster;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async toggleVote(
    roomId: string,
    questionId: string,
    voterId: string,
  ): Promise<{ upvotes: number; voted: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query(
        'SELECT 1 FROM questions WHERE id = $1 AND room_id = $2',
        [questionId, roomId],
      );
      if (!exists.rowCount) throw new Error('Pregunta inexistente');

      const removed = await client.query('DELETE FROM votes WHERE question_id = $1 AND voter_id = $2', [
        questionId,
        voterId,
      ]);
      const voted = !removed.rowCount;
      if (voted) {
        await client.query(
          `INSERT INTO votes (question_id, voter_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [questionId, voterId],
        );
      }

      const count = await client.query<{ total: string }>(
        'SELECT COUNT(*) AS total FROM votes WHERE question_id = $1',
        [questionId],
      );
      await client.query('COMMIT');
      return { upvotes: Number(count.rows[0]!.total), voted };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getCluster(roomId: string, clusterId: string): Promise<Cluster | null> {
    const result = await this.pool.query<ClusterRow>(
      'SELECT * FROM clusters WHERE id = $1 AND room_id = $2',
      [clusterId, roomId],
    );
    return result.rows[0] ? toCluster(result.rows[0]) : null;
  }

  async updateCluster(
    roomId: string,
    clusterId: string,
    changes: { status?: ClusterStatus; label?: string; note?: string },
  ): Promise<Cluster> {
    const answeredAt =
      changes.status === undefined ? undefined : changes.status === 'answered' ? Date.now() : null;

    const result = await this.pool.query<ClusterRow>(
      `UPDATE clusters SET
         status      = COALESCE($3, status),
         label       = COALESCE($4, label),
         note        = COALESCE($5, note),
         answered_at = CASE WHEN $3::text IS NULL THEN answered_at ELSE $6::bigint END
       WHERE id = $1 AND room_id = $2
       RETURNING *`,
      [
        clusterId,
        roomId,
        changes.status ?? null,
        changes.label ?? null,
        changes.note ?? null,
        answeredAt ?? null,
      ],
    );
    if (!result.rows[0]) throw new Error('Grupo inexistente');
    return toCluster(result.rows[0]);
  }

  async mergeClusters(roomId: string, sourceId: string, targetId: string): Promise<Cluster> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query<ClusterRow>(
        'SELECT * FROM clusters WHERE id = $1 AND room_id = $2',
        [targetId, roomId],
      );
      const source = await client.query<ClusterRow>(
        'SELECT * FROM clusters WHERE id = $1 AND room_id = $2',
        [sourceId, roomId],
      );
      if (!target.rows[0] || !source.rows[0]) throw new Error('Grupo inexistente');

      await client.query('UPDATE questions SET cluster_id = $1 WHERE cluster_id = $2', [
        targetId,
        sourceId,
      ]);
      await client.query('DELETE FROM clusters WHERE id = $1', [sourceId]);
      await client.query('COMMIT');
      return toCluster(target.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getBoardData(roomId: string): Promise<BoardData> {
    const clusters = await this.pool.query<ClusterRow>(
      'SELECT * FROM clusters WHERE room_id = $1',
      [roomId],
    );
    const questions = await this.pool.query<QuestionRow>(
      `SELECT q.*, COALESCE(array_agg(v.voter_id) FILTER (WHERE v.voter_id IS NOT NULL), '{}')
                AS upvotes
         FROM questions q
         LEFT JOIN votes v ON v.question_id = q.id
        WHERE q.room_id = $1 AND q.hidden = FALSE
        GROUP BY q.id`,
      [roomId],
    );
    return {
      clusters: clusters.rows.map(toCluster),
      questions: questions.rows.map(toQuestion),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
