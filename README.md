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

Hay dos áreas separadas.

**Docente — `/admin`, con contraseña**

1. Entra con la contraseña de `ADMIN_PASSWORD` y ve todas sus clases.
2. Crea una clase y comparte el código de 6 caracteres con los alumnos.
3. Ve el ranking actualizarse en vivo y responde de arriba hacia abajo, marcando
   cada tema como *respondiendo ahora* → *respondida*.

Esa contraseña abre el panel de cualquier clase desde cualquier dispositivo.
Cada clase tiene además una clave propia, que se genera al crearla y sirve para
darle acceso a un ayudante sin entregarle el área completa.

**Alumnos — la portada, sin contraseña**

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

Para producción como proceso único, el servidor sirve también el frontend:

```bash
npm run build
npm start            # todo en http://localhost:3001
```

Sin `DATABASE_URL` los datos van a un archivo JSON, que alcanza de sobra para un
solo proceso. Ver `.env.example` para el resto de las variables.

## Despliegue en Vercel

La app corre en Vercel, pero el modelo serverless impone dos cosas que conviene
entender antes:

- **Hace falta Postgres.** El disco de una función no persiste entre
  invocaciones: sin base de datos las preguntas se perderían en medio de la
  clase. Las tablas se crean solas en el primer arranque.
- **No hay SSE.** Sin un proceso persistente que sostenga la conexión, el
  cliente pasa a sondear cada 4 segundos. Lo decide en tiempo de ejecución
  consultando `/api/config`, así que el mismo código funciona en los dos modos
  sin recompilar.

Pasos:

1. Importar el repositorio en Vercel. `vercel.json` ya define la instalación,
   el build del cliente, el ruteo de `/api/*` a la función y el fallback del SPA.
2. Crear la base y cargar `DATABASE_URL` en *Settings → Environment Variables*.
   También se acepta `POSTGRES_URL`. Y si al conectar la base se eligió otro
   prefijo para las variables (`STORAGE_URL`, `NEON_URL`...), la app igual
   encuentra la conexión: busca cualquier variable terminada en `_URL` cuyo
   valor sea una cadena de Postgres y prefiere la que pase por el pooler.
3. Desplegar.

### Elegir proveedor de Postgres

Sirve cualquiera que dé una cadena de conexión. Los datos son texto plano y muy
poco volumen, así que el plan gratuito de cualquiera sobra.

| Proveedor | Nota |
|---|---|
| **Neon** (vía Vercel Marketplace) | La opción con menos fricción: Vercel inyecta `DATABASE_URL` solo. |
| Neon directo | Usar la cadena que incluye `-pooler` en el host. |
| Supabase | Usar el **Transaction pooler** (puerto 6543). La conexión directa a `db.*.supabase.co` es sólo IPv6 y desde Vercel no resuelve. |
| Vercel Postgres | Igual que Neon; es lo mismo por debajo. |

En serverless siempre conviene la cadena **con pooler**: cada invocación abre su
propia conexión y una base chica se queda sin cupo enseguida.

### Notas sobre el build

Vercel resuelve un árbol de dependencias más chico que una instalación local
completa, así que el build del cliente está armado para no depender de eso:

- **El cliente se instala dentro del `buildCommand`.** Vercel resuelve la
  instalación en función de lo que necesita la función serverless: instala la
  raíz y el workspace `server`, y se saltea `client` entero. Quedan 201
  paquetes en lugar de 214 y falta React. Reproducible en local con
  `npm install --include-workspace-root --workspace=server --include=dev`, que
  da exactamente los mismos números y el mismo error de rollup.
- El build empieza entonces con `npm install --workspace=client`, y **no usa
  `cd`**: el directorio desde el que Vercel ejecuta el build no siempre es la
  raíz del repositorio. Con `--workspace` npm sube solo hasta encontrar la raíz
  de los workspaces, así que el comando funciona igual desde cualquiera de los
  dos. `"framework": null` evita además que la detección automática de Vercel
  cambie el directorio de trabajo.
- **El cliente se emite en `dist/`, en la raíz del repositorio**, no en
  `client/dist`. Vercel busca la salida en `dist` respecto de la raíz del
  proyecto y no respeta una ruta con subcarpeta, así que se emite directamente
  donde la va a encontrar.
