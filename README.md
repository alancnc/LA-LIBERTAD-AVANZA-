# Preguntas en vivo

Aplicación para clases: los alumnos mandan sus preguntas, el sistema **agrupa
automáticamente las que son la misma consulta escrita distinta** y arma un
**ranking de temas** para que el docente responda en vivo, empezando por lo que
más gente está pidiendo.

El problema que resuelve: en una clase de 40 personas llegan 40 preguntas, pero
son 6 temas. Esta app hace esa reducción sola.

```
9 preguntas sueltas                    ->   4 temas rankeados
─────────────────────────────────────       ──────────────────────────────────
"¿Cómo se resuelve una integral            #1  [3 personas]  Bibliografía
  por partes?"                             #2  [3 personas]  Fecha del parcial
"profe no entiendo integrales                    · ¿Cuándo es el parcial?
  por partes"                                    · qué día es el parcial??
"la integral por partes cómo se hace"            · cuando es el parsial profe
"¿Cuándo es el parcial?"                   #3  [3 personas]  Integral por partes
"qué día es el parcial??"                  #4  [2 personas]  Modalidad del TP
"cuando es el parsial profe"                     · ¿El TP se entrega en grupo...
...                                              · el tp es grupal o individual?
```

## Cómo se usa

**Docente**

1. Entra al inicio, pone el nombre de la clase y crea la sala.
2. Comparte el código de 6 caracteres (o el enlace) con los alumnos.
3. Ve el ranking actualizarse en vivo y responde de arriba hacia abajo, marcando
   cada tema como *respondiendo ahora* → *respondida*.

**Alumnos**

1. Entran con el código, escriben la pregunta (el nombre es opcional).
2. Si alguien ya preguntó lo mismo, la app avisa que se sumó a ese tema y lo
   empuja arriba en el ranking.
3. Pueden votar las preguntas de otros que también quieren que se respondan.

El puntaje de un tema es **cuánta gente lo quiere**: quienes lo preguntaron más
quienes votaron alguna de esas preguntas.

## Puesta en marcha

```bash
npm install
npm run dev          # cliente en :5173, API en :3001
```

Para producción, el servidor sirve también el frontend ya compilado:

```bash
npm run build
npm start            # todo en http://localhost:3001
```

Variables de entorno del servidor:

| Variable     | Por defecto        | Para qué                                  |
|--------------|--------------------|-------------------------------------------|
| `PORT`       | `3001`             | Puerto del servidor                       |
| `DATA_FILE`  | `data/db.json`     | Archivo donde se guarda todo              |
| `CLIENT_DIR` | `client/dist`      | Build del frontend a servir               |

## Cómo agrupa las preguntas

No usa ningún servicio externo ni API de terceros: todo el procesamiento es
local y funciona sin conexión.

1. **Normalización** — minúsculas, sin acentos ni signos; se descartan las
   stopwords y las muletillas de clase (*profe*, *consulta*, *una duda*), y se
   expanden las abreviaturas típicas (`tp` → *trabajo práctico*, `xq` → *porque*).
   Cada palabra se reduce a su raíz, así *integrales* e *integral* son lo mismo.
2. **Comparación** — 70% solapamiento de palabras ponderado por IDF (las
   palabras que usa media clase pesan menos que las específicas del tema) y 30%
   trigramas de caracteres sobre la frase completa. El match de palabras es
   difuso: *parsial* y *parcial* cuentan como la misma palabra.
3. **Asignación** — la pregunta nueva se compara con el promedio de cada grupo
   existente (enlace promedio, para evitar que los grupos se encadenen). Si
   ninguno supera el umbral, abre un tema nuevo.

Un tema ya respondido no absorbe preguntas nuevas a propósito: si alguien vuelve
a preguntar lo mismo, el docente necesita verlo otra vez.

### El umbral

`0.42` por defecto, ajustable desde el panel. La elección está medida contra un
conjunto de preguntas etiquetadas a mano (`server/src/text/fixtures.ts`):

```bash
npm run calibrate -w server
```

| umbral | temas | precisión | cobertura |
|--------|-------|-----------|-----------|
| 0.30   | 8     | 75%       | 100%      |
| 0.34   | 9     | 85%       | 94%       |
| 0.42   | 11    | **100%**  | 78%       |
| 0.50   | 14    | 100%      | 44%       |

Se prioriza la precisión sobre la cobertura: un tema partido en dos se ve en el
ranking y se une con un clic en *Fusionar*, pero una pregunta metida en el grupo
equivocado queda escondida bajo un título que no le corresponde y el docente
puede no notarlo nunca. `npm test -w server` incluye un test de regresión que
falla si un cambio empeora estas métricas.

## Herramientas del docente

- Marcar un tema como *respondiendo ahora* / *respondida* / *descartada*.
- **Fusionar** dos temas que el sistema separó de más.
- **Separar** una pregunta que quedó mal agrupada.
- **Renombrar** un tema y dejar una **nota** de cómo se respondió.
- **Ocultar** una pregunta inapropiada (no se borra, queda para revisar).
- Ajustar la sensibilidad del agrupamiento y cerrar la sala al terminar.

## Estructura

```
server/                    API en Express + TypeScript
  src/text/                motor de normalización, similitud y agrupamiento
    normalize.ts           stopwords, abreviaturas, stemming en español
    similarity.ts          IDF, match difuso de palabras, trigramas
    cluster.ts             asignación a grupos y umbral
    fixtures.ts            preguntas etiquetadas para medir calidad
  src/service.ts           reglas de negocio (salas, votos, ranking)
  src/app.ts               rutas HTTP y SSE
  src/store.ts             persistencia en JSON
  src/tools/calibrate.ts   medición del umbral
client/                    React + Vite + TypeScript
  src/pages/               inicio, vista de alumno, panel del docente
  src/components/          tarjeta de tema del ranking
  src/useLive.ts           sincronización en vivo (SSE + refresco de respaldo)
```

## Detalles de implementación

- **En vivo por SSE**, con un refresco cada 15s como red de seguridad por si un
  proxy corta el stream.
- **Sin cuentas de usuario.** Cada navegador genera un id anónimo en
  `localStorage` para saber qué preguntó y votó. El acceso al panel es una clave
  por sala, generada al crearla y guardada en el navegador del docente; se puede
  abrir en otro dispositivo con `/admin/CODIGO?key=LA_CLAVE`.
- **Persistencia en un archivo JSON**, escrito con archivo temporal + rename
  para que nunca quede a medio escribir. Alcanza de sobra para el caso de uso y
  evita dependencias nativas.

### Límites conocidos

- La clave de sala es el único control de acceso al panel: quien la tenga, entra.
  No hay roles ni auditoría.
- El estado vive en un solo proceso (los eventos SSE se emiten en memoria), así
  que no escala horizontalmente sin mover el estado a una base compartida.
- Sin límite de frecuencia por participante: en un aula abierta a internet
  convendría agregar rate limiting antes de exponerlo.

## Tests

```bash
npm test         # 49 tests: motor de agrupamiento, calidad y API
npm run typecheck
```
