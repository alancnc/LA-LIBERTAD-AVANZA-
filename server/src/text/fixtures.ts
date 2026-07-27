/**
 * Preguntas de ejemplo etiquetadas a mano por tema, con el estilo real con el
 * que escriben los alumnos: abreviaturas, typos, saludos y reformulaciones.
 *
 * Sirven para medir la calidad del agrupamiento y para justificar el umbral
 * por defecto: son la referencia contra la que se calibra el motor.
 */
export interface LabeledQuestion {
  text: string;
  /** Tema real al que pertenece la pregunta. */
  topic: string;
}

export const LABELED_QUESTIONS: LabeledQuestion[] = [
  // --- Integración por partes
  { text: '¿Cómo se resuelve una integral por partes?', topic: 'integral-partes' },
  { text: 'profe no entiendo integrales por partes, cómo se resuelven', topic: 'integral-partes' },
  { text: 'la integral por partes cómo se hace', topic: 'integral-partes' },
  { text: 'no me sale resolver integrales por partes', topic: 'integral-partes' },

  // --- Fecha del parcial
  { text: '¿Cuándo es el parcial?', topic: 'fecha-parcial' },
  { text: 'qué día es el parcial??', topic: 'fecha-parcial' },
  { text: 'cuando es el parsial profe', topic: 'fecha-parcial' },
  { text: 'la fecha del parcial ya está confirmada?', topic: 'fecha-parcial' },

  // --- Modalidad del trabajo práctico
  { text: '¿El trabajo práctico se entrega en grupo o individual?', topic: 'tp-modalidad' },
  { text: 'el tp es grupal o individual?', topic: 'tp-modalidad' },
  { text: 'hola, el trabajo practico lo hacemos en grupo?', topic: 'tp-modalidad' },

  // --- Dónde se entrega el TP
  { text: '¿Dónde subo el trabajo práctico?', topic: 'tp-entrega' },
  { text: 'donde se sube el tp, al campus?', topic: 'tp-entrega' },

  // --- Bibliografía
  { text: '¿Dónde está la bibliografía de la materia?', topic: 'bibliografia' },
  { text: 'de donde saco la bibliografia?', topic: 'bibliografia' },

  // --- Derivada de función compuesta
  { text: '¿Cómo se deriva una función compuesta?', topic: 'regla-cadena' },
  { text: 'no entiendo la derivada de funciones compuestas', topic: 'regla-cadena' },

  // --- Temas que aparecen una sola vez
  { text: '¿Se puede usar calculadora en el examen?', topic: 'calculadora' },
  { text: '¿Va a haber recuperatorio?', topic: 'recuperatorio' },
  { text: '¿Las clases quedan grabadas?', topic: 'grabaciones' },
];
