/**
 * Caché de lectura de vida muy corta.
 *
 * Existe por una razón concreta: en una clase de 200 personas, las 200 sondean
 * la misma sala y cada sondeo leía la base entera por su cuenta. Doscientas
 * lecturas por segundo del mismo dato, que además es idéntico para todas. Con
 * esto la base se lee una vez cada `ttlMs` y el resultado se reparte.
 *
 * Guarda la promesa y no el valor: si llegan cincuenta peticiones a la vez y no
 * hay nada cacheado, todas esperan la misma consulta en lugar de disparar
 * cincuenta. Esa es la mitad del ahorro, y sólo se consigue cacheando antes de
 * que la consulta termine.
 *
 * La vida corta es a propósito. En serverless conviven varias instancias y cada
 * una tiene su propia copia, así que no hay forma de invalidarlas todas: lo que
 * acota el desfase es el tiempo, no la coordinación. Con unos pocos segundos, y
 * un sondeo cada diez, nadie lo nota.
 */
export class TtlCache<T> {
  readonly #entries = new Map<string, { value: Promise<T>; expires: number }>();

  /**
   * @param ttlMs Cuánto vale una lectura. Con 0 la caché queda desactivada,
   *   que es lo que corresponde cuando hay un solo proceso y ningún costo por
   *   transferencia.
   * @param max Tope de salas distintas en memoria, para que un proceso de larga
   *   vida no acumule salas viejas para siempre.
   */
  constructor(
    private readonly ttlMs: number,
    private readonly max = 500,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) return load();

    const ahora = Date.now();
    const guardada = this.#entries.get(key);
    if (guardada && guardada.expires > ahora) return guardada.value;

    const value = load().catch((error: unknown) => {
      // Un fallo no se cachea: la siguiente petición tiene que volver a
      // intentarlo, no heredar el error durante todo el TTL.
      this.#entries.delete(key);
      throw error;
    });

    if (this.#entries.size >= this.max) this.#prune(ahora);
    this.#entries.set(key, { value, expires: ahora + this.ttlMs });
    return value;
  }

  /** Olvida una entrada: se usa al escribir, para que el cambio se vea ya. */
  invalidate(key: string): void {
    this.#entries.delete(key);
  }

  /** Saca lo vencido y, si aun así está lleno, lo más viejo. */
  #prune(ahora: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.expires <= ahora) this.#entries.delete(key);
    }
    while (this.#entries.size >= this.max) {
      const primera = this.#entries.keys().next();
      if (primera.done) break;
      this.#entries.delete(primera.value);
    }
  }
}
