/**
 * Nombres bajo los que puede llegar la cadena de conexión, en orden de
 * preferencia.
 *
 * No hay un estándar: según el proveedor y el flujo con el que se cree la base,
 * la integración de Vercel inyecta `DATABASE_URL` o `POSTGRES_URL`.
 */
const CONNECTION_VARIABLES = ['DATABASE_URL', 'POSTGRES_URL'] as const;

/** Toda cadena de conexión a Postgres empieza así. */
const POSTGRES_URL = /^postgres(ql)?:\/\//i;

/**
 * Variantes de conexión directa, que se descartan a propósito: en serverless
 * cada invocación abre la suya y una base chica se queda sin cupo enseguida.
 */
const UNPOOLED = /UNPOOLED|NON_POOLING|NO_POOLING|DIRECT/i;

type Env = Record<string, string | undefined>;

/** Entre varias candidatas, gana la que pase por un pooler. */
function preferPooled(candidates: Array<[string, string]>): string | undefined {
  const pooled = candidates.find(([, value]) => value.includes('-pooler'));
  return (pooled ?? candidates[0])?.[1];
}

/**
 * Devuelve la cadena de conexión a Postgres, o null si no hay ninguna.
 *
 * Primero busca los nombres habituales. Si no aparecen, recorre el entorno
 * buscando cualquier variable terminada en `_URL` cuyo valor sea una cadena de
 * conexión a Postgres: las integraciones dejan elegir el prefijo al conectar la
 * base (`STORAGE_URL`, `NEON_URL`, ...), y un prefijo distinto del esperado no
 * debería dejar la aplicación sin base de datos.
 */
export function resolveDatabaseUrl(env: Env = process.env): string | null {
  for (const name of CONNECTION_VARIABLES) {
    const value = env[name]?.trim();
    if (value) return value;
  }

  const candidates = Object.entries(env)
    .filter(
      (entry): entry is [string, string] =>
        entry[0].endsWith('_URL') &&
        !UNPOOLED.test(entry[0]) &&
        typeof entry[1] === 'string' &&
        POSTGRES_URL.test(entry[1].trim()),
    )
    .map(([name, value]): [string, string] => [name, value.trim()])
    // Orden estable: el entorno no garantiza el orden de sus claves.
    .sort((a, b) => a[0].localeCompare(b[0]));

  return preferPooled(candidates) ?? null;
}

/** Nombres aceptados, para poder nombrarlos en los mensajes de error. */
export const CONNECTION_VARIABLE_NAMES = CONNECTION_VARIABLES.join(' o ');
