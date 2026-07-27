/**
 * Herramienta de calibración del umbral de agrupamiento.
 *
 *   npm run calibrate -w server
 *
 * Recorre las preguntas etiquetadas de `fixtures.ts`, calcula la similitud de
 * todos los pares y muestra, para cada umbral candidato, cuántos pares del
 * mismo tema se agruparían bien y cuántos de distinto tema se mezclarían mal.
 * Es la evidencia detrás del valor de DEFAULT_THRESHOLD.
 */
import { LABELED_QUESTIONS } from '../text/fixtures.js';
import { buildIdf, buildProfile, similarity } from '../text/similarity.js';
import { clusterAll, DEFAULT_THRESHOLD } from '../text/cluster.js';

interface Pair {
  score: number;
  sameTopic: boolean;
  a: string;
  b: string;
}

const profiles = LABELED_QUESTIONS.map((question) => buildProfile(question.text));
const idf = buildIdf(profiles);

const pairs: Pair[] = [];
for (let i = 0; i < LABELED_QUESTIONS.length; i += 1) {
  for (let j = i + 1; j < LABELED_QUESTIONS.length; j += 1) {
    const left = LABELED_QUESTIONS[i]!;
    const right = LABELED_QUESTIONS[j]!;
    pairs.push({
      score: similarity(profiles[i]!, profiles[j]!, idf),
      sameTopic: left.topic === right.topic,
      a: left.text,
      b: right.text,
    });
  }
}

const positives = pairs.filter((pair) => pair.sameTopic);
const negatives = pairs.filter((pair) => !pair.sameTopic);

console.log(`${LABELED_QUESTIONS.length} preguntas, ${pairs.length} pares`);
console.log(`  ${positives.length} pares del mismo tema, ${negatives.length} de temas distintos\n`);

console.log('umbral | agrupa bien | mezcla mal | precisión | cobertura');
console.log('-------|-------------|------------|-----------|----------');
for (const threshold of [0.3, 0.34, 0.38, 0.42, 0.46, 0.5, 0.55, 0.6]) {
  const truePositives = positives.filter((pair) => pair.score >= threshold).length;
  const falsePositives = negatives.filter((pair) => pair.score >= threshold).length;
  const precision = truePositives + falsePositives === 0
    ? 1
    : truePositives / (truePositives + falsePositives);
  const recall = truePositives / positives.length;
  const marker = threshold === DEFAULT_THRESHOLD ? ' <- por defecto' : '';
  console.log(
    `${threshold.toFixed(2)}   | ${String(truePositives).padStart(11)} | ${String(falsePositives).padStart(10)} |` +
      ` ${(precision * 100).toFixed(0).padStart(8)}% | ${(recall * 100).toFixed(0).padStart(7)}%${marker}`,
  );
}

/**
 * Calidad de la partición que realmente produce el agrupador.
 *
 * Es la métrica que importa: una pregunta puede quedar lejos de otra del mismo
 * tema y aun así caer en el grupo correcto, porque se compara contra el
 * promedio del grupo y no contra un único par.
 */
function clusteringQuality(threshold: number): {
  clusters: number;
  precision: number;
  recall: number;
  f1: number;
} {
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

  const precision = truePositives + falsePositives === 0
    ? 1
    : truePositives / (truePositives + falsePositives);
  const recall = truePositives + falseNegatives === 0
    ? 1
    : truePositives / (truePositives + falseNegatives);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { clusters: groups.length, precision, recall, f1 };
}

const topicCount = new Set(LABELED_QUESTIONS.map((question) => question.topic)).size;
console.log(`\nCalidad del agrupamiento real (los temas reales son ${topicCount}):`);
console.log('umbral | temas | precisión | cobertura | F1');
console.log('-------|-------|-----------|-----------|-----');
for (const threshold of [0.3, 0.34, 0.38, 0.42, 0.46, 0.5, 0.55]) {
  const quality = clusteringQuality(threshold);
  const marker = threshold === DEFAULT_THRESHOLD ? ' <- por defecto' : '';
  console.log(
    `${threshold.toFixed(2)}   | ${String(quality.clusters).padStart(5)} |` +
      ` ${(quality.precision * 100).toFixed(0).padStart(8)}% |` +
      ` ${(quality.recall * 100).toFixed(0).padStart(8)}% |` +
      ` ${quality.f1.toFixed(2)}${marker}`,
  );
}

console.log(`\nPares del mismo tema que NO se agruparían con ${DEFAULT_THRESHOLD}:`);
const missed = positives
  .filter((pair) => pair.score < DEFAULT_THRESHOLD)
  .sort((a, b) => b.score - a.score);
if (missed.length === 0) console.log('  (ninguno)');
for (const pair of missed) {
  console.log(`  ${pair.score.toFixed(3)}  "${pair.a}"  <->  "${pair.b}"`);
}

console.log(`\nPares de distinto tema que SÍ se mezclarían con ${DEFAULT_THRESHOLD}:`);
const wrong = negatives
  .filter((pair) => pair.score >= DEFAULT_THRESHOLD)
  .sort((a, b) => b.score - a.score);
if (wrong.length === 0) console.log('  (ninguno)');
for (const pair of wrong) {
  console.log(`  ${pair.score.toFixed(3)}  "${pair.a}"  <->  "${pair.b}"`);
}
