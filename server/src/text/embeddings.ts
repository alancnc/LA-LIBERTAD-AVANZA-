/**
 * Comparación por significado.
 *
 * El motor léxico compara palabras, así que no puede unir "¿se viene la
 * lluvia?" con "¿está por llover?": no comparten ninguna. Un modelo de
 * embeddings representa cada frase como un vector donde la cercanía es
 * cercanía de sentido, y ahí esas dos quedan pegadas.
 *
 * Es opcional: sin credenciales configuradas la aplicación sigue funcionando
 * con el motor léxico, que no depende de ningún servicio externo.
 */

/** Convierte frases en vectores. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Coseno entre dos vectores, en [-1..1]; con embeddings de texto en la
 * práctica queda en [0..1]. 1 es el mismo sentido, 0 sentidos sin relación.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface RemoteEmbedderOptions {
  apiKey: string;
  /** Endpoint compatible con la API de embeddings de OpenAI. */
  url: string;
  model: string;
  /** Corta la espera para no agotar el presupuesto de una función serverless. */
  timeoutMs?: number;
}

/**
 * Cliente para cualquier endpoint compatible con la API de embeddings de
 * OpenAI. Sirve para OpenAI y para los proveedores que replican ese formato.
 */
export class RemoteEmbedder implements Embedder {
  constructor(private readonly options: RemoteEmbedderOptions) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8000);
    try {
      const response = await fetch(this.options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({ model: this.options.model, input: texts }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`El proveedor de embeddings respondió ${response.status}: ${detail.slice(0, 200)}`);
      }

      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[]; index?: number }>;
      };
      const data = payload.data ?? [];
      if (data.length !== texts.length) {
        throw new Error(`Se pidieron ${texts.length} vectores y llegaron ${data.length}`);
      }

      // El orden de la respuesta no está garantizado: cada elemento trae su
      // índice y es el que manda.
      const vectors: number[][] = new Array<number[]>(texts.length);
      data.forEach((item, position) => {
        vectors[item.index ?? position] = item.embedding ?? [];
      });
      return vectors;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Umbral de coseno a partir del cual dos frases se consideran lo mismo. */
export const DEFAULT_SEMANTIC_THRESHOLD = 0.62;

export interface SemanticConfig {
  embedder: Embedder | null;
  threshold: number;
}

/**
 * Arma el comparador semántico a partir del entorno.
 *
 * Sin `EMBEDDINGS_API_KEY` devuelve `embedder: null` y todo sigue funcionando
 * con el motor léxico.
 */
export function createSemanticConfig(
  env: Record<string, string | undefined> = process.env,
): SemanticConfig {
  const threshold = Number(env.SEMANTIC_THRESHOLD);
  const config: SemanticConfig = {
    embedder: null,
    threshold:
      Number.isFinite(threshold) && threshold > 0 && threshold < 1
        ? threshold
        : DEFAULT_SEMANTIC_THRESHOLD,
  };

  const apiKey = env.EMBEDDINGS_API_KEY?.trim();
  if (!apiKey) return config;

  config.embedder = new RemoteEmbedder({
    apiKey,
    url: env.EMBEDDINGS_URL?.trim() || 'https://api.openai.com/v1/embeddings',
    model: env.EMBEDDINGS_MODEL?.trim() || 'text-embedding-3-small',
  });
  return config;
}
