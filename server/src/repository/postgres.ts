import pg from 'pg';
import { newId } from '../ids.js';
import type { Answer, Cluster, ClusterStatus, Prompt, Question, Room } from '../types.js';
import type {
  BoardData,
  ClusterWithTexts,
  CreatedQuestion,
  CreateQuestionInput,
  PromptData,
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

-- Consignas del docente: preguntas que lanza para que responda la clase.
CREATE TABLE IF NOT EXISTS prompts (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  closed      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  BIGINT NOT NULL,
  closed_at   BIGINT
);

-- Una respuesta por persona y consigna: la unicidad la garantiza el índice, no
-- la lógica de la aplicación. Volver a responder pisa la anterior.
CREATE TABLE IF NOT EXISTS answers (
  id          TEXT PRIMARY KEY,
  prompt_id   TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  author      TEXT NOT NULL,
  voter_id    TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  hidden      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS answers_prompt_voter_idx ON answers(prompt_id, voter_id);

-- Vector del texto para la comparación semántica. Se guarda como JSON: son
-- unos pocos cientos de números por pregunta y el volumen no justifica una
-- extensión como pgvector, que además no está en todos los proveedores.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS embedding TEXT;

CREATE INDEX IF NOT EXISTS clusters_room_idx  ON clusters(room_id);
CREATE INDEX IF NOT EXISTS questions_room_idx ON questions(room_id);
CREATE INDEX IF NOT EXISTS questions_cluster_idx ON questions(cluster_id);
CREATE INDEX IF NOT EXISTS prompts_room_idx ON prompts(room_id);
CREATE INDEX IF NOT EXISTS answers_room_idx ON answers(room_id);

-- Row Level Security sin políticas: nadie llega a estas tablas salvo su dueño.
--
-- Importa sobre todo en Supabase, que publica automáticamente el esquema
-- public a través de su API REST usando la "anon key", que es pública por
-- diseño. Sin esto, cualquiera con esa clave podría leer la tabla de salas y
-- quedarse con el admin_key de todas, es decir, tomar control de cualquier
-- clase. Activar RLS y no definir ninguna política deja ese camino cerrado.
--
-- La aplicación no se ve afectada: conecta como dueña de las tablas, y el dueño
-- no queda sujeto a RLS salvo que se use FORCE ROW LEVEL SECURITY.
ALTER TABLE rooms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE clusters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers   ENABLE ROW LEVEL SECURITY;

-- Además de RLS, se quitan los permisos que Supabase concede por defecto a sus
-- roles públicos. Los roles sólo existen ahí, así que se comprueba antes para
-- no romper en Postgres común (Neon, Vercel Postgres o uno propio).
DO $$
DECLARE
  rol TEXT;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      EXECUTE format(
        'REVOKE ALL ON rooms, clusters, questions, votes, prompts, answers FROM %I', rol
      );
    END IF;
  END LOOP;
END $$;
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
  embedding: string | null;
}

interface PromptRow {
  id: string;
  room_id: string;
  text: string;
  closed: boolean;
  created_at: string;
  closed_at: string | null;
}

interface AnswerRow {
  id: string;
  prompt_id: string;
  room_id: string;
  text: string;
  author: string;
  voter_id: string;
  created_at: string;
  hidden: boolean;
}

function toPrompt(row: PromptRow): Prompt {
  return {
    id: row.id,
    roomId: row.room_id,
    text: row.text,
    closed: row.closed,
    createdAt: Number(row.created_at),
    closedAt: row.closed_at === null ? null : Number(row.closed_at),
  };
}

function toAnswer(row: AnswerRow): Answer {
  return {
    id: row.id,
    promptId: row.prompt_id,
    roomId: row.room_id,
    text: row.text,
    author: row.author,
    voterId: row.voter_id,
    createdAt: Number(row.created_at),
    hidden: row.hidden,
  };
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
    embedding: parseEmbedding(row.embedding),
  };
}

/** Un vector ilegible no debe tumbar el tablero: se ignora y se sigue. */
function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((n) => typeof n === 'number') ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Configuración TLS derivada del `sslmode` de la cadena de conexión.
 *
 * - `disable`: sin cifrado (sólo para una base local).
 * - `verify-ca` / `verify-full`: se valida el certificado del servidor. Es lo
 *   más seguro; puede requerir el certificado raíz del proveedor en
 *   `DATABASE_CA_CERT`.
 * - cualquier otro caso (lo habitual: `require`): se cifra la conexión pero no
 *   se valida la cadena del certificado. Es lo que aceptan Supabase y Neon sin
 *   configuración extra; protege de escuchas pasivas, no de un intermediario
 *   activo que pueda suplantar al servidor.
 */
