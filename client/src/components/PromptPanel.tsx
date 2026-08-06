import { useState, type FormEvent } from 'react';
import { api, type AdminPrompt } from '../api.js';

const MAX_PROMPT_LENGTH = 300;

interface Props {
  code: string;
  adminKey: string;
  prompts: AdminPrompt[];
  roomClosed: boolean;
  onChange: () => void;
}

/**
 * Panel del docente para tirarle una pregunta a la clase y ver qué contestan.
 *
 * Sólo se muestran en detalle la consigna vigente y las anteriores plegadas: en
 * medio de una clase lo que importa es lo que está pasando ahora.
 */
export function PromptPanel({ code, adminKey, prompts, roomClosed, onChange }: Props) {
  const [text, setText] = useState('');
  const [lanzando, setLanzando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());

  const actual = prompts[0] ?? null;
  const anteriores = prompts.slice(1);

  async function correr(accion: () => Promise<unknown>) {
    setError(null);
    try {
      await accion();
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la acción');
    }
  }

  async function lanzar(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setLanzando(true);
    await correr(async () => {
      await api.createPrompt(code, text, adminKey);
      setText('');
    });
    setLanzando(false);
  }

  function alternar(promptId: string) {
    setAbiertas((current) => {
      const next = new Set(current);
      if (next.has(promptId)) next.delete(promptId);
      else next.add(promptId);
      return next;
    });
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Preguntarle a la clase</h2>
      <p className="muted">
        Lanzá una pregunta y los alumnos la responden desde el celular. Cada uno ve las respuestas
        de los demás recién cuando manda la suya.
      </p>

      {!roomClosed && (
        <form onSubmit={lanzar} className="stack">
          <div>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Ej: ¿Qué entienden por república?"
              maxLength={MAX_PROMPT_LENGTH}
              rows={2}
            />
            <p className="muted" style={{ margin: '0.3rem 0 0' }}>
              {text.length}/{MAX_PROMPT_LENGTH}
              {actual && !actual.closed && ' · Al lanzar esta, se cierra la anterior.'}
            </p>
          </div>
          <div className="row">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={lanzando || text.trim().length < 3}
            >
              {lanzando ? 'Lanzando...' : 'Lanzar pregunta'}
            </button>
          </div>
        </form>
      )}

      {error && <div className="error" style={{ marginTop: '0.85rem' }}>{error}</div>}

      {actual && (
        <div className="prompt prompt--admin">
          <p className="prompt__eyebrow">
            {actual.closed ? 'Última pregunta · cerrada' : 'En vivo ahora'}
          </p>
          <h3 className="prompt__text">{actual.text}</h3>
          <p className="prompt__meta">
            {actual.answerCount} {actual.answerCount === 1 ? 'respuesta' : 'respuestas'}
          </p>

          <div className="row">
            <button
              type="button"
              className="btn btn--small"
              onClick={() =>
                void correr(() => api.setPromptClosed(code, actual.id, !actual.closed, adminKey))
              }
            >
              {actual.closed ? 'Reabrir' : 'Cerrar respuestas'}
            </button>
            <button
              type="button"
              className="btn btn--small btn--danger"
              onClick={() => {
                if (window.confirm('¿Borrar esta pregunta y todas sus respuestas?')) {
                  void correr(() => api.deletePrompt(code, actual.id, adminKey));
                }
              }}
            >
              Borrar
            </button>
          </div>

          {actual.answers.length === 0 ? (
            <p className="prompt__meta" style={{ marginTop: '0.85rem' }}>
              Todavía no contestó nadie.
            </p>
          ) : (
            <ul className="prompt__answers">
              {actual.answers.map((answer) => (
                <li className="prompt__answer" key={answer.id}>
                  <span className="prompt__answer-author">{answer.author}</span>
                  <span>{answer.text}</span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small btn--danger"
                    onClick={() => void correr(() => api.hideAnswer(code, answer.id, adminKey))}
                  >
                    Ocultar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {anteriores.length > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Preguntas anteriores</h3>
          {anteriores.map((prompt) => (
            <div key={prompt.id} className="prompt__previous">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => alternar(prompt.id)}
              >
                {abiertas.has(prompt.id) ? '▾' : '▸'} {prompt.text} ({prompt.answerCount})
              </button>
              {abiertas.has(prompt.id) && (
                <ul className="prompt__answers">
                  {prompt.answers.map((answer) => (
                    <li className="prompt__answer" key={answer.id}>
                      <span className="prompt__answer-author">{answer.author}</span>
                      <span>{answer.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
