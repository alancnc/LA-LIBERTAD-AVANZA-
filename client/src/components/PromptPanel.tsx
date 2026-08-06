import { useState, type FormEvent } from 'react';
import { api, type AdminPrompt } from '../api.js';
import { Tally } from './Tally.js';

const MAX_PROMPT_LENGTH = 300;
const MAX_OPTIONS = 6;
const MAX_OPTION_LENGTH = 80;

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
  /** Vacío = consigna de respuesta abierta. Con contenido = opción múltiple. */
  const [opciones, setOpciones] = useState<string[]>([]);

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

  const opcionesCargadas = opciones.filter((opcion) => opcion.trim());
  const faltanOpciones = opciones.length > 0 && opcionesCargadas.length < 2;

  async function lanzar(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || faltanOpciones) return;
    setLanzando(true);
    await correr(async () => {
      await api.createPrompt(code, text, adminKey, opcionesCargadas);
      setText('');
      setOpciones([]);
    });
    setLanzando(false);
  }

  function cambiarOpcion(indice: number, valor: string) {
    setOpciones((actuales) => actuales.map((item, i) => (i === indice ? valor : item)));
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

          {opciones.length === 0 ? (
            <div className="row">
              <span className="muted">Los alumnos escriben la respuesta.</span>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => setOpciones(['', ''])}
              >
                Usar opciones para elegir
              </button>
            </div>
          ) : (
            <div className="opciones">
              <div className="row">
                <span className="label" style={{ margin: 0 }}>
                  Opciones
                </span>
                <div className="spacer" />
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => setOpciones([])}
                >
                  Volver a respuesta abierta
                </button>
              </div>
              {opciones.map((opcion, indice) => (
                <div className="row" key={indice}>
                  <span className="opciones__letra">{String.fromCharCode(65 + indice)}</span>
                  <input
                    value={opcion}
                    onChange={(event) => cambiarOpcion(indice, event.target.value)}
                    placeholder={`Opción ${indice + 1}`}
                    maxLength={MAX_OPTION_LENGTH}
                    autoComplete="off"
                    aria-label={`Opción ${indice + 1}`}
                    style={{ flex: 1 }}
                  />
                  {opciones.length > 2 && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--small btn--danger"
                      onClick={() =>
                        setOpciones((actuales) => actuales.filter((_, i) => i !== indice))
                      }
                      aria-label={`Quitar la opción ${indice + 1}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {opciones.length < MAX_OPTIONS && (
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => setOpciones((actuales) => [...actuales, ''])}
                >
                  Agregar opción
                </button>
              )}
            </div>
          )}

          <div className="row">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={lanzando || text.trim().length < 3 || faltanOpciones}
            >
              {lanzando ? 'Lanzando...' : 'Lanzar pregunta'}
            </button>
            {faltanOpciones && <span className="muted">Cargá al menos dos opciones.</span>}
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

          {actual.tally.length > 0 && <Tally tally={actual.tally} />}

          {actual.answers.length === 0 ? (
            <p className="prompt__meta" style={{ marginTop: '0.85rem' }}>
              Todavía no contestó nadie.
            </p>
          ) : actual.options.length > 0 ? (
            // Con opciones lo que importa es el reparto; el detalle de quién
            // eligió qué se despliega sólo si hace falta mirarlo.
            <details className="prompt__detalle">
              <summary>Ver quién eligió cada opción</summary>
              <ul className="prompt__answers">
                {actual.answers.map((answer) => (
                  <li className="prompt__answer" key={answer.id}>
                    <span className="prompt__answer-author">{answer.author}</span>
                    <span>{answer.text}</span>
                  </li>
                ))}
              </ul>
            </details>
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
