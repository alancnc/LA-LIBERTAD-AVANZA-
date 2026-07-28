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
import { createApp } from '../server/src/app.js';
import {
  CONNECTION_VARIABLE_NAMES,
  resolveDatabaseUrl,
} from '../server/src/config.js';

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

export default app;
