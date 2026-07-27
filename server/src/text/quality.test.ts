import { describe, expect, it } from 'vitest';
import { LABELED_QUESTIONS } from './fixtures.js';
import { clusterAll, DEFAULT_THRESHOLD } from './cluster.js';

/**
 * Red de contención sobre la calidad del agrupamiento.
 *
 * Cualquier cambio en la normalización, la similitud o el umbral se mide contra
 * el conjunto etiquetado de `fixtures.ts`. Si una mejora aparente empeora el
 * resultado global, estos tests lo detectan.
 */

interface Quality {
  clusters: number;
  precision: number;
  recall: number;
}

function measure(threshold: number): Quality {
  const groups = clusterAll(
    LABELED_QUESTIONS.map((question) => question.text),
    threshold,
  );

  const groupOf = new Map<number, number>();
  groups.forEach((group, groupIndex) => {
    for (const index of group) groupOf.set(index, groupIndex);
  });

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (let i = 0; i < LABELED_QUESTIONS.length; i += 1) {
    for (let j = i + 1; j < LABELED_QUESTIONS.length; j += 1) {
      const sameTopic = LABELED_QUESTIONS[i]!.topic === LABELED_QUESTIONS[j]!.topic;
      const sameGroup = groupOf.get(i) === groupOf.get(j);
      if (sameTopic && sameGroup) truePositives += 1;
      else if (!sameTopic && sameGroup) falsePositives += 1;
      else if (sameTopic && !sameGroup) falseNegatives += 1;
    }
  }

  return {
    clusters: groups.length,
    precision:
      truePositives + falsePositives === 0
        ? 1
        : truePositives / (truePositives + falsePositives),
    recall:
      truePositives + falseNegatives === 0
        ? 1
        : truePositives / (truePositives + falseNegatives),
  };
}

describe('calidad del agrupamiento con el umbral por defecto', () => {
  const quality = measure(DEFAULT_THRESHOLD);

  it('no mezcla preguntas de temas distintos', () => {
    // Prioridad del producto: un grupo mal armado esconde una pregunta bajo un
    // título que no le corresponde y el docente puede no notarlo nunca. Un tema
    // partido en dos, en cambio, se ve en el ranking y se une con un clic.
    expect(quality.precision).toBe(1);
  });

  it('junta la mayoría de las reformulaciones', () => {
    expect(quality.recall).toBeGreaterThanOrEqual(0.7);
  });

  it('reduce sustancialmente la lista que tiene que leer el docente', () => {
    // 20 preguntas sueltas contra un puñado de temas: ese es el valor de la app.
    expect(quality.clusters).toBeLessThanOrEqual(13);
  });
});

describe('comportamiento del umbral', () => {
  it('agrupa más cuando se lo baja', () => {
    expect(measure(0.3).clusters).toBeLessThan(measure(0.55).clusters);
  });

  it('nunca produce menos grupos que temas al subirlo', () => {
    expect(measure(0.6).clusters).toBeGreaterThanOrEqual(measure(0.42).clusters);
  });
});
