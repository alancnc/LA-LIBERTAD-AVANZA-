import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const port = Number(process.env.PORT ?? 3001);
const dataFile = process.env.DATA_FILE ?? path.join(repoRoot, 'data', 'db.json');
const clientDir = process.env.CLIENT_DIR ?? path.join(repoRoot, 'client', 'dist');

const { app, store } = createApp({ dataFile, clientDir });

const server = app.listen(port, () => {
  console.log(`Preguntas en vivo escuchando en http://localhost:${port}`);
  console.log(`Datos en ${dataFile}`);
});

/** Al apagar, se vuelca lo que quede pendiente para no perder preguntas. */
function shutdown(signal: string): void {
  console.log(`\n${signal} recibido, cerrando...`);
  server.close(() => {
    store.flushSync();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
