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

Esa contraseña abre el panel de cualquier clase desde cualquier dispositivo y es
también la que habilita a crear clases. Cada clase tiene además una clave propia,
que se genera al crearla y sirve para darle acceso a un ayudante sin entregarle
el área completa.

Desde el panel, el botón **Proyectar** abre `/p/CÓDIGO`: una pantalla pensada
para el proyector, con el código en grande y el ranking en vivo, sin controles.

**El docente también pregunta**

Además de responder, el docente puede tirarle una pregunta a la clase y que
contesten todos. Va en la misma sala y con el mismo código:

1. Escribe la pregunta en *Preguntarle a la clase* y la lanza. Puede ser de
   **respuesta abierta** (cada uno escribe) o de **opción múltiple**: se cargan
   entre 2 y 6 opciones y los alumnos sólo eligen una, de un toque. El tope de
   seis no es capricho: el reparto se proyecta en el aula y con más barras deja
   de leerse de lejos.
2. A los alumnos les aparece arriba de todo, en violeta, con el campo para
   contestar. Las respuestas van firmadas, igual que las preguntas.
3. Cada uno ve **cuántos** contestaron desde el principio, pero **qué**
   contestaron recién cuando manda la suya: si viera las respuestas ajenas
   antes, la consigna mediría quién copió primero en lugar de qué piensa la
   clase. En opción múltiple vale lo mismo para el reparto de votos, y por eso
   la pantalla de proyección muestra las opciones pero no el recuento en vivo.
   Al cerrarla, todo queda a la vista de todos.
4. Volver a responder corrige la respuesta anterior: una persona, una respuesta.

**Pueden convivir varias preguntas abiertas.** Lanzar una nueva no cierra las
anteriores: el alumno entra y se encuentra con todas las que lanzó el docente,
y responde las que quiera, como un cuestionario. Cerrar una es una decisión del
docente, no un efecto secundario de lanzar la siguiente.

En el panel, cada pregunta aparece en **Preguntas anteriores** con su estado
(abierta o cerrada), la fecha, cuántos contestaron, qué opción ganó y el detalle
de quién eligió qué. Desde ahí se cierra, se reabre o se borra cada una.

La pantalla de proyección muestra la última pregunta abierta —con sus opciones
y el contador de respuestas— en lugar del ranking de dudas.

Las respuestas no se agrupan, a diferencia de las preguntas de los alumnos. Es
deliberado: las preguntas se agrupan porque son muchas versiones de lo mismo y
hay que reducirlas, mientras que de una consigna lo que interesa es justamente
la variedad de lo que contestó cada uno.

**Alumnos — la portada, sin contraseña**

0. Abren la web y **eligen su clase de la lista**. No hace falta código: la
   portada muestra todas las clases abiertas. El código sigue funcionando para
   quien lo tenga, y es la forma de entrar a una clase ya cerrada.
1. Ponen su nombre. **No hay preguntas anónimas**: el
   nombre es obligatorio y queda guardado en ese dispositivo, así se escribe una
   sola vez. Cada pregunta se muestra firmada.
2. Escriben la pregunta. Si alguien ya preguntó lo mismo, la app avisa que se
   sumó a ese tema y lo empuja arriba en el ranking.
3. Pueden votar las preguntas de otros que también quieren que se respondan.

Cada participante puede mandar hasta 4 preguntas por minuto; pasado ese tope la
app le pide que espere, para que una ráfaga no ensucie el tablero.

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

### Seguridad de la aplicación

- **Crear y borrar clases exige la contraseña del docente.** Sin eso, cualquiera
  con la URL del despliegue podía abrir salas sin límite. Borrar, además, no
  acepta la clave de la sala: esa se comparte con un ayudante para moderar, y
  moderar no incluye destruir la clase.
- **Freno a la prueba de contraseñas.** Cada intento fallido cuesta 400 ms y, a
  los 10 fallos, ese cliente queda cortado 5 minutos.
- **El listado de clases abiertas es público, a propósito.** La portada muestra
  las clases sin pedir credenciales, para que el alumno no tenga que tipear un
  código. La contrapartida es que cualquiera que llegue al dominio ve qué clases
  hay y puede preguntar en ellas: el código dejó de ser una barrera de entrada.
  Cerrar una clase la saca del listado. Si hiciera falta volver al modelo
  anterior, alcanza con quitar la ruta `GET /api/rooms` y el listado de la
  portada; nada más depende de eso.
- **Sin preguntas anónimas** y con un tope de 4 preguntas por minuto y
  participante, contado contra la base para que valga aunque la petición caiga
  en otra instancia serverless.
- **Cabeceras**: `Content-Security-Policy` (scripts sólo del propio origen,
  nada de iframes ajenos), `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy` y `Permissions-Policy`.
- **Sin CORS por defecto.** El cliente vive en el mismo origen que la API, así
  que no hace falta; abrirlo sólo permitiría que otro sitio use esta API desde
  el navegador de un tercero. Se habilita nombrando orígenes en
  `ALLOWED_ORIGINS`.
- **Secretos comparados en tiempo constante** (`timingSafeEqual`) y nunca
  devueltos por la API: hay un test que recorre las respuestas y falla si
  aparece una clave.

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

### Agrupar por lo que la pregunta quiere decir

Hay tres señales, de menor a mayor precisión, y alcanza con que una se convenza:

