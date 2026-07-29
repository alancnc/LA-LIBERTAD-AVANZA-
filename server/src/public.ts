/**
 * Superficie pública del paquete `server`.
 *
 * La función serverless importa desde acá, y no con una ruta relativa a los
 * fuentes: `../server/src/app.js` no existe en disco (el archivo es `.ts`) y
 * sólo funciona si quien empaqueta resuelve esa reescritura. Importando el
 * workspace por su nombre, la resolución es la de Node contra `node_modules`,
 * que es la que cualquier empaquetador respeta.
 */
export { createApp, type AppOptions, type RealtimeMode } from './app.js';
export { resolveDatabaseUrl, CONNECTION_VARIABLE_NAMES } from './config.js';
