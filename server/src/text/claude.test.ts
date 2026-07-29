import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeTopicMatcher, createTopicMatcher, type TopicOption } from './claude.js';

const TEMAS: TopicOption[] = [
  { id: 'lluvia', label: '¿se viene la lluvia?', examples: ['¿se viene la lluvia?'] },
  { id: 'parcial', label: '¿cuándo es el parcial?', examples: ['¿cuándo es el parcial?'] },
];

/** Simula la respuesta del modelo sin salir a la red. */
function responderCon(texto: string, ok = true, status = 200) {
  const fetchFalso = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve({ content: [{ type: 'text', text: texto }] }),
    text: () => Promise.resolve(texto),
  });
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ClaudeTopicMatcher', () => {
  const matcher = new ClaudeTopicMatcher({ apiKey: 'sk-ant-prueba' });

  it('asigna el tema que eligió el modelo', async () => {
    responderCon('{"tema": 1}');
    expect(await matcher.match('¿está por llover?', TEMAS)).toBe('lluvia');
  });

  it('abre tema nuevo cuando el modelo responde null', async () => {
    responderCon('{"tema": null}');
    expect(await matcher.match('¿dónde se entrega el TP?', TEMAS)).toBeNull();
  });

  it('no llama al modelo si todavía no hay temas', async () => {
    const fetchFalso = responderCon('{"tema": 1}');
    expect(await matcher.match('primera pregunta', [])).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('tolera que la respuesta venga con texto alrededor del JSON', async () => {
    responderCon('Claro, la respuesta es {"tema": 2} porque habla del examen.');
    expect(await matcher.match('¿qué día rendimos?', TEMAS)).toBe('parcial');
  });

  describe('respuestas que no se pueden usar', () => {
    it('rechaza un número fuera de rango en vez de asignar cualquier tema', async () => {
      responderCon('{"tema": 99}');
      expect(await matcher.match('algo', TEMAS)).toBeNull();
    });

    it('rechaza un índice cero', async () => {
      responderCon('{"tema": 0}');
      expect(await matcher.match('algo', TEMAS)).toBeNull();
    });

    it('no rompe con una respuesta sin JSON', async () => {
      responderCon('No estoy seguro de a cuál pertenece.');
      expect(await matcher.match('algo', TEMAS)).toBeNull();
    });

    it('no rompe con un JSON mal formado', async () => {
      responderCon('{"tema": }');
      expect(await matcher.match('algo', TEMAS)).toBeNull();
    });
  });

  it('avisa cuando la API rechaza la petición', async () => {
    responderCon('unauthorized', false, 401);
    await expect(matcher.match('algo', TEMAS)).rejects.toThrow(/401/);
  });

  it('el error no incluye el cuerpo de la respuesta, que puede traer datos de la cuenta', async () => {
    responderCon('{"error":{"message":"credit balance for org-secreta"}}', false, 400);
    await expect(matcher.match('algo', TEMAS)).rejects.toThrow(/^Claude respondió 400$/);
  });
});

describe('la clave no se filtra', () => {
  it('viaja sólo en la cabecera de autenticación, nunca en el cuerpo', async () => {
    const fetchFalso = responderCon('{"tema": 1}');
    await new ClaudeTopicMatcher({ apiKey: 'sk-ant-secretisima' }).match('hola', TEMAS);

    const [, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-secretisima');
    expect(String(init.body)).not.toContain('sk-ant-secretisima');
  });

  it('no aparece al serializar el clasificador', () => {
    const matcher = new ClaudeTopicMatcher({ apiKey: 'sk-ant-secretisima' });
    // Un log descuidado del objeto no debe volcar la credencial.
    expect(JSON.stringify(matcher)).not.toContain('sk-ant-secretisima');
  });
});

describe('createTopicMatcher', () => {
  it('queda desactivado sin clave', () => {
    expect(createTopicMatcher({})).toBeNull();
    expect(createTopicMatcher({ ANTHROPIC_API_KEY: '   ' })).toBeNull();
  });

  it('se activa con una clave', () => {
    expect(createTopicMatcher({ ANTHROPIC_API_KEY: 'sk-ant-x' })).not.toBeNull();
  });
});
