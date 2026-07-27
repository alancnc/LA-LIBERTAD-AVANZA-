import { buildIdf, buildProfile, similarity, type TextProfile } from './similarity.js';

export interface ClusterCandidate {
  clusterId: string;
  /** Textos ya asignados a ese grupo. */
  texts: string[];
}

export interface MatchResult {
  /** Grupo elegido, o null si la pregunta abre un tema nuevo. */
  clusterId: string | null;
  /** Similitud alcanzada contra ese grupo. */
  score: number;
}

/** Umbral por defecto: calibrado para juntar reformulaciones sin mezclar temas. */
export const DEFAULT_THRESHOLD = 0.42;

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

/**
 * Decide a qué grupo pertenece una pregunta nueva.
 *
 * El IDF se recalcula sobre todo el corpus de la sala más la pregunta entrante,
 * de modo que las palabras que ya usó media clase pierden peso automáticamente.
 * La asignación se toma una sola vez, al ingresar: los grupos existentes no se
 * rearman solos, así el docente no ve el ranking reordenarse bajo sus pies.
 */
export function findBestCluster(
  text: string,
  candidates: ClusterCandidate[],
  threshold: number = DEFAULT_THRESHOLD,
): MatchResult {
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
  for (const candidate of candidates) {
    const members = memberProfiles.get(candidate.clusterId) ?? [];
    const score = scoreAgainstCluster(profile, members, idf);
    if (score > bestScore) {
      bestScore = score;
      bestId = candidate.clusterId;
    }
  }

  if (bestId === null || bestScore < threshold) {
    return { clusterId: null, score: bestScore };
  }
  return { clusterId: bestId, score: bestScore };
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
