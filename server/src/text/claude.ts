/**
 * Agrupamiento decidido por un modelo de lenguaje.
 *
 * Es la señal más precisa de las tres: entiende que "¿se viene la lluvia?" y
 * "¿está por llover?" son la misma pregunta, y también que "¿cuándo es el
 * parcial?" y "¿qué entra en el parcial?" no lo son, cosa que ni las palabras
 * ni la cercanía de vectores distinguen bien.
 *
 * La clave nunca sale de este módulo: no se registra, no se devuelve en ninguna
 * respuesta y no llega al navegador. El cliente sólo ve un booleano que dice si
 * la función está activa.
 */

/** Un tema existente, tal como se le presenta al modelo. */
export interface TopicOption {
  id: string;
  label: string;
  /** Un par de preguntas del grupo, para que se entienda su alcance. */
  examples: string[];
}

/** Decide a qué tema pertenece una pregunta, o null si abre uno nuevo. */
export interface TopicMatcher {
  match(question: string, topics: TopicOption[]): Promise<string | null>;
}

const SYSTEM_PROMPT = `Agrupás preguntas de una audiencia en vivo por tema.

Recibís una pregunta nueva y una lista numerada de temas ya existentes.
Respondés únicamente con un JSON: {"tema": N} donde N es el número del tema al
que pertenece, o {"tema": null} si la pregunta plantea un tema distinto.

Criterio: dos preguntas van al mismo tema cuando una sola respuesta las
satisface a ambas. Las mismas palabras no alcanzan; el sentido sí.

Van juntas: "¿se viene la lluvia?" y "¿está por llover?".
Van separadas: "¿cuándo es el parcial?" y "¿qué entra en el parcial?", porque
piden cosas distintas aunque compartan el tema general.

Ante la duda, respondé null: es preferible un tema de más, que se puede
fusionar, a mezclar dos preguntas que necesitan respuestas diferentes.`;

export interface ClaudeMatcherOptions {
  apiKey: string;
  model?: string;
  /** Corta la espera para no agotar el presupuesto de la función. */
  timeoutMs?: number;
  /** Cuántos temas se le muestran. Los más pedidos van primero. */
  maxTopics?: number;
}

export class ClaudeTopicMatcher implements TopicMatcher {
  /**
   * Campo privado de JavaScript, no sólo de TypeScript.
   *
   * `private` de TS desaparece al compilar: la propiedad queda visible y
   * `JSON.stringify` del objeto vuelca la credencial. Con `#` no existe fuera
   * de la clase, así que un log descuidado no la puede exponer.
   */
  readonly #apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxTopics: number;

  constructor(options: ClaudeMatcherOptions) {
    this.#apiKey = options.apiKey;
    this.model = options.model ?? 'claude-haiku-4-5-20251001';
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.maxTopics = options.maxTopics ?? 40;
  }

  async match(question: string, topics: TopicOption[]): Promise<string | null> {
    if (topics.length === 0) return null;

    const visibles = topics.slice(0, this.maxTopics);
    const listado = visibles
      .map((topic, index) => {
        const ejemplos = topic.examples
          .slice(0, 2)
          .filter((texto) => texto !== topic.label)
          .map((texto) => `\n   también: ${texto}`)
          .join('');
        return `${index + 1}. ${topic.label}${ejemplos}`;
      })
      .join('\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.#apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 64,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Temas existentes:\n${listado}\n\nPregunta nueva:\n${question}`,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // El cuerpo del error puede incluir detalles de la cuenta: se resume.
        throw new Error(`Claude respondió ${response.status}`);
      }

      const payload = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const texto = (payload.content ?? [])
        .filter((bloque) => bloque.type === 'text')
        .map((bloque) => bloque.text ?? '')
        .join('');

      return this.resolveTopic(texto, visibles);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Traduce la respuesta del modelo a un id de tema.
   *
   * Se valida el número contra la lista que efectivamente se envió: un índice
   * inventado o fuera de rango se trata como "tema nuevo" en lugar de mandar la
   * pregunta a un grupo cualquiera.
   */
  private resolveTopic(texto: string, topics: TopicOption[]): string | null {
    const json = /\{[^}]*\}/.exec(texto)?.[0];
    if (!json) return null;

    let parsed: { tema?: unknown };
    try {
      parsed = JSON.parse(json) as { tema?: unknown };
    } catch {
      return null;
    }

    const numero = typeof parsed.tema === 'number' ? parsed.tema : Number(parsed.tema);
    if (!Number.isInteger(numero) || numero < 1 || numero > topics.length) return null;
    return topics[numero - 1]?.id ?? null;
  }
}

/**
 * Arma el clasificador a partir del entorno.
 *
 * Sin `ANTHROPIC_API_KEY` devuelve null y la aplicación agrupa por palabras,
 * como siempre. La clave se lee del entorno del servidor y nunca se expone.
 */
export function createTopicMatcher(
  env: Record<string, string | undefined> = process.env,
): TopicMatcher | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new ClaudeTopicMatcher({
    apiKey,
    model: env.ANTHROPIC_MODEL?.trim() || undefined,
  });
}
