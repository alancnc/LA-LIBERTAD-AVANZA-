/**
 * Punto de entrada de la función serverless en Vercel.
 *
 * Vercel enruta todo `/api/*` acá (ver `vercel.json`) y sirve el build del
 * cliente como estáticos desde su CDN, así que esta función sólo atiende la API.
 * Una app de Express ya es un handler `(req, res)`, así que se exporta directo.
 *
 * La app se construye una vez por instancia: mientras la instancia siga
 * caliente, las peticiones siguientes reutilizan el pool de conexiones.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/app.js';
import { CONNECTION_VARIABLE_NAMES, resolveDatabaseUrl } from '../server/src/config.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

function buildApp(): Handler {
  const databaseUrl = resolveDatabaseUrl();

  if (!databaseUrl) {
    // Sin base de datos, cada invocación arrancaría vacía y las preguntas se
    // perderían en medio de la clase. Conviene que se vea en los logs de entrada.
    console.error(
      `Falta la cadena de conexión (${CONNECTION_VARIABLE_NAMES}). En Vercel el ` +
        'sistema de archivos no persiste entre invocaciones: hay que configurar ' +
        'Postgres (Neon, Vercel Postgres o Supabase).',
    );
  }

  const { app } = createApp({
    databaseUrl,
    // Los estáticos los sirve la CDN de Vercel, no la función.
    clientDir: null,
    // Sin proceso persistente no hay SSE posible: el cliente sondea.
    realtime: 'poll',
    adminPassword: process.env.ADMIN_PASSWORD ?? null,
    // Sin base de datos la API responde 503 con una explicación, en lugar de
    // aceptar preguntas que se van a perder en la invocación siguiente.
    requirePersistence: true,
  });

  return app as unknown as Handler;
}

/**
 * Si construir la aplicación falla (una cadena de conexión mal formada, una
 * variable ausente, un error al cargar un módulo), la función se cae al
 * importarse y Vercel devuelve un 500 sin cuerpo: desde afuera es indistinguible
 * de cualquier otro error y no hay nada que leer. Este envoltorio convierte esa
 * caída en una respuesta que dice qué pasó.
 */
function buildFallback(cause: unknown): Handler {
  console.error('La aplicación no pudo construirse:', cause);
  const message = cause instanceof Error ? cause.message : String(cause);

  return (_req, res) => {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: `La aplicación no pudo iniciarse: ${message}`,
        // El detalle completo queda en los logs de Vercel, no en la respuesta.
        pista: 'Revisá los Runtime Logs del despliegue en Vercel.',
      }),
    );
  };
}

let handler: Handler;
try {
  handler = buildApp();
} catch (cause) {
  handler = buildFallback(cause);
}

export default handler;
