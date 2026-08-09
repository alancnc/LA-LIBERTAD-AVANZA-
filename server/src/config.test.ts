import { describe, expect, it } from 'vitest';
import { resolveDatabaseUrl } from './config.js';

const PG = 'postgresql://u:p@host/db';

describe('resolveDatabaseUrl', () => {
  it('devuelve null cuando no hay ninguna variable', () => {
    expect(resolveDatabaseUrl({})).toBeNull();
  });

  it('toma DATABASE_URL', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: PG })).toBe(PG);
  });

  it('acepta POSTGRES_URL, que es como la nombran algunas integraciones', () => {
    expect(resolveDatabaseUrl({ POSTGRES_URL: PG })).toBe(PG);
  });

  it('prefiere DATABASE_URL si están las dos', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: PG, POSTGRES_URL: 'postgres://otra/x' })).toBe(PG);
  });

  it('ignora una variable vacía o con espacios', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: '   ', POSTGRES_URL: PG })).toBe(PG);
  });

  describe('cuando la integración usó otro prefijo', () => {
    it('encuentra la conexión igual', () => {
      // Al conectar la base, Vercel deja elegir el prefijo de las variables.
      expect(resolveDatabaseUrl({ STORAGE_URL: PG })).toBe(PG);
      expect(resolveDatabaseUrl({ NEON_URL: PG })).toBe(PG);
    });

    it('descarta la conexión directa y se queda con la del pooler', () => {
      const pooled = 'postgresql://u:p@ep-x-pooler.aws.neon.tech/db';
      const directa = 'postgresql://u:p@ep-x.aws.neon.tech/db';
      expect(
        resolveDatabaseUrl({ STORAGE_URL_UNPOOLED: directa, STORAGE_URL: pooled }),
      ).toBe(pooled);
      expect(
        resolveDatabaseUrl({ POSTGRES_URL_NON_POOLING: directa, PRISMA_URL: pooled }),
      ).toBe(pooled);
    });

    it('elige la del pooler aunque venga en otra variable', () => {
      const pooled = 'postgresql://u:p@ep-x-pooler.aws.neon.tech/db';
      expect(resolveDatabaseUrl({ A_URL: 'postgres://u:p@directo/db', Z_URL: pooled })).toBe(pooled);
    });

    it('reconoce también el pooler de Supabase, que usa otro formato de host', () => {
      // Neon lo marca en el subdominio y Supabase con un host propio: buscar
      // sólo "-pooler" dejaba pasar la conexión directa de Supabase, que desde
      // Vercel ni siquiera resuelve porque es sólo IPv6.
      const pooled = 'postgresql://postgres.abc:p@aws-0-sa-east-1.pooler.supabase.com:6543/postgres';
      const directa = 'postgresql://postgres:p@db.abc.supabase.co:5432/postgres';
      expect(resolveDatabaseUrl({ A_URL: directa, Z_URL: pooled })).toBe(pooled);
    });

    it('no confunde una URL que no es de Postgres', () => {
      expect(resolveDatabaseUrl({ SITE_URL: 'https://ejemplo.com', API_URL: 'redis://x' })).toBeNull();
    });

    it('los nombres habituales siguen teniendo prioridad', () => {
      expect(resolveDatabaseUrl({ STORAGE_URL: 'postgres://otra/x', DATABASE_URL: PG })).toBe(PG);
    });
  });
});
