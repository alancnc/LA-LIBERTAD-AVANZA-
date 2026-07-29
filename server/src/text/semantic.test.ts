import { describe, expect, it, vi } from 'vitest';
import { cosine, createSemanticConfig, RemoteEmbedder, type Embedder } from './embeddings.js';
import { findBestCluster } from './cluster.js';

describe('cosine', () => {
  it('da 1 a dos vectores iguales', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('ignora la magnitud y mira sólo la dirección', () => {
    expect(cosine([1, 0], [10, 0])).toBeCloseTo(1, 6);
  });

  it('da 0 a direcciones perpendiculares', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('devuelve 0 ante vectores vacíos o de distinto tamaño', () => {
    expect(cosine([], [])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

/**
 * Vectores fabricados a mano: las frases sobre lluvia apuntan a una dirección
 * y las del parcial a otra. Permite probar el agrupamiento por significado sin
 * depender de un servicio externo.
 */
const VECTORES: Record<string, number[]> = {
  '¿se viene la lluvia?': [1, 0, 0],
  '¿está por llover?': [0.97, 0.24, 0],
  'va a caer agua hoy?': [0.95, 0.3, 0],
  '¿cuándo es el parcial?': [0, 0, 1],
  '¿qué día es el examen?': [0, 0.2, 0.98],
};

const embedderFalso: Embedder = {
  embed: (texts) => Promise.resolve(texts.map((text) => VECTORES[text] ?? [0, 1, 0])),
};

async function vectorDe(texto: string): Promise<number[]> {
  const [vector] = await embedderFalso.embed([texto]);
  return vector!;
}

describe('agrupamiento por significado', () => {
  it('une preguntas que no comparten ni una palabra', async () => {
    // Es el caso que el motor léxico no puede resolver: "lluvia" y "llover"
    // no coinciden como palabras, pero significan lo mismo.
    const resultado = findBestCluster('¿está por llover?', [
      {
        clusterId: 'lluvia',
        texts: ['¿se viene la lluvia?'],
        embeddings: [VECTORES['¿se viene la lluvia?']!],
      },
    ], {
      embedding: await vectorDe('¿está por llover?'),
    });

    expect(resultado.clusterId).toBe('lluvia');
    expect(resultado.method).toBe('semantico');
  });

  it('sigue separando los temas distintos', async () => {
    const resultado = findBestCluster('¿cuándo es el parcial?', [
      {
        clusterId: 'lluvia',
        texts: ['¿se viene la lluvia?'],
        embeddings: [VECTORES['¿se viene la lluvia?']!],
      },
    ], {
      embedding: await vectorDe('¿cuándo es el parcial?'),
    });

    expect(resultado.clusterId).toBeNull();
  });

  it('elige el grupo correcto entre varios', async () => {
    const candidatos = [
      {
        clusterId: 'lluvia',
        texts: ['¿se viene la lluvia?'],
        embeddings: [VECTORES['¿se viene la lluvia?']!],
      },
      {
        clusterId: 'parcial',
        texts: ['¿cuándo es el parcial?'],
        embeddings: [VECTORES['¿cuándo es el parcial?']!],
      },
    ];

    const lluvia = findBestCluster('va a caer agua hoy?', candidatos, {
      embedding: await vectorDe('va a caer agua hoy?'),
    });
    expect(lluvia.clusterId).toBe('lluvia');

    const examen = findBestCluster('¿qué día es el examen?', candidatos, {
      embedding: await vectorDe('¿qué día es el examen?'),
    });
    expect(examen.clusterId).toBe('parcial');
  });

  it('sin vector cae al motor léxico, que no puede unirlas', () => {
    const resultado = findBestCluster('¿está por llover?', [
      { clusterId: 'lluvia', texts: ['¿se viene la lluvia?'], embeddings: [null] },
    ]);
    expect(resultado.clusterId).toBeNull();
  });

  it('el motor léxico sigue funcionando aunque haya vectores', async () => {
    // Reformulaciones con las mismas palabras: no hace falta la señal semántica.
    const resultado = findBestCluster('integrales por partes cómo se resuelven', [
      {
        clusterId: 'integrales',
        texts: ['¿Cómo se resuelve una integral por partes?'],
        embeddings: [null],
      },
    ], {
      embedding: [0, 1, 0],
    });
    expect(resultado.clusterId).toBe('integrales');
    expect(resultado.method).toBe('lexico');
  });
});

describe('createSemanticConfig', () => {
  it('queda desactivada sin credenciales', () => {
    expect(createSemanticConfig({}).embedder).toBeNull();
  });

  it('se activa con una clave', () => {
    expect(createSemanticConfig({ EMBEDDINGS_API_KEY: 'sk-x' }).embedder).not.toBeNull();
  });

  it('ignora un umbral fuera de rango y usa el de por defecto', () => {
    expect(createSemanticConfig({ SEMANTIC_THRESHOLD: '5' }).threshold).toBe(
      createSemanticConfig({}).threshold,
    );
    expect(createSemanticConfig({ SEMANTIC_THRESHOLD: 'ninguno' }).threshold).toBe(
      createSemanticConfig({}).threshold,
    );
  });

  it('acepta un umbral válido', () => {
    expect(createSemanticConfig({ SEMANTIC_THRESHOLD: '0.7' }).threshold).toBe(0.7);
  });
});

describe('RemoteEmbedder', () => {
  it('respeta el índice que devuelve el proveedor, no el orden', async () => {
    // La API no garantiza el orden: cada elemento trae su posición.
    const fetchFalso = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchFalso);

    const embedder = new RemoteEmbedder({ apiKey: 'k', url: 'https://x', model: 'm' });
    expect(await embedder.embed(['primera', 'segunda'])).toEqual([[1, 0], [0, 1]]);

    vi.unstubAllGlobals();
  });

  it('avisa cuando el proveedor rechaza la petición', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('clave inválida'),
      }),
    );

    const embedder = new RemoteEmbedder({ apiKey: 'mala', url: 'https://x', model: 'm' });
    await expect(embedder.embed(['hola'])).rejects.toThrow(/401/);

    vi.unstubAllGlobals();
  });

  it('no llama al proveedor si no hay nada que convertir', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);

    expect(await new RemoteEmbedder({ apiKey: 'k', url: 'https://x', model: 'm' }).embed([])).toEqual(
      [],
    );
    expect(fetchFalso).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
