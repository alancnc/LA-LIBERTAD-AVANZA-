import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from './types.js';

/**
 * Persistencia en un único archivo JSON.
 *
 * Alcanza de sobra para el caso de uso (una clase, cientos de preguntas) y evita
 * dependencias nativas: la base entra en memoria y se vuelca en cada escritura.
 */

const EMPTY_DB: Database = { rooms: [], clusters: [], questions: [] };

export class Store {
  private data: Database = structuredClone(EMPTY_DB);
  private readonly file: string | null;
  private writeScheduled = false;

  /** `file: null` mantiene todo en memoria (se usa en los tests). */
  constructor(file: string | null) {
    this.file = file;
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.load();
    }
  }

  private load(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Database>;
      this.data = {
        rooms: parsed.rooms ?? [],
        clusters: parsed.clusters ?? [],
        questions: parsed.questions ?? [],
      };
    } catch (error) {
      // Un archivo corrupto no debe impedir que arranque el servidor: se
      // preserva a un lado para poder inspeccionarlo y se empieza limpio.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, backup);
      console.error(`No se pudo leer la base, se movió a ${backup}:`, error);
      this.data = structuredClone(EMPTY_DB);
    }
  }

  /**
   * Vuelca la base al disco. Se agrupa en un microtask para que una operación
   * que toca varias tablas escriba una sola vez, y se hace vía archivo temporal
   * + rename para que nunca quede un JSON a medio escribir.
   */
  private scheduleWrite(): void {
    if (!this.file || this.writeScheduled) return;
    this.writeScheduled = true;
    queueMicrotask(() => {
      this.writeScheduled = false;
      if (!this.file) return;
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(temp, this.file);
    });
  }

  /** Ejecuta una mutación sobre la base y persiste el resultado. */
  update<T>(mutation: (data: Database) => T): T {
    const result = mutation(this.data);
    this.scheduleWrite();
    return result;
  }

  /** Lectura directa: quien la use no debe mutar el resultado. */
  read(): Database {
    return this.data;
  }

  /** Fuerza la escritura pendiente (usado al apagar el proceso). */
  flushSync(): void {
    if (!this.file) return;
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }
}

export function newId(): string {
  return randomUUID();
}

/** Alfabeto sin caracteres ambiguos: nadie confunde O con 0 al dictar el código. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Código de sala corto, fácil de leer en voz alta y de tipear. */
export function generateRoomCode(isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!isTaken(code)) return code;
  }
  // Con 32^6 combinaciones esto es prácticamente inalcanzable, pero si el
  // espacio corto se agotara preferimos un código largo antes que fallar.
  return `${Date.now().toString(36).toUpperCase()}`;
}

export function generateAdminKey(): string {
  return randomUUID().replace(/-/g, '');
}
