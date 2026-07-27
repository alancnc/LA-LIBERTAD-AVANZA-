import { randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

/** Alfabeto sin caracteres ambiguos: nadie confunde O con 0 al dictar el código. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Código de sala corto, fácil de leer en voz alta y de tipear. */
export async function generateRoomCode(
  isTaken: (code: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!(await isTaken(code))) return code;
  }
  // Con 32^6 combinaciones esto es prácticamente inalcanzable, pero si el
  // espacio corto se agotara preferimos un código largo antes que fallar.
  return Date.now().toString(36).toUpperCase();
}

export function generateAdminKey(): string {
  return randomUUID().replace(/-/g, '');
}
