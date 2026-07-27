import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, type RealtimeMode } from './app.js';
import { resolveDatabaseUrl } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = resolveDatabaseUrl();
const dataFile = process.env.DATA_FILE ?? path.join(repoRoot, 'data', 'db.json');
const clientDir = process.env.CLIENT_DIR ?? path.join(repoRoot, 'client', 'dist');
const realtime = (process.env.REALTIME as RealtimeMode | undefined) ?? undefined;

const { app, repository } = createApp({ databaseUrl, dataFile, clientDir, realtime });

const server = app.listen(port, () => {
  console.log(`Preguntas en vivo escuchando en http://localhost:${port}`);
  console.log(databaseUrl ? 'Datos en Postgres' : `Datos en ${dataFile}`);
});

/** Al apagar, se cierra el almacenamiento para no perder preguntas. */
function shutdown(signal: string): void {
  console.log(`\n${signal} recibido, cerrando...`);
  server.close(() => {
    repository
      .close()
      .catch((error) => console.error('Error al cerrar el almacenamiento:', error))
      .finally(() => process.exit(0));
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