| Señal | Requiere | Une | No puede unir |
|---|---|---|---|
| Léxica | nada | *parcial* / *parsial* | *lluvia* / *llover* |
| Semántica | `EMBEDDINGS_API_KEY` | *lluvia* / *llover* | — |
| **Claude** | `ANTHROPIC_API_KEY` | *lluvia* / *llover* | — |

Claude además distingue lo que las otras dos no: *"¿cuándo es el parcial?"* y
*"¿qué entra en el parcial?"* comparten palabras y contexto, pero necesitan
respuestas distintas, así que van a temas separados.

La decisión se toma **antes** de abrir la transacción: sostener el lock de la
sala durante una llamada de red serializaría a toda la clase detrás de cada
pregunta. Al insertar se revalida que el tema elegido siga abierto.

Si el servicio no responde, la pregunta entra igual y se agrupa por palabras.
Una caída externa no puede dejar a nadie sin preguntar.

#### La credencial

- Se lee **sólo** de una variable de entorno del servidor.
- Se guarda en un campo privado de JavaScript (`#`), no en uno `private` de
  TypeScript: ese desaparece al compilar y `JSON.stringify` del objeto volcaría
  la credencial en cualquier log descuidado.
- Viaja únicamente en la cabecera de autenticación, nunca en el cuerpo.
- Los errores del proveedor se resumen al código HTTP: el cuerpo puede traer
  detalles de la cuenta.
- El cliente sólo recibe `smartGrouping: true|false`.

Hay tests que verifican cada uno de esos puntos, incluido que ninguna respuesta
de la API contenga rastro de la clave.

### Comparar significado con embeddings

Lo anterior compara **palabras**, y eso tiene un techo: "¿se viene la lluvia?" y
"¿está por llover?" son la misma pregunta y no comparten ninguna, así que la
similitud da 0.009 y quedan separadas. Ningún ajuste del umbral lo arregla.

Configurando `EMBEDDINGS_API_KEY` se suma una segunda señal: cada pregunta se
convierte en un vector donde la cercanía es cercanía de sentido, y esos casos sí
se agrupan. Las dos señales conviven y alcanza con que una se convenza, cada una
con su propio umbral:

| Señal | Une | No puede unir |
|---|---|---|
| Léxica | *parcial* / *parsial* / *el parcial* | *lluvia* / *llover* |
| Semántica | *lluvia* / *llover*, *parcial* / *examen* | — |

Es opcional y falla con elegancia: si el proveedor no responde, la pregunta
entra igual y se agrupa sólo por palabras. Sirve cualquier endpoint compatible
con la API de OpenAI (ver `.env.example`). El costo es despreciable: una
pregunta son unas 20 palabras.

`/api/config` y `/api/health` informan en `semantic` si está activa.

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
- **Proyectar** la sala: código en grande y ranking en vivo, para el proyector.
- **Preguntarle a la clase**: lanzar una consigna, ver las respuestas llegar,
  cerrarla, ocultar una respuesta o borrarla con todo lo que juntó.
- **Sorteo** del orden de exposición entre los profesores: se cargan los
  nombres y sale el orden completo. Es una herramienta interna del equipo, no
  toca el servidor y los nombres quedan sólo en ese navegador.
- **Renombrar una clase** desde el listado o desde su propio panel.
- **Eliminar una clase** que ya no se usa, con todo lo que juntó. Pide
  confirmación mostrando cuántas preguntas se pierden, y exige la contraseña
  del docente: la clave de una sala sirve para moderarla, no para borrarla.

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
  src/service.ts           reglas de negocio (salas, votos, ranking, consignas)
  src/app.ts               rutas HTTP, SSE y modo de tiempo real
  src/tools/calibrate.ts   medición del umbral
client/                    React + Vite + TypeScript
  src/pages/               inicio, vista de alumno, panel del docente, proyección
  src/components/          escudo, tarjeta del ranking y consigna del docente
  public/logo.png          escudo de la Escuela de Dirigentes (favicon y marca)
  src/useLive.ts           sincronización en vivo (SSE o sondeo, según el server)
  src/sorteo.ts            sorteo del orden de exposición (barajado sin sesgo)
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
  roles ni auditoría: conviene una contraseña larga.
- El freno a la fuerza bruta cuenta los fallos por IP **en la instancia que los
  atendió**. En serverless hay varias, así que ese contador no es una barrera
  absoluta; la espera de 400 ms por intento fallido, en cambio, se aplica
  siempre y es lo que baja el techo de miles de pruebas por minuto a unas pocas.
- El nombre del alumno es obligatorio, pero no está verificado: nadie comprueba
  que sea el suyo. Sirve para que las preguntas queden firmadas ante la clase,
  no como identidad.
- Con archivo JSON el estado vive en un solo proceso y no escala en horizontal;
  para eso está el repositorio Postgres.
- El sondeo de 4 segundos consume invocaciones en Vercel. Para una clase es
  irrelevante, pero conviene tenerlo en cuenta con muchas salas simultáneas.

## Tests

```bash
npm test         # 198 tests: agrupamiento, significado, calidad, API, acceso y sorteo
npm run typecheck
```

Definiendo `TEST_DATABASE_URL` la misma batería corre además contra Postgres y
se suman los tests de concurrencia y de seguridad de la base:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/preguntas_test npm test
```
