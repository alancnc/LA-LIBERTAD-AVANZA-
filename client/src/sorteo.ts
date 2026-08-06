/**
 * Sorteo del orden de exposición.
 *
 * Vive entero en el navegador: los nombres no se mandan al servidor ni se
 * guardan en la base. Es una herramienta interna del equipo docente y no tiene
 * por qué dejar rastro en ningún lado.
 */

/**
 * Entero aleatorio en [0, max), sin sesgo y con el generador criptográfico del
 * navegador en lugar de `Math.random`.
 *
 * El descarte importa: tomar `random % max` a secas reparte el resto del rango
 * de forma despareja y les da unas milésimas de ventaja a los primeros índices.
 * Para un sorteo entre colegas eso es exactamente lo que no puede pasar, y
 * corregirlo cuesta tres líneas.
 */
export function enteroAleatorio(max: number): number {
  if (max <= 0) throw new Error('El rango tiene que ser positivo');
  const limite = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  let valor = 0;
  do {
    crypto.getRandomValues(buffer);
    valor = buffer[0] ?? 0;
  } while (valor >= limite);
  return valor % max;
}

/**
 * Fisher-Yates: cada permutación sale con la misma probabilidad.
 *
 * Devuelve el orden completo y no sólo el primero, porque de un sorteo bien
 * hecho el orden entero sale gratis y es lo que hace falta después.
 */
export function barajar<T>(items: readonly T[]): T[] {
  const resultado = [...items];
  for (let i = resultado.length - 1; i > 0; i -= 1) {
    const j = enteroAleatorio(i + 1);
    const temporal = resultado[i]!;
    resultado[i] = resultado[j]!;
    resultado[j] = temporal;
  }
  return resultado;
}

/** Normaliza un nombre y descarta repetidos, respetando el orden de carga. */
export function limpiarNombres(nombres: readonly string[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const nombre of nombres) {
    const limpio = nombre.trim().replace(/\s+/g, ' ');
    if (!limpio) continue;
    const clave = limpio.toLocaleLowerCase('es');
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(limpio);
  }
  return salida;
}
