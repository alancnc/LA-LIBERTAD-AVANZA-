import { buildIdf, buildProfile, similarity, type TextProfile } from './similarity.js';
import { cosine, DEFAULT_SEMANTIC_THRESHOLD } from './embeddings.js';

export interface ClusterCandidate {
  clusterId: string;
  /** Textos ya asignados a ese grupo. */
  texts: string[];
  /**
   * Vectores de esos mismos textos, en el mismo orden. `null` donde no haya
   * (una pregunta anterior a que se activara la comparación semántica, o una
   * cuyo cálculo falló).
   */
  embeddings?: Array<number[] | null>;
}

export interface MatchResult {
  /** Grupo elegido, o null si la pregunta abre un tema nuevo. */
  clusterId: string | null;
  /** Similitud alcanzada contra ese grupo. */
  score: number;
  /** Qué señal decidió la asignación. */
  method: 'lexico' | 'semantico' | 'ninguno';
}

/** Umbral por defecto: calibrado para juntar reformulaciones sin mezclar temas. */
export const DEFAULT_THRESHOLD = 0.42;

export interface MatchOptions {
  threshold?: number;
  /** Vector de la pregunta entrante, si la comparación semántica está activa. */
  embedding?: number[] | null;
  semanticThreshold?: number;
}

/**
 * Similitud entre una pregunta y un grupo, usando enlace promedio.
 *
 * Se promedia contra todos los miembros en lugar de quedarse con el máximo
 * para evitar el efecto cadena: que A se parezca a B y B a C no debería
 * arrastrar a C al grupo de A si A y C no tienen nada que ver.
 */
export function scoreAgainstCluster(
  profile: TextProfile,
  members: TextProfile[],
  idf: Map<string, number>,
): number {
  if (members.length === 0) return 0;
  let total = 0;
  for (const member of members) {
    total += similarity(profile, member, idf);
  }
  return total / members.length;
}

/** Cercanía de sentido contra un grupo, promediada sobre los miembros con vector. */
export function semanticScoreAgainstCluster(
  embedding: number[],
  members: Array<number[] | null>,
): number {
  let total = 0;
  let contados = 0;
  for (const member of members) {
    if (!member || member.length === 0) continue;
    total += cosine(embedding, member);
    contados += 1;
  }
  return contados === 0 ? 0 : total / contados;
}

/**
 * Decide a qué grupo pertenece una pregunta nueva.
 *
 * Hay dos señales independientes y alcanza con que una se convenza:
 *
 * - **Léxica**: comparte palabras. Barata, sin dependencias, y muy segura
 *   cuando la gente reformula usando el mismo vocabulario.
 * - **Semántica**: los vectores están cerca. Es la única que puede unir
 *   "¿se viene la lluvia?" con "¿está por llover?", que no comparten ni una
 *   palabra. Requiere tener configurado un proveedor de embeddings.
 *
 * Cada una tiene su propio umbral, así que se comparan normalizadas contra el
 * suyo para poder elegir el mejor grupo entre las dos escalas.
 */
export function findBestCluster(
  text: string,
  candidates: ClusterCandidate[],
  options: MatchOptions | number = {},
): MatchResult {
  // Se acepta un número por compatibilidad: durante mucho tiempo el tercer
  // argumento fue directamente el umbral léxico.
  const config: MatchOptions = typeof options === 'number' ? { threshold: options } : options;
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  const semanticThreshold = config.semanticThreshold ?? DEFAULT_SEMANTIC_THRESHOLD;
  const embedding = config.embedding ?? null;

  const profile = buildProfile(text);

  const memberProfiles = new Map<string, TextProfile[]>();
  const corpus: TextProfile[] = [profile];
  for (const candidate of candidates) {
    const profiles = candidate.texts.map(buildProfile);
    memberProfiles.set(candidate.clusterId, profiles);
    corpus.push(...profiles);
  }

  const idf = buildIdf(corpus);

  let bestId: string | null = null;
  let bestScore = 0;
  let bestMethod: MatchResult['method'] = 'ninguno';
  // Confianza relativa a cada umbral: 1 es "justo en el límite".
  let bestConfidence = 0;

  for (const candidate of candidates) {
    const members = memberProfiles.get(candidate.clusterId) ?? [];
    const lexical = scoreAgainstCluster(profile, members, idf);
    const semantic =
      embedding && embedding.length > 0
        ? semanticScoreAgainstCluster(embedding, candidate.embeddings ?? [])
        : 0;

    const lexicalConfidence = lexical / threshold;
    const semanticConfidence = semantic / semanticThreshold;
    const useSemantic = semanticConfidence > lexicalConfidence;
    const confidence = useSemantic ? semanticConfidence : lexicalConfidence;

    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestScore = useSemantic ? semantic : lexical;
      bestMethod = useSemantic ? 'semantico' : 'lexico';
      bestId = candidate.clusterId;
    }
  }

  if (bestId === null || bestConfidence < 1) {
    return { clusterId: null, score: bestScore, method: 'ninguno' };
  }
  return { clusterId: bestId, score: bestScore, method: bestMethod };
}

/**
 * Agrupa una lista de textos desde cero. No se usa en el flujo en vivo
 * (ahí la asignación es incremental) pero sí para analizar un histórico
 * y para verificar el comportamiento del umbral en los tests.
 */
export function clusterAll(
  texts: string[],
  threshold: number = DEFAULT_THRESHOLD,
): number[][] {
  const profiles = texts.map(buildProfile);
  const idf = buildIdf(profiles);
  const groups: number[][] = [];

  texts.forEach((_, index) => {
    const profile = profiles[index]!;
    let bestGroup = -1;
    let bestScore = 0;

    groups.forEach((group, groupIndex) => {
      const members = group.map((memberIndex) => profiles[memberIndex]!);
      const score = scoreAgainstCluster(profile, members, idf);
      if (score > bestScore) {
        bestScore = score;
        bestGroup = groupIndex;
      }
    });

    if (bestGroup >= 0 && bestScore >= threshold) {
      groups[bestGroup]!.push(index);
    } else {
      groups.push([index]);
    }
  });

  return groups;
}