export function sslConfigFor(
  connectionString: string,
  caCertificate?: string,
): pg.PoolConfig['ssl'] {
  const mode = /[?&]sslmode=([^&]+)/.exec(connectionString)?.[1]?.toLowerCase();
  if (mode === 'disable') return undefined;
  if (mode === 'verify-ca' || mode === 'verify-full') {
    return caCertificate
      ? { rejectUnauthorized: true, ca: caCertificate }
      : { rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

/** Distingue un problema de conexión de un error de SQL, que no se reintenta. */
function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EPIPE'].includes(code)) {
    return true;
  }
  return /timeout|terminated|connection|getaddrinfo|socket/i.test(error.message);
}

export class PostgresRepository implements Repository {
  private readonly pool: pg.Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string, caCertificate = process.env.DATABASE_CA_CERT) {
    this.pool = new pg.Pool({
      connectionString,
      // En serverless conviven muchas instancias efímeras: pocas conexiones por
      // instancia y cierre rápido de las ociosas para no agotar el servidor.
      max: 3,
      idleTimeoutMillis: 10_000,
      // Los planes gratuitos suspenden la base por inactividad y la primera
      // conexión tiene que esperar a que despierte. Diez segundos se quedaban
      // cortos con Neon.
      connectionTimeoutMillis: 20_000,
      ssl: sslConfigFor(connectionString, caCertificate),
    });

    // node-postgres emite 'error' cuando una conexión que estaba ociosa se cae:
    // el proveedor la cerró, se perdió la red, se reinició la base. Sin un
    // listener, EventEmitter convierte ese evento en una excepción no capturada
    // que mata el proceso; en serverless eso es la función entera cayéndose con
    // un 500 sin cuerpo, imposible de diagnosticar desde afuera.
    //
    // No hay nada que reparar acá: el pool descarta la conexión rota y abre otra
    // cuando haga falta. Alcanza con registrarlo para que quede en los logs.
    this.pool.on('error', (error) => {
      console.error('Conexión ociosa de Postgres caída:', error);
    });
  }

  /**
   * Crea el esquema si falta.
   *
   * El resultado se cachea sólo si sale bien. Cachear también el fallo dejaba
   * la instancia inutilizable de forma permanente: bastaba con que la primera
   * conexión cayera por un timeout de arranque en frío para que todas las
   * peticiones siguientes fallaran con ese mismo error, aunque la base ya
   * estuviera despierta.
   */
  init(): Promise<void> {
    this.ready ??= this.connectWithRetry().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  /**
   * Intenta preparar el esquema, reintentando ante fallos de conexión.
   *
   * Una base suspendida rechaza o deja colgada la primera conexión mientras
   * arranca; el segundo intento suele encontrarla lista. No se reintentan los
   * errores de SQL: si el esquema está mal, insistir no lo arregla.
   */
  private async connectWithRetry(attempts = 3): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.pool.query(SCHEMA);
        return;
      } catch (error) {
        lastError = error;
        if (!isConnectionError(error) || attempt === attempts) throw error;
        // Espera creciente: 300ms, 900ms. Suficiente para un arranque en frío
        // sin agotar el tiempo máximo de una función serverless.
        await new Promise((resolve) => setTimeout(resolve, 300 * 3 ** (attempt - 1)));
      }
    }
    throw lastError;
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

  async listRooms(): Promise<Room[]> {
    const result = await this.pool.query<RoomRow>(
      'SELECT * FROM rooms ORDER BY created_at DESC',
    );
    return result.rows.map(toRoom);
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

      const candidateRows = await client.query<{
        cluster_id: string;
        texts: string[];
        embeddings: Array<string | null>;
      }>(
        `SELECT c.id AS cluster_id,
                array_agg(q.text ORDER BY q.created_at)      AS texts,
                array_agg(q.embedding ORDER BY q.created_at) AS embeddings
           FROM clusters c
           JOIN questions q ON q.cluster_id = c.id AND q.hidden = FALSE
          WHERE c.room_id = $1 AND c.status IN ('pending', 'answering')
          GROUP BY c.id`,
        [input.roomId],
      );

      const candidates = candidateRows.rows.map((row) => ({
        clusterId: row.cluster_id,
        texts: row.texts,
        embeddings: (row.embeddings ?? []).map(parseEmbedding),
      }));

      // Un tema preseleccionado sólo vale si sigue siendo candidato válido:
      // entre que se decidió y llegó acá pudo cerrarse o responderse.
      const preferido = input.preferredClusterId
        ? candidates.find((c) => c.clusterId === input.preferredClusterId)
        : undefined;
      const match = preferido
        ? { clusterId: preferido.clusterId, score: 1 }
        : assign(candidates);

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
        embedding: input.embedding,
      };
      await client.query(
        `INSERT INTO questions
           (id, room_id, cluster_id, text, author, voter_id, created_at, hidden, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8)`,
        [
          question.id,
          question.roomId,
          question.clusterId,
          question.text,
          question.author,
          question.voterId,
          question.createdAt,
          input.embedding ? JSON.stringify(input.embedding) : null,
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

  // ------------------------------------------------- consignas del docente

  /**
   * Inserta la consigna y cierra la anterior en la misma transacción.
   *
   * Si fueran dos operaciones sueltas, dos pedidos simultáneos podrían dejar
   * dos consignas abiertas a la vez, y la pantalla del alumno muestra una sola.
   */
  async createPrompt(prompt: Prompt): Promise<Prompt> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [prompt.roomId]);
      await client.query(
        'UPDATE prompts SET closed = TRUE, closed_at = $2 WHERE room_id = $1 AND closed = FALSE',
        [prompt.roomId, Date.now()],
      );
      await client.query(
        `INSERT INTO prompts (id, room_id, text, closed, created_at, closed_at)
         VALUES ($1, $2, $3, FALSE, $4, NULL)`,
        [prompt.id, prompt.roomId, prompt.text, prompt.createdAt],
      );
      await client.query('COMMIT');
      return prompt;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getPrompt(roomId: string, promptId: string): Promise<Prompt | null> {
    const result = await this.pool.query<PromptRow>(
      'SELECT * FROM prompts WHERE id = $1 AND room_id = $2',
      [promptId, roomId],
    );
    return result.rows[0] ? toPrompt(result.rows[0]) : null;
  }

  async updatePrompt(
    roomId: string,
    promptId: string,
    changes: { closed?: boolean },
  ): Promise<Prompt> {
    const cerrada = changes.closed;
    const result = await this.pool.query<PromptRow>(
      `UPDATE prompts SET
         closed    = COALESCE($3, closed),
         closed_at = CASE WHEN $3 IS NULL THEN closed_at WHEN $3 THEN $4 ELSE NULL END
       WHERE id = $1 AND room_id = $2
       RETURNING *`,
      [promptId, roomId, cerrada ?? null, Date.now()],
    );
    if (!result.rows[0]) throw new Error('Consigna inexistente');
    return toPrompt(result.rows[0]);
  }

  async deletePrompt(roomId: string, promptId: string): Promise<void> {
    // Las respuestas se van solas por el ON DELETE CASCADE de answers.prompt_id.
    const result = await this.pool.query(
      'DELETE FROM prompts WHERE id = $1 AND room_id = $2',
      [promptId, roomId],
    );
    if (!result.rowCount) throw new Error('Consigna inexistente');
  }

  /**
   * Guarda la respuesta, pisando la anterior de esa misma persona.
   *
   * El conflicto lo resuelve el índice único (prompt_id, voter_id), así que dos
   * envíos simultáneos del mismo participante terminan en una sola fila en vez
   * de en dos respuestas suyas contadas por separado.
   */
  async saveAnswer(answer: Answer): Promise<Answer> {
    const result = await this.pool.query<AnswerRow>(
      `INSERT INTO answers
         (id, prompt_id, room_id, text, author, voter_id, created_at, hidden)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
       ON CONFLICT (prompt_id, voter_id) DO UPDATE
         SET text = EXCLUDED.text, author = EXCLUDED.author, hidden = FALSE
       RETURNING *`,
      [
        answer.id,
        answer.promptId,
        answer.roomId,
        answer.text,
        answer.author,
        answer.voterId,
        answer.createdAt,
      ],
    );
    return toAnswer(result.rows[0]!);
  }

  async hideAnswer(roomId: string, answerId: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE answers SET hidden = TRUE WHERE id = $1 AND room_id = $2',
      [answerId, roomId],
    );
    if (!result.rowCount) throw new Error('Respuesta inexistente');
  }

  async getPromptData(roomId: string): Promise<PromptData> {
    const prompts = await this.pool.query<PromptRow>(
      'SELECT * FROM prompts WHERE room_id = $1 ORDER BY created_at DESC',
      [roomId],
    );
    const answers = await this.pool.query<AnswerRow>(
      'SELECT * FROM answers WHERE room_id = $1 AND hidden = FALSE ORDER BY created_at',
      [roomId],
    );
    return {
      prompts: prompts.rows.map(toPrompt),
      answers: answers.rows.map(toAnswer),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
