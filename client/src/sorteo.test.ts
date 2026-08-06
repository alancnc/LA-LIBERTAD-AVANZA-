import { describe, expect, it } from 'vitest';
import { barajar, enteroAleatorio, limpiarNombres } from './sorteo.js';

describe('enteroAleatorio', () => {
  it('se queda dentro del rango pedido', () => {
    for (let i = 0; i < 500; i += 1) {
      const valor = enteroAleatorio(7);
      expect(valor).toBeGreaterThanOrEqual(0);
      expect(valor).toBeLessThan(7);
    }
  });

  it('con rango 1 siempre devuelve 0', () => {
    expect(enteroAleatorio(1)).toBe(0);
  });

  it('rechaza un rango vacío en vez de devolver cualquier cosa', () => {
    expect(() => enteroAleatorio(0)).toThrow();
    expect(() => enteroAleatorio(-3)).toThrow();
  });

  it('reparte parejo entre todos los valores', () => {
    // Con 12.000 tiradas sobre 6 valores, lo esperado son 2.000 por valor.
    //
    // Esto no mide el sesgo del módulo que corrige el descarte: ese sesgo es de
    // 4 casos en 2^32 y no se ve ni con millones de tiradas. Lo que sí atrapa
    // es un error grosero — un índice que nunca sale, uno que sale el doble,
    // un rango mal calculado.
    const cuentas = new Array<number>(6).fill(0);
    for (let i = 0; i < 12_000; i += 1) cuentas[enteroAleatorio(6)]! += 1;
    for (const cuenta of cuentas) {
      expect(cuenta).toBeGreaterThan(1_500);
      expect(cuenta).toBeLessThan(2_500);
    }
  });
});

describe('barajar', () => {
  it('devuelve los mismos elementos, sin perder ni repetir', () => {
    const original = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elena'];
    const mezclado = barajar(original);
    expect(mezclado).toHaveLength(original.length);
    expect([...mezclado].sort()).toEqual([...original].sort());
  });

  it('no modifica la lista original', () => {
    const original = ['Ana', 'Bruno', 'Carla'];
    barajar(original);
    expect(original).toEqual(['Ana', 'Bruno', 'Carla']);
  });

  it('cualquiera puede salir primero', () => {
    // Si alguien nunca sale primero en 600 sorteos de tres nombres, el sorteo
    // está roto: sería el caso de un `Math.random()` mal usado o un off-by-one.
    const nombres = ['Ana', 'Bruno', 'Carla'];
    const primeros = new Set<string>();
    for (let i = 0; i < 600; i += 1) primeros.add(barajar(nombres)[0]!);
    expect(primeros.size).toBe(3);
  });

  it('con un solo nombre no hay nada que mezclar', () => {
    expect(barajar(['Ana'])).toEqual(['Ana']);
    expect(barajar([])).toEqual([]);
  });
});

describe('limpiarNombres', () => {
  it('recorta espacios y descarta vacíos', () => {
    expect(limpiarNombres(['  Ana  ', '', '   ', 'Bruno'])).toEqual(['Ana', 'Bruno']);
  });

  it('junta los espacios de más', () => {
    expect(limpiarNombres(['Ana   María   Pérez'])).toEqual(['Ana María Pérez']);
  });

  it('no repite a la misma persona aunque cambie las mayúsculas', () => {
    expect(limpiarNombres(['Ana', 'ana', 'ANA', 'Bruno'])).toEqual(['Ana', 'Bruno']);
  });

  it('respeta el orden en que se cargaron', () => {
    expect(limpiarNombres(['Carla', 'Ana', 'Bruno'])).toEqual(['Carla', 'Ana', 'Bruno']);
  });
});
