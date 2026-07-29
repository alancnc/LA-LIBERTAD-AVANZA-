import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { newId } from '../ids.js';
import { findBestCluster } from '../text/cluster.js';
import { PostgresRepository, sslConfigFor } from './postgres.js';
import type { Room } from '../types.js';

/**
 * Tests de concurrencia del repositorio Postgres.
 *
 * Se prueban acá y no a través de HTTP a propósito: supertest procesa las
 * peticiones prácticamente en serie, así que un test por HTTP pasa incluso con
 * la transacción rota. Llamando al repositorio en paralelo el fallo sí aparece
 * (verificado quitando el `FOR UPDATE`: se crean grupos duplicados).
 *
 * Requiere `TEST_DATABASE_URL`; sin eso se omiten.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.runIf(databaseUrl)('PostgresRepository bajo concurrencia', () => {
  // Vitest recorre el cuerpo del describe aunque la suite esté omitida, así que
  // el repositorio se crea recién en el primer test: sin `TEST_DATABASE_URL` no
  // hay cadena de conexión que pasarle.
  let repository: PostgresRepository;
  let room: Room;

  beforeEach(async () => {
    repository ??= new PostgresRepository(databaseUrl!);
    await repository.init();
    room = {
      id: newId(),
      code: `C${Math.floor(Math.random() * 90000 + 10000)}`,
      title: 'Concurrencia',
      adminKey: 'clave',
      threshold: 0.42,
      closed: false,
      createdAt: Date.now(),
    };
    await repository.createRoom(room);

    // Calentar el pool es imprescindible para que el test valga: si las
    // conexiones se crean recién durante la ráfaga, el costo de establecerlas
    // separa las peticiones lo suficiente como para que se serialicen solas y
    // el test pase incluso con la transacción rota.
    await Promise.all([1, 2, 3].map(() => repository.getBoardData(room.id)));
  });

  afterAll(async () => {
    await repository?.close();
  });

  /** Manda todas las preguntas a la vez, sin esperar una por una. */
  function askAll(texts: string[]) {
    return Promise.all(
      texts.map((text, index) =>
        repository.addQuestion(
          { roomId: room.id, text, author: 'Alumno', voterId: `v${index}`, embedding: null },
          (candidates) => findBestCluster(text, candidates, { threshold: room.threshold }),
        ),
      ),
    );
  }

  it('no duplica el tema cuando llegan juntas varias reformulaciones', async () => {
    const results = await askAll([
      '¿Cómo se resuelve una integral por partes?',
      'integrales por partes cómo se resuelven',
      'no entiendo la integral por partes',
      'la integral por partes cómo se hace',
      'profe no entiendo integrales por partes',
    ]);

    expect(results.filter((result) => result.isNewCluster)).toHaveLength(1);

    const board = await repository.getBoardData(room.id);
    expect(board.clusters).toHaveLength(1);
    expect(board.questions).toHaveLength(5);
  });

  it('no pierde ninguna pregunta de una tanda simultánea', async () => {
    const texts = [
      '¿Cuándo es el parcial?',
      '¿Dónde subo el trabajo práctico?',
      '¿Se puede usar calculadora en el examen?',
      '¿Va a haber recuperatorio?',
      '¿Las clases quedan grabadas?',
      '¿Dónde está la bibliografía de la materia?',
    ];
    await askAll(texts);

    const board = await repository.getBoardData(room.id);
    expect(board.questions).toHaveLength(texts.length);
    // Son seis consultas sin relación entre sí: cada una abre su propio tema.
    expect(board.clusters).toHaveLength(texts.length);
  });

  it('cuenta bien los votos simultáneos sobre una misma pregunta', async () => {
    const [created] = await askAll(['¿Cuándo es el parcial?']);
    const questionId = created!.question.id;

    const voters = ['a', 'b', 'c', 'd', 'e'];
    await Promise.all(
      voters.map((voter) => repository.toggleVote(room.id, questionId, voter)),
    );

    const question = await repository.getQuestion(room.id, questionId);
    expect(question?.upvotes).toHaveLength(voters.length);
  });

  it('deja las tablas con Row Level Security activo', async () => {
    // En Supabase, el esquema `public` se publica por su API REST con una clave
    // que es pública. Si RLS se apagara, `rooms.admin_key` quedaría al alcance
    // de cualquiera y con eso se controla cualquier sala.
    const pool = new pg.Pool({ connectionString: databaseUrl!, max: 1 });
    try {
      const result = await pool.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT relname, relrowsecurity
           FROM pg_class
          WHERE relname IN ('rooms', 'clusters', 'questions', 'votes')
            AND relkind = 'r'`,
      );
      expect(result.rows).toHaveLength(4);
      for (const row of result.rows) {
        expect(row.relrowsecurity, `RLS apagado en ${row.relname}`).toBe(true);
      }
    } finally {
      await pool.end();
    }
  });

  it('un rol sin privilegios no puede leer las salas', async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl!, max: 1 });
    const client = await pool.connect();
    try {
      // Se imita el rol público de Supabase: sin permisos explícitos, la
      // consulta tiene que ser rechazada.
      await client.query('CREATE ROLE test_publico NOLOGIN');
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_publico');
      await expect(client.query('SELECT admin_key FROM rooms')).rejects.toThrow(
        /permission denied|permiso denegado/i,
      );
      await client.query('ROLLBACK');
    } finally {
      await client.query('DROP ROLE IF EXISTS test_publico').catch(() => undefined);
      client.release();
      await pool.end();
    }
  });

  it('el mismo votante repetido no infla el conteo', async () => {
    const [created] = await askAll(['¿Cuándo es el parcial?']);
    const questionId = created!.question.id;

    // La clave primaria de `votes` es la que garantiza la unicidad.
    await repository.toggleVote(room.id, questionId, 'unico');
    await repository.toggleVote(room.id, questionId, 'unico');
    await repository.toggleVote(room.id, questionId, 'unico');

    const question = await repository.getQuestion(room.id, questionId);
    expect(question?.upvotes).toEqual(['unico']);
  });
});

describe('sslConfigFor', () => {
  it('desactiva TLS sólo con sslmode=disable', () => {
    expect(sslConfigFor('postgres://h/d?sslmode=disable')).toBeUndefined();
  });

  it('cifra sin validar el certificado por defecto', () => {
    expect(sslConfigFor('postgres://h/d')).toEqual({ rejectUnauthorized: false });
    expect(sslConfigFor('postgres://h/d?sslmode=require')).toEqual({ rejectUnauthorized: false });
  });

  it('valida el certificado con verify-full', () => {
    expect(sslConfigFor('postgres://h/d?sslmode=verify-full')).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('usa el certificado raíz provisto si hay uno', () => {
    expect(sslConfigFor('postgres://h/d?sslmode=verify-ca', 'CERT')).toEqual({
      rejectUnauthorized: true,
      ca: 'CERT',
    });
  });

  it('no confunde sslmode con otro parámetro que lo contenga', () => {
    expect(sslConfigFor('postgres://h/d?options=x&sslmode=require')).toEqual({
      rejectUnauthorized: false,
    });
  });
});

describe('resistencia del pool', () => {
  it('no se cae cuando Postgres reporta una conexión ociosa caída', () => {
    // Sin un listener de 'error', EventEmitter lanza y el proceso muere. En
    // serverless eso es la función entera respondiendo 500 sin cuerpo.
    const repository = new PostgresRepository('postgresql://u:p@127.0.0.1:1/x?sslmode=disable');
    const pool = (repository as unknown as { pool: pg.Pool }).pool;

    expect(pool.listenerCount('error')).toBeGreaterThan(0);
    expect(() => pool.emit('error', new Error('conexión caída'))).not.toThrow();
  });
});
