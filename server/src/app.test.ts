import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import pg from 'pg';
import { createApp, describeHost } from './app.js';
import { JsonRepository } from './repository/memory.js';
import { PostgresRepository } from './repository/postgres.js';
import type { Repository } from './repository/types.js';

/**
 * La misma batería corre contra todos los repositorios disponibles: es la única
 * forma de asegurar que el despliegue en Postgres (Vercel) se comporta igual
 * que el de archivo. Postgres se incluye si hay `TEST_DATABASE_URL`.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

const backends: Array<{ name: string; create: () => Repository; reset: () => Promise<void> }> = [
  {
    name: 'memoria',
    create: () => new JsonRepository(null),
    reset: async () => {},
  },
];

if (databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  backends.push({
    name: 'postgres',
    create: () => new PostgresRepository(databaseUrl),
    reset: async () => {
      // Las tablas pueden no existir todavía en la primera corrida.
      await pool
        .query('TRUNCATE votes, questions, clusters, rooms CASCADE')
        .catch(() => undefined);
    },
  });
  afterAll(async () => {
    await pool.end();
  });
}

describe.each(backends)('API sobre $name', ({ create, reset }) => {
  let app: Express;
  let repository: Repository;

  beforeEach(async () => {
    repository = create();
    const built = createApp({ repository, clientDir: null, adminPassword: 'clave-docente' });
    app = built.app;
    await repository.init();
    await reset();
  });

  async function createRoom(title = 'Análisis Matemático II') {
    const response = await request(app).post('/api/rooms').send({ title });
    expect(response.status).toBe(201);
    return response.body as { code: string; adminKey: string };
  }

  async function ask(code: string, text: string, viewer: string, author = 'Alumno') {
    return request(app)
      .post(`/api/rooms/${code}/questions`)
      .set('x-viewer-id', viewer)
      .send({ text, author });
  }

  describe('salas', () => {
    it('crea una sala con código y clave de admin', async () => {
      const room = await createRoom();
      expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
      expect(room.adminKey).toHaveLength(32);
    });

    it('devuelve 404 con un código inexistente', async () => {
      const response = await request(app).get('/api/rooms/ZZZZZZ');
      expect(response.status).toBe(404);
    });

    it('encuentra la sala sin importar mayúsculas', async () => {
      const room = await createRoom();
      const response = await request(app).get(`/api/rooms/${room.code.toLowerCase()}`);
      expect(response.status).toBe(200);
      expect(response.body.code).toBe(room.code);
    });

    it('no expone la clave de admin en la vista pública', async () => {
      const room = await createRoom();
      const response = await request(app).get(`/api/rooms/${room.code}`);
      expect(response.body.adminKey).toBeUndefined();
    });
  });

  describe('preguntas', () => {
    it('agrupa las reformulaciones del mismo tema', async () => {
      const room = await createRoom();

      const first = await ask(room.code, '¿Cómo se resuelve una integral por partes?', 'v1');
      expect(first.status).toBe(201);
      expect(first.body.isNewCluster).toBe(true);

      const second = await ask(
        room.code,
        'no entiendo integrales por partes, cómo se resuelven',
        'v2',
      );
      expect(second.body.isNewCluster).toBe(false);
      expect(second.body.clusterId).toBe(first.body.clusterId);
    });

    it('abre un tema nuevo para una pregunta distinta', async () => {
      const room = await createRoom();
      const first = await ask(room.code, '¿Cómo se resuelve una integral por partes?', 'v1');
      const second = await ask(room.code, '¿Cuándo es la fecha del parcial?', 'v2');
      expect(second.body.isNewCluster).toBe(true);
      expect(second.body.clusterId).not.toBe(first.body.clusterId);
    });

    it('rechaza preguntas demasiado cortas', async () => {
      const room = await createRoom();
      const response = await ask(room.code, 'a', 'v1');
      expect(response.status).toBe(400);
    });

    it('usa "Anónimo" cuando no se firma la pregunta', async () => {
      const room = await createRoom();
      await ask(room.code, '¿Cuándo es el parcial?', 'v1', '   ');
      const board = await request(app).get(`/api/rooms/${room.code}/board`);
      expect(board.body.clusters[0].questions[0].author).toBe('Anónimo');
    });

    it('no acepta preguntas en una sala cerrada', async () => {
      const room = await createRoom();
      await request(app)
        .patch(`/api/rooms/${room.code}`)
        .set('x-admin-key', room.adminKey)
        .send({ closed: true });

      const response = await ask(room.code, '¿Cuándo es el parcial?', 'v1');
      expect(response.status).toBe(409);
    });
  });

  describe('votos', () => {
    it('suma y quita el voto del mismo participante', async () => {
      const room = await createRoom();
      const question = await ask(room.code, '¿Cuándo es el parcial?', 'autor');
      const id = question.body.questionId;

      const up = await request(app)
        .post(`/api/rooms/${room.code}/questions/${id}/vote`)
        .set('x-viewer-id', 'otro');
      expect(up.body).toEqual({ upvotes: 1, voted: true });

      const down = await request(app)
        .post(`/api/rooms/${room.code}/questions/${id}/vote`)
        .set('x-viewer-id', 'otro');
      expect(down.body).toEqual({ upvotes: 0, voted: false });
    });

    it('impide votar la propia pregunta', async () => {
      const room = await createRoom();
      const question = await ask(room.code, '¿Cuándo es el parcial?', 'autor');
      const response = await request(app)
        .post(`/api/rooms/${room.code}/questions/${question.body.questionId}/vote`)
        .set('x-viewer-id', 'autor');
      expect(response.status).toBe(400);
    });

    it('no cuenta dos veces al mismo votante', async () => {
      const room = await createRoom();
      const question = await ask(room.code, '¿Cuándo es el parcial?', 'autor');
      const id = question.body.questionId;

      await request(app)
        .post(`/api/rooms/${room.code}/questions/${id}/vote`)
        .set('x-viewer-id', 'a');
      await request(app)
        .post(`/api/rooms/${room.code}/questions/${id}/vote`)
        .set('x-viewer-id', 'b');

      const board = await request(app).get(`/api/rooms/${room.code}/board`);
      expect(board.body.clusters[0].upvotes).toBe(2);
    });
  });

  describe('ranking', () => {
    it('ordena los temas por cuánta gente los pide', async () => {
      const room = await createRoom();

      // Tema A: una sola persona pregunta.
      await ask(room.code, '¿Dónde se entrega el trabajo práctico?', 'v1');

      // Tema B: tres personas preguntan lo mismo con distintas palabras.
      await ask(room.code, '¿Cómo se resuelve una integral por partes?', 'v2');
      await ask(room.code, 'integrales por partes cómo se resuelven', 'v3');
      const tercera = await ask(room.code, 'no entiendo la integral por partes', 'v4');

      // ...y encima una cuarta persona vota.
      await request(app)
        .post(`/api/rooms/${room.code}/questions/${tercera.body.questionId}/vote`)
        .set('x-viewer-id', 'v5');

      const board = await request(app).get(`/api/rooms/${room.code}/board`);
      const [primero] = board.body.clusters;

      expect(primero.questionCount).toBe(3);
      expect(primero.upvotes).toBe(1);
      expect(primero.score).toBe(4);
      expect(board.body.clusters[1].score).toBe(1);
    });

    it('marca las preguntas propias y las votadas por el visitante', async () => {
      const room = await createRoom();
      const question = await ask(room.code, '¿Cuándo es el parcial?', 'autor');
      await request(app)
        .post(`/api/rooms/${room.code}/questions/${question.body.questionId}/vote`)
        .set('x-viewer-id', 'votante');

      const comoAutor = await request(app)
        .get(`/api/rooms/${room.code}/board`)
        .set('x-viewer-id', 'autor');
      expect(comoAutor.body.clusters[0].questions[0].mine).toBe(true);
      expect(comoAutor.body.clusters[0].questions[0].votedByMe).toBe(false);

      const comoVotante = await request(app)
        .get(`/api/rooms/${room.code}/board`)
        .set('x-viewer-id', 'votante');
      expect(comoVotante.body.clusters[0].questions[0].votedByMe).toBe(true);
      expect(comoVotante.body.clusters[0].questions[0].mine).toBe(false);
    });

    it('manda los temas respondidos al final', async () => {
      const room = await createRoom();
      const respondido = await ask(room.code, '¿Cómo se resuelve una integral por partes?', 'v1');
      await ask(room.code, '¿Cuándo es el parcial?', 'v2');

      await request(app)
        .patch(`/api/rooms/${room.code}/clusters/${respondido.body.clusterId}`)
        .set('x-admin-key', room.adminKey)
        .send({ status: 'answered' });

      const board = await request(app).get(`/api/rooms/${room.code}/board`);
      expect(board.body.clusters.at(-1).id).toBe(respondido.body.clusterId);
      expect(board.body.clusters.at(-1).status).toBe('answered');
    });
  });

  describe('área del docente', () => {
    it('valida la contraseña maestra', async () => {
      const ok = await request(app).post('/api/admin/session').send({ password: 'clave-docente' });
      expect(ok.status).toBe(200);

      const mal = await request(app).post('/api/admin/session').send({ password: 'otra' });
      expect(mal.status).toBe(403);

      const vacia = await request(app).post('/api/admin/session').send({});
      expect(vacia.status).toBe(403);
    });

    it('no lista las clases sin la contraseña', async () => {
      await createRoom();
      const sinClave = await request(app).get('/api/admin/rooms');
      expect(sinClave.status).toBe(403);
    });

    it('lista las clases con sus números', async () => {
      const room = await createRoom('Álgebra I');
      await ask(room.code, '¿Cuándo es el parcial?', 'v1');
      await ask(room.code, 'qué día es el parcial', 'v2');

      const response = await request(app)
        .get('/api/admin/rooms')
        .set('x-admin-password', 'clave-docente');

      expect(response.status).toBe(200);
      const encontrada = response.body.rooms.find((item: { code: string }) => item.code === room.code);
      expect(encontrada.title).toBe('Álgebra I');
      expect(encontrada.questionCount).toBe(2);
      expect(encontrada.pendingCount).toBe(1);
    });

    it('la contraseña maestra abre el panel de cualquier clase', async () => {
      const room = await createRoom();
      const response = await request(app)
        .get(`/api/rooms/${room.code}/admin`)
        .set('x-admin-password', 'clave-docente');
      expect(response.status).toBe(200);
    });

    it('una contraseña incorrecta no abre nada', async () => {
      const room = await createRoom();
      const response = await request(app)
        .get(`/api/rooms/${room.code}/admin`)
        .set('x-admin-password', 'incorrecta');
      expect(response.status).toBe(403);
    });

    it('informa que el área del docente está habilitada', async () => {
      const response = await request(app).get('/api/config');
      expect(response.body.masterAdmin).toBe(true);
    });
  });

  describe('panel del docente', () => {
    it('exige la clave de admin', async () => {
      const room = await createRoom();
      const sinClave = await request(app).get(`/api/rooms/${room.code}/admin`);
      expect(sinClave.status).toBe(403);

      const conClaveMala = await request(app)
        .get(`/api/rooms/${room.code}/admin`)
        .set('x-admin-key', 'clave-incorrecta');
      expect(conClaveMala.status).toBe(403);
    });

    it('informa las métricas de la sala', async () => {
      const room = await createRoom();
      await ask(room.code, '¿Cómo se resuelve una integral por partes?', 'v1');
      await ask(room.code, 'integrales por partes cómo se resuelven', 'v2');
      await ask(room.code, '¿Cuándo es el parcial?', 'v3');

      const response = await request(app)
        .get(`/api/rooms/${room.code}/admin`)
        .set('x-admin-key', room.adminKey);

      expect(response.body.stats.questionCount).toBe(3);
      expect(response.body.stats.clusterCount).toBe(2);
      expect(response.body.stats.pendingCount).toBe(2);
      expect(response.body.stats.participants).toBe(3);
    });

    it('rechaza un estado inválido', async () => {
      const room = await createRoom();
      const question = await ask(room.code, '¿Cuándo es el parcial?', 'v1');
      const response = await request(app)
        .patch(`/api/rooms/${room.code}/clusters/${question.body.clusterId}`)
        .set('x-admin-key', room.adminKey)
        .send({ status: 'inventado' });
      expect(response.status).toBe(400);
    });

    it('guarda la nota sin tocar el estado', async () => {
      const room = await createRoom();
      const question = await ask(room.code, '¿Cuándo es el parcial?', 'v1');

      await request(app)
        .patch(`/api/rooms/${room.code}/clusters/${question.body.clusterId}`)
        .set('x-admin-key', room.adminKey)
        .send({ note: 'Se responde el jueves' });

      const board = await request(app).get(`/api/rooms/${room.code}/board`);
      expect(board.body.clusters[0].note).toBe('Se responde el jueves');
      expect(board.body.clusters[0].status).toBe('pending');
    });

    it('fusiona dos temas que eran el mismo', async () => {
      const room = await createRoom();
      const a = await ask(room.code, '¿Cómo se deriva una función compuesta?', 'v1');
      const b = await ask(room.code, '¿Cuándo se entrega el trabajo práctico?', 'v2');

      const merge = await request(app)
        .post(`/api/rooms/${room.code}/clusters/${b.body.clusterId}/merge`)
        .set('x-admin-key', room.adminKey)
        .send({ targetId: a.body.clusterId });
      expect(merge.status).toBe(200);

      const board = await request(app).get(`/api/rooms/${room.code}/board`);
      expect(board.body.clusters).toHaveLength(1);
      expect(board.body.clusters[0].questionCount).toBe(2);
    });

    it('separa una pregunta mal agrupada en su propio tema', async () => {
      const room = await createRoom();
      const a = await ask(room.code, '¿Cómo se resuelve una integral por partes?', 'v1');
      const b = await ask(room.code, 'integrales por partes cómo se resuelven', 'v2');
      expect(b.body.clusterId).toBe(a.body.clusterId);

      const split = await request(app)
        .post(`/api/rooms/${room.code}/questions/${b.body.questionId}/split`)
        .set('x-admin-key', room.adminKey);
      expect(split.status).toBe(200);

      const board = await request(app).get(`/api/rooms/${room.code}/board`);
      expect(board.body.clusters).toHaveLength(2);
    });

    it('oculta una pregunta inapropiada sin romper el tablero', async () => {
      const room = await createRoom();
      const question = await ask(room.code, '¿Cuándo es el parcial?', 'v1');

      await request(app)
        .post(`/api/rooms/${room.code}/questions/${question.body.questionId}/hide`)
        .set('x-admin-key', room.adminKey);

      const board = await request(app).get(`/api/rooms/${room.code}/board`);
      expect(board.body.clusters).toHaveLength(0);
    });

    it('registra todas las preguntas de una tanda', async () => {
      const room = await createRoom();

      const textos = [
        '¿Cuándo es el parcial?',
        '¿Dónde subo el trabajo práctico?',
        '¿Se puede usar calculadora en el examen?',
        '¿Va a haber recuperatorio?',
        '¿Las clases quedan grabadas?',
        '¿Dónde está la bibliografía de la materia?',
      ];
      await Promise.all(textos.map((texto, index) => ask(room.code, texto, `w${index}`)));

      const response = await request(app)
        .get(`/api/rooms/${room.code}/admin`)
        .set('x-admin-key', room.adminKey);
      expect(response.body.stats.questionCount).toBe(textos.length);
    });

    it('un tema ya respondido no absorbe preguntas nuevas', async () => {
      const room = await createRoom();
      const primera = await ask(room.code, '¿Cómo se resuelve una integral por partes?', 'v1');

      await request(app)
        .patch(`/api/rooms/${room.code}/clusters/${primera.body.clusterId}`)
        .set('x-admin-key', room.adminKey)
        .send({ status: 'answered' });

      const repregunta = await ask(room.code, 'integrales por partes cómo se resuelven', 'v2');
      expect(repregunta.body.isNewCluster).toBe(true);
    });
  });
});

describe('sin contraseña de docente configurada', () => {
  const sinPassword = createApp({ dataFile: null, clientDir: null }).app;

  it('el área general queda deshabilitada', async () => {
    const response = await request(sinPassword)
      .post('/api/admin/session')
      .send({ password: 'lo-que-sea' });
    expect(response.status).toBe(501);
  });

  it('lo informa en la configuración, para no ofrecer lo que no existe', async () => {
    const response = await request(sinPassword).get('/api/config');
    expect(response.body.masterAdmin).toBe(false);
  });

  it('cada clase se sigue administrando con su clave propia', async () => {
    const room = await request(sinPassword).post('/api/rooms').send({ title: 'x' });
    const response = await request(sinPassword)
      .get(`/api/rooms/${room.body.code}/admin`)
      .set('x-admin-key', room.body.adminKey);
    expect(response.status).toBe(200);
  });
});

describe('sin base de datos en un despliegue que la exige', () => {
  const sinBase = createApp({
    dataFile: null,
    clientDir: null,
    requirePersistence: true,
  }).app;

  it('rechaza crear salas con un error explicable', async () => {
    const response = await request(sinBase).post('/api/rooms').send({ title: 'x' });
    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/base de datos/i);
  });

  it('deja pasar health y config, que son las que sirven para diagnosticar', async () => {
    expect((await request(sinBase).get('/api/health')).status).toBe(200);
    expect((await request(sinBase).get('/api/config')).status).toBe(200);
    expect((await request(sinBase).get('/api/health')).body.ok).toBe(false);
  });
});

describe('diagnóstico cuando el almacenamiento falla', () => {
  /** Repositorio que no logra inicializarse, como una base inalcanzable. */
  function repositorioRoto(): Repository {
    return new Proxy({} as Repository, {
      get(_target, prop) {
        if (prop === 'init') {
          return () => Promise.reject(new Error('ECONNREFUSED: la base no responde'));
        }
        return () => Promise.reject(new Error('sin almacenamiento'));
      },
    });
  }

  const app = createApp({
    repository: repositorioRoto(),
    clientDir: null,
    adminPassword: 'clave-docente',
  });

  it('health responde igual y explica el motivo', async () => {
    const response = await request(app.app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.storage).toBe('error');
    expect(response.body.storageError).toMatch(/ECONNREFUSED/);
    expect(response.body.ok).toBe(false);
  });

  it('config responde igual, para no confundir un fallo de base con otra cosa', async () => {
    // Si esta ruta cayera con el resto, la pantalla del docente mostraría
    // "falta la contraseña" cuando el problema real es la conexión.
    const response = await request(app.app).get('/api/config');
    expect(response.status).toBe(200);
    expect(response.body.masterAdmin).toBe(true);
  });

  it('el resto de la API sí falla', async () => {
    const response = await request(app.app).post('/api/rooms').send({ title: 'x' });
    expect(response.status).toBe(500);
  });
});

