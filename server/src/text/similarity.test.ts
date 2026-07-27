import { describe, expect, it } from 'vitest';
import { normalizeText, stem, tokenize, trigrams } from './normalize.js';
import { buildIdf, buildProfile, similarity } from './similarity.js';
import { clusterAll, DEFAULT_THRESHOLD, findBestCluster } from './cluster.js';

describe('normalizeText', () => {
  it('quita acentos, signos y mayúsculas', () => {
    expect(normalizeText('¿Cómo se calcula la Función?')).toBe('como se calcula la funcion');
  });

  it('colapsa espacios repetidos', () => {
    expect(normalizeText('hola    mundo')).toBe('hola mundo');
  });
});

describe('stem', () => {
  it('unifica singular y plural', () => {
    expect(stem('integrales')).toBe(stem('integral'));
  });

  it('no destruye palabras cortas', () => {
    expect(stem('red')).toBe('red');
    expect(stem('gas')).toBe('gas');
  });
});

describe('tokenize', () => {
  it('descarta stopwords y muletillas de clase', () => {
    expect(tokenize('profe, una consulta sobre la derivada')).toEqual([tokenize('derivada')[0]]);
  });

  it('devuelve vacío cuando la frase no aporta contenido', () => {
    expect(tokenize('hola profe, una consulta')).toEqual([]);
  });

  it('expande abreviaturas de chat', () => {
    expect(tokenize('el tp')).toEqual(tokenize('el trabajo práctico'));
    expect(tokenize('xq')).toEqual([]); // "porque" es stopword
  });
});

describe('trigrams', () => {
  it('genera trigramas con bordes de palabra', () => {
    const grams = trigrams('sol');
    expect(grams.has(' so')).toBe(true);
    expect(grams.has('ol ')).toBe(true);
  });
});

/** Compara dos frases usando el IDF del conjunto que se le pase de contexto. */
function scoreOf(a: string, b: string, context: string[] = []): number {
  const profileA = buildProfile(a);
  const profileB = buildProfile(b);
  const idf = buildIdf([profileA, profileB, ...context.map(buildProfile)]);
  return similarity(profileA, profileB, idf);
}

describe('similarity', () => {
  it('da 1 a la misma pregunta escrita igual', () => {
    expect(scoreOf('cómo se resuelve una integral', 'cómo se resuelve una integral')).toBeCloseTo(
      1,
      5,
    );
  });

  it('reconoce la misma pregunta reformulada', () => {
    const score = scoreOf(
      '¿Cómo se resuelve una integral por partes?',
      'no entiendo la resolución de integrales por partes',
    );
    expect(score).toBeGreaterThan(DEFAULT_THRESHOLD);
  });

  it('tolera errores de tipeo', () => {
    const score = scoreOf('cuándo entra el parcial de derivadas', 'cuando entra el parsial de derivadas');
    expect(score).toBeGreaterThan(DEFAULT_THRESHOLD);
  });

  it('separa temas distintos', () => {
    const score = scoreOf(
      '¿Cuándo es la fecha del parcial?',
      '¿Cómo se deriva una función compuesta?',
    );
    expect(score).toBeLessThan(DEFAULT_THRESHOLD);
  });

  it('ignora el saludo y se queda con el tema', () => {
    const score = scoreOf(
      'hola profe, consulta: ¿la entrega del TP es el viernes?',
      '¿la entrega del tp es el viernes?',
    );
    expect(score).toBeGreaterThan(DEFAULT_THRESHOLD);
  });

  it('entiende las abreviaturas como si fueran la palabra completa', () => {
    const score = scoreOf(
      '¿El trabajo práctico se entrega en grupo o individual?',
      'el tp es grupal o individual?',
    );
    expect(score).toBeGreaterThan(DEFAULT_THRESHOLD);
  });

  it('nunca sale del rango [0..1]', () => {
    const score = scoreOf('algo', 'otra cosa completamente distinta');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('devuelve 0 si una frase no tiene contenido', () => {
    expect(scoreOf('hola profe', 'derivada de una función')).toBeLessThan(0.2);
  });
});

describe('clusterAll', () => {
  it('junta las reformulaciones y separa los temas', () => {
    const preguntas = [
      '¿Cómo se resuelve una integral por partes?',
      'no entiendo integrales por partes, cómo se resuelven',
      'profe, integral por partes cómo se resuelve?',
      '¿Cuándo es el parcial?',
      '¿qué día es el parcial?',
      '¿El TP se entrega en grupo o individual?',
    ];

    const groups = clusterAll(preguntas);
    const sizes = groups.map((group) => group.length).sort((a, b) => b - a);

    expect(sizes[0]).toBe(3);
    expect(groups.length).toBeGreaterThanOrEqual(3);

    // Las tres formas de preguntar por integrales caen en el mismo grupo.
    const integrales = groups.find((group) => group.includes(0))!;
    expect(integrales).toContain(1);
    expect(integrales).toContain(2);
    expect(integrales).not.toContain(3);
  });

  it('deja cada pregunta sola cuando no hay nada parecido', () => {
    const groups = clusterAll([
      '¿Cómo se deriva?',
      '¿Cuándo cierra la cursada?',
      '¿Dónde subo el trabajo práctico?',
    ]);
    expect(groups).toHaveLength(3);
  });

  it('no arma grupos con una lista vacía', () => {
    expect(clusterAll([])).toEqual([]);
  });
});

describe('findBestCluster', () => {
  it('abre tema nuevo cuando no hay grupos', () => {
    const result = findBestCluster('¿Cómo se deriva?', []);
    expect(result.clusterId).toBeNull();
  });

  it('elige el grupo del mismo tema', () => {
    const candidates = [
      { clusterId: 'integrales', texts: ['¿Cómo se resuelve una integral por partes?'] },
      { clusterId: 'parcial', texts: ['¿Cuándo es el parcial?'] },
    ];
    const result = findBestCluster('integrales por partes cómo se resuelven', candidates);
    expect(result.clusterId).toBe('integrales');
  });

  it('abre tema nuevo si nada supera el umbral', () => {
    const candidates = [{ clusterId: 'parcial', texts: ['¿Cuándo es el parcial?'] }];
    const result = findBestCluster('¿dónde consigo la bibliografía de la materia?', candidates);
    expect(result.clusterId).toBeNull();
  });

  it('respeta un umbral más exigente', () => {
    const candidates = [
      { clusterId: 'integrales', texts: ['¿Cómo se resuelve una integral por partes?'] },
    ];
    const laxo = findBestCluster('integrales por partes', candidates, 0.3);
    const estricto = findBestCluster('integrales por partes', candidates, 0.95);
    expect(laxo.clusterId).toBe('integrales');
    expect(estricto.clusterId).toBeNull();
  });
});
