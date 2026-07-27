import { tokenize, trigrams } from './normalize.js';

/** Representación pre-calculada de una pregunta, lista para comparar. */
export interface TextProfile {
  /** Tokens únicos, ya normalizados y reducidos a su raíz. */
  tokens: string[];
  trigrams: Set<string>;
}

/**
 * Peso de cada señal en el puntaje final.
 * Los tokens mandan (capturan el tema); los trigramas aportan una señal de
 * respaldo sobre la frase completa.
 */
const TOKEN_WEIGHT = 0.7;
const TRIGRAM_WEIGHT = 0.3;

/**
 * Cuánto se tienen que parecer dos palabras para considerarlas la misma.
 * 0.8 acepta "parcial"/"parsial" (una letra de diferencia sobre siete) y
 * rechaza pares que apenas comparten prefijo.
 */
const FUZZY_TOKEN_THRESHOLD = 0.8;

export function buildProfile(text: string): TextProfile {
  return {
    tokens: [...new Set(tokenize(text))],
    trigrams: trigrams(text),
  };
}

/**
 * IDF suavizado sobre el corpus de la sala. Hace que "derivada" pese mucho más
 * que "tema" cuando media clase usa la segunda palabra.
 */
export function buildIdf(profiles: TextProfile[]): Map<string, number> {
  const documentFrequency = new Map<string, number>();
  for (const profile of profiles) {
    for (const token of profile.tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const total = profiles.length;
  const idf = new Map<string, number>();
  for (const [token, freq] of documentFrequency) {
    idf.set(token, Math.log((total + 1) / (freq + 0.5)) + 1);
  }
  return idf;
}

/** Peso de un token ausente del corpus: se lo trata como muy informativo. */
function idfFor(idf: Map<string, number>, token: string): number {
  return idf.get(token) ?? Math.log(2) + 1;
}

/** Distancia de edición de Levenshtein, con corte temprano. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    // Si toda la fila ya superó el máximo tolerado, no hace falta seguir.
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * Similitud entre dos palabras: 1 si son idénticas, algo menos si difieren en
 * unos pocos caracteres (typos), 0 si no se parecen.
 */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  // En palabras muy cortas cualquier cambio de letra da otra palabra distinta.
  if (longest < 5) return 0;

  const tolerance = Math.floor(longest * (1 - FUZZY_TOKEN_THRESHOLD));
  if (tolerance < 1) return 0;

  const distance = editDistance(a, b, tolerance);
  if (distance > tolerance) return 0;
  return 1 - distance / longest;
}

/** Mejor coincidencia de un token contra todos los de la otra pregunta. */
function bestMatch(token: string, others: string[]): number {
  let best = 0;
  for (const other of others) {
    const score = tokenSimilarity(token, other);
    if (score > best) best = score;
    if (best === 1) break;
  }
  return best;
}

/**
 * Cobertura ponderada de A dentro de B: qué proporción del "contenido
 * informativo" de A (medido en IDF) aparece también en B.
 */
function coverage(a: TextProfile, b: TextProfile, idf: Map<string, number>): number {
  let matched = 0;
  let total = 0;
  for (const token of a.tokens) {
    const weight = idfFor(idf, token);
    total += weight;
    matched += weight * bestMatch(token, b.tokens);
  }
  return total === 0 ? 0 : matched / total;
}

/**
 * Solapamiento de tokens entre dos preguntas.
 *
 * Se usa la media geométrica de ambas coberturas para que una pregunta corta
 * contenida en una larga no puntúe alto por sí sola: "el parcial" está
 * íntegramente dentro de "cómo se prepara el parcial de integrales", pero no
 * son la misma consulta.
 */
export function tokenOverlap(
  a: TextProfile,
  b: TextProfile,
  idf: Map<string, number>,
): number {
  if (a.tokens.length === 0 || b.tokens.length === 0) return 0;
  return Math.sqrt(coverage(a, b, idf) * coverage(b, a, idf));
}

/** Jaccard entre los conjuntos de trigramas. */
export function trigramSimilarity(a: TextProfile, b: TextProfile): number {
  if (a.trigrams.size === 0 || b.trigrams.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.trigrams.size <= b.trigrams.size
    ? [a.trigrams, b.trigrams]
    : [b.trigrams, a.trigrams];
  for (const gram of small) {
    if (large.has(gram)) intersection += 1;
  }
  const union = a.trigrams.size + b.trigrams.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Similitud combinada entre dos preguntas, en [0..1].
 * 1 = prácticamente la misma pregunta; 0 = sin nada en común.
 */
export function similarity(
  a: TextProfile,
  b: TextProfile,
  idf: Map<string, number>,
): number {
  return TOKEN_WEIGHT * tokenOverlap(a, b, idf) + TRIGRAM_WEIGHT * trigramSimilarity(a, b);
}