describe('describeHost', () => {
  it('devuelve el host sin usuario ni contraseña', () => {
    expect(describeHost('postgresql://usuario:secreta@ep-x-pooler.neon.tech/db')).toBe(
      'ep-x-pooler.neon.tech',
    );
  });

  it('incluye el puerto cuando está declarado', () => {
    expect(describeHost('postgresql://u:p@host.supabase.com:6543/postgres')).toBe(
      'host.supabase.com:6543',
    );
  });

  it('nunca filtra la contraseña', () => {
    expect(describeHost('postgresql://u:secretisima@host/db')).not.toContain('secretisima');
  });

  it('no rompe con una cadena ilegible', () => {
    expect(describeHost('no-es-una-url')).toBe('cadena de conexión ilegible');
  });
});

describe('recuperación tras un fallo de almacenamiento', () => {
  /** Falla las primeras `fallos` inicializaciones y después funciona. */
  function repositorioIntermitente(fallos: number) {
    const real = new JsonRepository(null);
    let intentos = 0;
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === 'init') {
          return () => {
            intentos += 1;
            if (intentos <= fallos) {
              return Promise.reject(new Error('Connection terminated due to connection timeout'));
            }
            return real.init();
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Repository;
  }

  it('vuelve a intentar en la petición siguiente en vez de quedar rota', async () => {
    // Dos fallos: uno se lo lleva el precalentado que hace createApp al
    // construirse y el otro la primera petición. Si el fallo quedara cacheado,
    // la instancia no se recuperaría nunca y la segunda también fallaría.
    const { app } = createApp({
      repository: repositorioIntermitente(2),
      clientDir: null,
      adminPassword: 'clave',
    });

    const primera = await request(app).post('/api/rooms').send({ title: 'x' });
    expect(primera.status).toBe(500);

    const segunda = await request(app).post('/api/rooms').send({ title: 'x' });
    expect(segunda.status).toBe(201);
  });

  it('health refleja la recuperación', async () => {
    const { app } = createApp({
      repository: repositorioIntermitente(2),
      clientDir: null,
    });

    const roto = await request(app).get('/api/health');
    expect(roto.body.storage).toBe('error');
    expect(roto.body.storageError).toMatch(/timeout/i);

    // Consultar el estado también reintenta: sirve para despertar la base.
    const sano = await request(app).get('/api/health');
    expect(sano.body.storage).toBe('ok');
    expect(sano.body.ok).toBe(true);
  });
})
;

describe('agrupamiento por significado a través de la API', () => {
  /**
   * Proveedor simulado: las preguntas sobre lluvia apuntan a una dirección y
   * las del parcial a otra, sin depender de un servicio externo.
   */
  const VECTORES: Record<string, number[]> = {
    '¿se viene la lluvia?': [1, 0, 0],
    '¿está por llover?': [0.97, 0.24, 0],
    '¿cuándo es el parcial?': [0, 0, 1],
  };
  const embedder = {
    embed: (texts: string[]) =>
      Promise.resolve(texts.map((text) => VECTORES[text] ?? [0, 1, 0])),
  };

  async function sala(app: Express) {
    const response = await request(app).post('/api/rooms').send({ title: 'Clase' });
    return response.body as { code: string };
  }

  function preguntar(app: Express, code: string, text: string, viewer: string) {
    return request(app)
      .post(`/api/rooms/${code}/questions`)
      .set('x-viewer-id', viewer)
      .send({ text, author: viewer });
  }

  it('junta "¿se viene la lluvia?" con "¿está por llover?"', async () => {
    // Es el caso que motivó la comparación semántica: no comparten ni una
    // palabra, así que el motor léxico las separa inevitablemente.
    const { app } = createApp({ dataFile: null, clientDir: null, embedder });
    const room = await sala(app);

    const primera = await preguntar(app, room.code, '¿se viene la lluvia?', 'v1');
    const segunda = await preguntar(app, room.code, '¿está por llover?', 'v2');

    expect(segunda.body.isNewCluster).toBe(false);
    expect(segunda.body.clusterId).toBe(primera.body.clusterId);

    const board = await request(app).get(`/api/rooms/${room.code}/board`);
    expect(board.body.clusters).toHaveLength(1);
    expect(board.body.clusters[0].score).toBe(2);
  });

  it('sin comparación semántica quedan separadas', async () => {
    const { app } = createApp({ dataFile: null, clientDir: null, embedder: null });
    const room = await sala(app);

    await preguntar(app, room.code, '¿se viene la lluvia?', 'v1');
    const segunda = await preguntar(app, room.code, '¿está por llover?', 'v2');

    expect(segunda.body.isNewCluster).toBe(true);
  });

  it('sigue separando temas distintos', async () => {
    const { app } = createApp({ dataFile: null, clientDir: null, embedder });
    const room = await sala(app);

    await preguntar(app, room.code, '¿se viene la lluvia?', 'v1');
    const otra = await preguntar(app, room.code, '¿cuándo es el parcial?', 'v2');

    expect(otra.body.isNewCluster).toBe(true);
  });

  it('si el proveedor falla, la pregunta entra igual', async () => {
    // Un problema con el servicio externo no puede impedir que alguien
    // pregunte: se degrada al motor léxico y se sigue.
    const roto = {
      embed: () => Promise.reject(new Error('el proveedor no responde')),
    };
    const { app } = createApp({ dataFile: null, clientDir: null, embedder: roto });
    const room = await sala(app);

    const response = await preguntar(app, room.code, '¿se viene la lluvia?', 'v1');
    expect(response.status).toBe(201);

    const board = await request(app).get(`/api/rooms/${room.code}/board`);
    expect(board.body.clusters).toHaveLength(1);
  });

  it('la configuración informa si está activa', async () => {
    const conSemantica = createApp({ dataFile: null, clientDir: null, embedder }).app;
    expect((await request(conSemantica).get('/api/config')).body.semantic).toBe(true);

    const sinSemantica = createApp({ dataFile: null, clientDir: null, embedder: null }).app;
    expect((await request(sinSemantica).get('/api/config')).body.semantic).toBe(false);
  });
});

describe('agrupamiento decidido por el modelo', () => {
  /** Clasificador simulado: manda al primer tema todo lo que hable de agua. */
  const matcher = {
    match: (question: string, topics: Array<{ id: string; label: string }>) => {
      const sobreAgua = /llov|lluvia|agua/i.test(question);
      const tema = topics.find((t) => /llov|lluvia|agua/i.test(t.label));
      return Promise.resolve(sobreAgua && tema ? tema.id : null);
    },
  };

  function preguntar(app: Express, code: string, text: string, viewer: string) {
    return request(app)
      .post(`/api/rooms/${code}/questions`)
      .set('x-viewer-id', viewer)
      .send({ text, author: viewer });
  }

  it('une preguntas que no comparten ninguna palabra', async () => {
    const { app } = createApp({ dataFile: null, clientDir: null, matcher });
    const sala = await request(app).post('/api/rooms').send({ title: 'Clase' });
    const code = sala.body.code as string;

    const primera = await preguntar(app, code, '¿se viene la lluvia?', 'v1');
    const segunda = await preguntar(app, code, '¿está por llover?', 'v2');

    expect(segunda.body.isNewCluster).toBe(false);
    expect(segunda.body.clusterId).toBe(primera.body.clusterId);
  });

  it('deja que abra tema nuevo cuando el modelo dice que no corresponde', async () => {
    const { app } = createApp({ dataFile: null, clientDir: null, matcher });
    const sala = await request(app).post('/api/rooms').send({ title: 'Clase' });
    const code = sala.body.code as string;

    await preguntar(app, code, '¿se viene la lluvia?', 'v1');
    const otra = await preguntar(app, code, '¿cuándo es el parcial?', 'v2');
    expect(otra.body.isNewCluster).toBe(true);
  });

  it('si el modelo falla, la pregunta entra igual', async () => {
    // Una caída del servicio externo no puede dejar a nadie sin preguntar.
    const roto = { match: () => Promise.reject(new Error('sin servicio')) };
    const { app } = createApp({ dataFile: null, clientDir: null, matcher: roto });
    const sala = await request(app).post('/api/rooms').send({ title: 'Clase' });

    const response = await preguntar(app, sala.body.code, '¿se viene la lluvia?', 'v1');
    expect(response.status).toBe(201);
  });

  it('el motor léxico sigue actuando cuando el modelo no decide', async () => {
    const indeciso = { match: () => Promise.resolve(null) };
    const { app } = createApp({ dataFile: null, clientDir: null, matcher: indeciso });
    const sala = await request(app).post('/api/rooms').send({ title: 'Clase' });
    const code = sala.body.code as string;

    await preguntar(app, code, '¿Cómo se resuelve una integral por partes?', 'v1');
    const segunda = await preguntar(app, code, 'integrales por partes cómo se resuelven', 'v2');
    expect(segunda.body.isNewCluster).toBe(false);
  });

  it('ninguna respuesta expone la credencial', async () => {
    const { app } = createApp({
      dataFile: null,
      clientDir: null,
      adminPassword: 'clave-docente',
      matcher,
    });
    const sala = await request(app).post('/api/rooms').send({ title: 'Clase' });
    const code = sala.body.code as string;
    await preguntar(app, code, '¿se viene la lluvia?', 'v1');

    // El cliente sólo puede saber si la función está activa, nunca con qué clave.
    for (const ruta of ['/api/config', '/api/health', `/api/rooms/${code}/board`]) {
      const cuerpo = JSON.stringify((await request(app).get(ruta)).body);
      expect(cuerpo).not.toMatch(/sk-ant/);
      expect(cuerpo).not.toMatch(/apiKey/i);
      expect(cuerpo).not.toMatch(/ANTHROPIC/i);
    }

    expect((await request(app).get('/api/config')).body.smartGrouping).toBe(true);
  });
});

describe('diagnóstico del agrupamiento', () => {
  const matcher = {
    match: (_q: string, topics: Array<{ id: string }>) =>
      Promise.resolve(topics[0]?.id ?? null),
  };

  function preguntar(app: Express, code: string, text: string, viewer: string) {
    return request(app)
      .post(`/api/rooms/${code}/questions`)
      .set('x-viewer-id', viewer)
      .send({ text, author: viewer });
  }

  it('informa qué señal agrupó cada pregunta', async () => {
    // Sin esto, "no parece estar usando la API" no se puede ni confirmar ni
    // desmentir desde afuera.
    const { app } = createApp({ dataFile: null, clientDir: null, matcher });
    const sala = await request(app).post('/api/rooms').send({ title: 'Clase' });
    const code = sala.body.code as string;

    const primera = await preguntar(app, code, 'primera pregunta del día', 'v1');
    expect(primera.body.groupedBy).toBe('tema-nuevo');

    const segunda = await preguntar(app, code, 'algo totalmente distinto', 'v2');
    expect(segunda.body.groupedBy).toBe('claude');
  });

  it('dice "palabras" cuando agrupó el motor léxico', async () => {
    const { app } = createApp({ dataFile: null, clientDir: null, matcher: null });
    const sala = await request(app).post('/api/rooms').send({ title: 'Clase' });
    const code = sala.body.code as string;

    await preguntar(app, code, '¿Cómo se resuelve una integral por partes?', 'v1');
    const segunda = await preguntar(app, code, 'integrales por partes cómo se resuelven', 'v2');
    expect(segunda.body.groupedBy).toBe('palabras');
  });
});
