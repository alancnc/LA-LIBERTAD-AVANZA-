import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { findBestCluster } from '../text/cluster.js';
import { PostgresRepository } from './postgres.js';
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
          { roomId: room.id, text, author: 'Alumno', voterId: `v${index}` },
          (candidates) => findBestCluster(text, candidates, room.threshold),
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