- El cliente **no usa `@vitejs/plugin-react`**. Ese plugin aporta React Fast
  Refresh y transforma el JSX con Babel, arrastrando unos 40 paquetes. Vite ya
  compila JSX con esbuild, así que se configura el runtime automático en
  `vite.config.ts` y listo. Lo único que se pierde: al editar un componente en
  desarrollo, el módulo se recarga entero en vez de preservar su estado.
- El build es sólo `vite build`. La verificación de tipos y los tests corren en
  CI (`.github/workflows/ci.yml`), que es donde corresponde: empaquetar y
  verificar tipos son cosas distintas, y un error de tipos no debería tirar
  abajo el despliegue de algo que funciona.

### Seguridad de la base

El esquema activa Row Level Security en las cuatro tablas y no define ninguna
política, de modo que sólo la dueña de las tablas (la app) las alcanza.

Esto importa especialmente en Supabase, que publica el esquema `public` por su
API REST con una clave que es pública por diseño: sin RLS, cualquiera podría
leer la tabla de salas y quedarse con la clave de administrador de todas ellas.
El esquema además revoca los permisos de los roles `anon` y `authenticated` si
existen. En proveedores sin esos roles el paso se omite solo.

El cifrado de la conexión se deriva del `sslmode` de la URL: `verify-full` o
`verify-ca` validan el certificado del servidor (con `DATABASE_CA_CERT` si el
proveedor requiere su raíz); cualquier otro valor cifra sin validar la cadena,
que es lo que aceptan Supabase y Neon sin configuración extra.

Para desplegar en Render, Railway, Fly.io o un VPS no hace falta nada de esto:
con `npm run build && npm start` queda un proceso único con SSE y, si no se
configura Postgres, persistencia en archivo.

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
  src/repository/          persistencia intercambiable
    types.ts               contrato por operación
    memory.ts              archivo JSON, para proceso único
    postgres.ts            Postgres, para serverless
  src/service.ts           reglas de negocio (salas, votos, ranking)
  src/app.ts               rutas HTTP, SSE y modo de tiempo real
  src/tools/calibrate.ts   medición del umbral
client/                    React + Vite + TypeScript
  src/pages/               inicio, vista de alumno, panel del docente
  src/components/          tarjeta de tema del ranking
  src/useLive.ts           sincronización en vivo (SSE o sondeo, según el server)
dist/                      build del cliente (generado)
api/index.ts               función serverless de Vercel
```

## Detalles de implementación

- **Tiempo real adaptativo.** Con un proceso persistente se usa SSE y los
  cambios llegan al instante; en serverless el cliente sondea. El servidor
  informa cuál corresponde en `/api/config`.
- **Sin cuentas de usuario.** Cada navegador genera un id anónimo en
  `localStorage` para saber qué preguntó y votó. El acceso al panel es una clave
  por sala, generada al crearla y guardada en el navegador del docente; se puede
  abrir en otro dispositivo con `/admin/CODIGO?key=LA_CLAVE`.
- **Dos persistencias tras la misma interfaz.** Archivo JSON (escrito con
  temporal + rename, para que nunca quede a medio escribir) o Postgres. La
  batería de tests corre entera contra ambas, así el despliegue serverless se
  comporta igual que el local.
- **Preguntas simultáneas serializadas por sala.** En Postgres, insertar una
  pregunta toma el lock de la fila de su sala dentro de la transacción. Sin eso,
  varios alumnos preguntando lo mismo a la vez crean grupos duplicados; está
  cubierto por un test que efectivamente falla si se saca el lock.

### Límites conocidos

- El control de acceso son dos secretos compartidos: la contraseña del área del
  docente y la clave de cada clase. Quien los tenga, entra. No hay cuentas,
  roles ni auditoría, y tampoco límite de intentos: conviene una contraseña
  larga.
- Con archivo JSON el estado vive en un solo proceso y no escala en horizontal;
  para eso está el repositorio Postgres.
- Sin límite de frecuencia por participante: en un aula abierta a internet
  convendría agregar rate limiting antes de exponerlo.
- El sondeo de 4 segundos consume invocaciones en Vercel. Para una clase es
  irrelevante, pero conviene tenerlo en cuenta con muchas salas simultáneas.

## Tests

```bash
npm test         # 84 tests: motor de agrupamiento, calidad, API y acceso
npm run typecheck
```

Definiendo `TEST_DATABASE_URL` la misma batería corre además contra Postgres y
se suman los tests de concurrencia y de seguridad de la base (114 en total):

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/preguntas_test npm test
```
