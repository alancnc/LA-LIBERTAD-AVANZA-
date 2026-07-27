import { describe, expect, it } from 'vitest';
import { resolveDatabaseUrl } from './config.js';

describe('resolveDatabaseUrl', () => {
  it('devuelve null cuando no hay ninguna variable', () => {
    expect(resolveDatabaseUrl({})).toBeNull();
  });

  it('toma DATABASE_URL', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgres://a' })).toBe('postgres://a');
  });

  it('acepta POSTGRES_URL, que es como la nombran algunas integraciones', () => {
    expect(resolveDatabaseUrl({ POSTGRES_URL: 'postgres://b' })).toBe('postgres://b');
  });

  it('prefiere DATABASE_URL si están las dos', () => {
    expect(
      resolveDatabaseUrl({ DATABASE_URL: 'postgres://a', POSTGRES_URL: 'postgres://b' }),
    ).toBe('postgres://a');
  });

  it('ignora una variable vacía o con espacios', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: '   ', POSTGRES_URL: 'postgres://b' })).toBe(
      'postgres://b',
    );
  });
});
