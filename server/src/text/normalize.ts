/**
 * Normalización de texto pensada para preguntas de alumnos en español:
 * tolera acentos, mayúsculas, signos, muletillas y variantes de plural/conjugación.
 */

/** Palabras sin valor discriminante: aparecen en casi todas las preguntas. */
const STOPWORDS = new Set([
  'a', 'al', 'algo', 'alguna', 'algunas', 'alguno', 'algunos', 'ante', 'antes', 'aqui',
  'asi', 'aun', 'aunque', 'cada', 'como', 'con', 'contra', 'cual', 'cuales', 'cuando',
  'cuanto', 'de', 'del', 'desde', 'donde', 'dos', 'e', 'el', 'ella', 'ellas', 'ello',
  'ellos', 'en', 'entre', 'era', 'eran', 'es', 'esa', 'esas', 'ese', 'eso', 'esos',
  'esta', 'estan', 'estas', 'este', 'esto', 'estos', 'estoy', 'ha', 'hace', 'hacer',
  'hasta', 'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me', 'mi', 'mis',
  'mucho', 'muy', 'ni', 'no', 'nos', 'nosotros', 'o', 'otra', 'otras', 'otro', 'otros',
  'para', 'pero', 'poco', 'por', 'porque', 'pues', 'que', 'se', 'segun', 'ser', 'si',
  'sin', 'sobre', 'solo', 'son', 'su', 'sus', 'tambien', 'tan', 'tanto', 'te', 'tengo',
  'ti', 'tiene', 'tienen', 'todo', 'todos', 'tu', 'tus', 'un', 'una', 'uno', 'unos',
  'usted', 'ustedes', 'va', 'van', 'vos', 'y', 'ya', 'yo',
  // Muletillas típicas de una pregunta de clase: no distinguen un tema de otro.
  'profe', 'profesor', 'profesora', 'hola', 'buenas', 'gracias', 'consulta', 'pregunta',
  'duda', 'favor', 'podria', 'podrias', 'puede', 'puedes', 'quisiera', 'queria',
  'explicar', 'explique', 'explicas', 'entiendo', 'entendi',
]);

/**
 * Sufijos que se recortan para unificar familias de palabras
 * ("integrales" → "integral", "derivadas" → "deriv").
 * Ordenados de más largo a más corto: gana el primero que aplique.
 */
const SUFFIXES = [
  'amientos', 'imientos', 'amiento', 'imiento', 'aciones', 'iciones', 'adores',
  'aderos', 'ancias', 'encias', 'ismos', 'ables', 'ibles', 'istas', 'osos', 'osas',
  'acion', 'icion', 'antes', 'entes', 'ando', 'iendo', 'ador',
  'ancia', 'encia', 'ismo', 'able', 'ible', 'ista', 'oso', 'osa', 'mente',
  'aron', 'eron', 'ados', 'idos', 'adas', 'idas', 'ado', 'ido', 'ada', 'ida',
  'ar', 'er', 'ir', 'es', 's',
];

/**
 * Abreviaturas y modismos de chat que los alumnos escriben todo el tiempo.
 * Sin esto, "el tp es grupal?" y "¿el trabajo práctico es grupal?" quedan como
 * dos temas distintos aunque sean exactamente la misma consulta.
 */
const ALIASES = new Map<string, string>([
  ['tp', 'trabajo practico'],
  ['tps', 'trabajo practico'],
  ['tpo', 'trabajo practico'],
  ['ej', 'ejercicio'],
  ['ejs', 'ejercicio'],
  ['ejer', 'ejercicio'],
  ['exam', 'examen'],
  ['parcialito', 'parcial'],
  ['recu', 'recuperatorio'],
  ['recup', 'recuperatorio'],
  ['finde', 'fin semana'],
  ['biblio', 'bibliografia'],
  ['teorica', 'teoria'],
  ['q', 'que'],
  ['k', 'que'],
  ['xq', 'porque'],
  ['pq', 'porque'],
  ['xk', 'porque'],
  ['x', 'por'],
  ['d', 'de'],
  ['tmb', 'tambien'],
  ['tb', 'tambien'],
  ['tbn', 'tambien'],
  ['xfa', 'por favor'],
  ['porfa', 'por favor'],
  ['porfis', 'por favor'],
  ['plis', 'por favor'],
]);

/** Longitud mínima que debe conservar una raíz para no destruir la palabra. */
const MIN_STEM_LENGTH = 4;

/** Quita tildes y diacríticos: "función" → "funcion". */
export function stripAccents(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Recorta el sufijo más largo aplicable siempre que quede una raíz utilizable.
 * Es un stemmer deliberadamente conservador: preferimos no cortar antes que
 * fusionar dos palabras que en realidad son temas distintos.
 */
export function stem(word: string): string {
  if (word.length <= MIN_STEM_LENGTH) return word;
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= MIN_STEM_LENGTH && word.endsWith(suffix)) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/** Texto plano comparable: minúsculas, sin acentos, sin signos, espacios colapsados. */
export function normalizeText(input: string): string {
  return stripAccents(input.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokens significativos de una pregunta: sin stopwords, sin números sueltos
 * y con las palabras reducidas a su raíz.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  for (const raw of normalizeText(input).split(' ')) {
    if (!raw) continue;
    // Las abreviaturas se expanden antes de filtrar: muchas ("q", "x") tienen
    // una sola letra y se perderían por longitud.
    const expanded = ALIASES.get(raw)?.split(' ') ?? [raw];
    for (const word of expanded) {
      if (word.length < 2) continue;
      if (STOPWORDS.has(word)) continue;
      if (/^\d+$/.test(word)) continue;
      tokens.push(stem(word));
    }
  }
  return tokens;
}

/**
 * Trigramas de caracteres sobre el texto normalizado. Sirven de red de seguridad
 * frente a errores de tipeo y palabras que el stemmer no logra unificar.
 */
export function trigrams(input: string): Set<string> {
  const text = ` ${normalizeText(input).replace(/\s+/g, ' ')} `;
  const result = new Set<string>();
  for (let i = 0; i + 3 <= text.length; i += 1) {
    result.add(text.slice(i, i + 3));
  }
  return result;
}
