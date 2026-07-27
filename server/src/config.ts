/**
 * Nombres bajo los que puede llegar la cadena de conexión, en orden de
 * preferencia.
 *
 * No hay un estándar: según el proveedor y el flujo con el que se cree la base,
 * la integración de Vercel inyecta `DATABASE_URL` o `POSTGRES_URL`. Aceptar
 * ambos evita el error más típico del despliegue: la base creada y conectada,
 * pero la app arrancando sin verla.
 *
 * Las variantes "unpooled" quedan deliberadamente afuera: en serverless cada
 * invocación abre su propia conexión y una base chica se queda sin cupo.
 */
const CONNECTION_VARIABLES = ['DATABASE_URL', 'POSTGRES_URL'] as const;

/** Devuelve la primera cadena de conexión no vacía, o null si no hay ninguna. */
export function resolveDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  for (const name of CONNECTION_VARIABLES) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

/** Nombres aceptados, para poder nombrarlos en los mensajes de error. */
export const CONNECTION_VARIABLE_NAMES = CONNECTION_VARIABLES.join(' o ');
