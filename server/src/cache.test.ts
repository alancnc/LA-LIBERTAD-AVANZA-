import { describe, expect, it } from 'vitest';
import { TtlCache } from './cache.js';

/** Contador de llamadas, para ver cuántas veces se fue a buscar el dato. */
function contador<T>(valor: T) {
  let llamadas = 0;
  return {
    get llamadas() {
      return llamadas;
    },
    cargar: async () => {
      llamadas += 1;
      return valor;
    },
  };
}

describe('TtlCache', () => {
  it('lee una sola vez mientras la entrada siga viva', async () => {
    const cache = new TtlCache<string>(1_000);
    const fuente = contador('tablero');

    expect(await cache.get('sala', fuente.cargar)).toBe('tablero');
    expect(await cache.get('sala', fuente.cargar)).toBe('tablero');
    expect(await cache.get('sala', fuente.cargar)).toBe('tablero');
    expect(fuente.llamadas).toBe(1);
  });

  it('junta las peticiones simultáneas en una sola lectura', async () => {
    // Es la mitad del ahorro: cuando llegan cincuenta sondeos a la vez y no hay
    // nada cacheado, todos tienen que esperar la misma consulta. Sólo se logra
    // guardando la promesa antes de que termine, no el valor después.
    const cache = new TtlCache<string>(1_000);
    let llamadas = 0;
    const lento = async () => {
      llamadas += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'tablero';
    };

    const todas = await Promise.all(
      Array.from({ length: 50 }, () => cache.get('sala', lento)),
    );
    expect(todas.every((valor) => valor === 'tablero')).toBe(true);
    expect(llamadas).toBe(1);
  });

  it('vuelve a leer cuando venció', async () => {
    const cache = new TtlCache<string>(20);
    const fuente = contador('tablero');

    await cache.get('sala', fuente.cargar);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await cache.get('sala', fuente.cargar);
    expect(fuente.llamadas).toBe(2);
  });

  it('no mezcla salas distintas', async () => {
    const cache = new TtlCache<string>(1_000);
    expect(await cache.get('a', async () => 'sala A')).toBe('sala A');
    expect(await cache.get('b', async () => 'sala B')).toBe('sala B');
    expect(await cache.get('a', async () => 'otra cosa')).toBe('sala A');
  });

  it('al invalidar vuelve a leer en el acto', async () => {
    const cache = new TtlCache<string>(10_000);
    const fuente = contador('tablero');

    await cache.get('sala', fuente.cargar);
    cache.invalidate('sala');
    await cache.get('sala', fuente.cargar);
    expect(fuente.llamadas).toBe(2);
  });

  it('no cachea un fallo', async () => {
    // Un error de red no puede quedar pegado durante todo el TTL: la petición
    // siguiente tiene que poder volver a intentarlo.
    const cache = new TtlCache<string>(10_000);
    let intentos = 0;
    const inestable = async () => {
      intentos += 1;
      if (intentos === 1) throw new Error('la base no respondió');
      return 'tablero';
    };

    await expect(cache.get('sala', inestable)).rejects.toThrow('la base no respondió');
    expect(await cache.get('sala', inestable)).toBe('tablero');
    expect(intentos).toBe(2);
  });

  it('con ttl 0 no cachea nada', async () => {
    const cache = new TtlCache<string>(0);
    const fuente = contador('tablero');
    await cache.get('sala', fuente.cargar);
    await cache.get('sala', fuente.cargar);
    expect(fuente.llamadas).toBe(2);
  });

  it('no crece sin límite', async () => {
    const cache = new TtlCache<string>(10_000, 10);
    for (let i = 0; i < 100; i += 1) {
      await cache.get(`sala-${i}`, async () => `valor ${i}`);
    }
    // La última tiene que seguir estando; el tope se respeta descartando viejas.
    const fuente = contador('recien leida');
    await cache.get('sala-99', fuente.cargar);
    expect(fuente.llamadas).toBe(0);
  });
});
