import { useEffect, useState, type FormEvent } from 'react';
import { api, type LivePrompt } from '../api.js';
import { Tally } from './Tally.js';

const MAX_ANSWER_LENGTH = 500;

interface Props {
  code: string;
  prompt: LivePrompt;
  /** Nombre ya confirmado del alumno: las respuestas también van firmadas. */
  author: string;
  onAnswered: () => void;
}

/**
 * La pregunta que el docente le tiró a la clase, con el campo para responderla.
 *
 * Va arriba de todo y en violeta: cuando el docente lanza algo, es lo que la
 * clase tiene que estar mirando, por encima del ranking de dudas.
 */
export function PromptCard({ code, prompt, author, onAnswered }: Props) {
  const [text, setText] = useState(prompt.myAnswer ?? '');
  const [editando, setEditando] = useState(prompt.myAnswer === null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si el docente lanza otra pregunta, el formulario tiene que empezar limpio
  // en lugar de arrastrar lo que se había escrito para la anterior.
  useEffect(() => {
    setText(prompt.myAnswer ?? '');
    setEditando(prompt.myAnswer === null);
    setError(null);
  }, [prompt.id, prompt.myAnswer]);

  async function mandar(respuesta: string) {
    setEnviando(true);
    setError(null);
    try {
      await api.answerPrompt(code, prompt.id, respuesta, author);
      setEditando(false);
      onAnswered();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar la respuesta');
    } finally {
      setEnviando(false);
    }
  }

  async function enviar(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      setError('Escribí tu respuesta');
      return;
    }
    await mandar(text);
  }

  const esOpcionMultiple = prompt.options.length > 0;

  const respondidas =
    prompt.answerCount === 0
      ? 'Todavía no respondió nadie'
      : prompt.answerCount === 1
        ? 'Va 1 respuesta'
        : `Van ${prompt.answerCount} respuestas`;

  return (
    <section className="prompt">
      <p className="prompt__eyebrow">
        {prompt.closed ? 'El docente preguntó' : 'El docente te está preguntando'}
      </p>
      <h2 className="prompt__text">{prompt.text}</h2>
      {/* Cuántos van se ve siempre, aun sin haber respondido: es lo que empuja
          a contestar. Lo que dijeron, en cambio, recién después. */}
      <p className="prompt__meta" style={{ marginBottom: '0.9rem' }}>
        {prompt.closed ? `Cerrada · ${respondidas.toLowerCase()}` : respondidas}
      </p>

      {prompt.closed ? null : editando && esOpcionMultiple ? (
        // Elegir una opción es un solo toque: no hace falta un botón de enviar.
        <div className="stack">
          <div className="opciones-elegir">
            {prompt.options.map((opcion, indice) => (
              <button
                key={opcion}
                type="button"
                className={`opcion${prompt.myAnswer === opcion ? ' opcion--mia' : ''}`}
                onClick={() => void mandar(opcion)}
                disabled={enviando}
              >
                <span className="opcion__letra">{String.fromCharCode(65 + indice)}</span>
                <span>{opcion}</span>
              </button>
            ))}
          </div>
          {error && <div className="error">{error}</div>}
          {prompt.myAnswer !== null && (
            <div className="row">
              <button type="button" className="btn btn--ghost" onClick={() => setEditando(false)}>
                Cancelar
              </button>
            </div>
          )}
        </div>
      ) : editando ? (
        <form onSubmit={enviar} className="stack">
          <div>
            <label className="label" htmlFor="respuesta">
              Tu respuesta <span className="label__req">obligatorio</span>
            </label>
            <textarea
              id="respuesta"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Contestá con tus palabras"
              maxLength={MAX_ANSWER_LENGTH}
              required
              autoFocus
            />
            <p className="prompt__meta">
              {text.length}/{MAX_ANSWER_LENGTH} · Vas a ver lo que contestaron los demás cuando
              mandes la tuya.
            </p>

          </div>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={enviando || !text.trim()}
            >
              {enviando ? 'Enviando...' : prompt.myAnswer ? 'Guardar cambio' : 'Responder'}
            </button>
            {prompt.myAnswer !== null && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setText(prompt.myAnswer ?? '');
                  setEditando(false);
                }}
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="prompt__mine">
          <p className="prompt__meta">{esOpcionMultiple ? 'Elegiste:' : 'Respondiste:'}</p>
          <p className="prompt__mine-text">{prompt.myAnswer}</p>
          <button type="button" className="btn btn--small" onClick={() => setEditando(true)}>
            {esOpcionMultiple ? 'Cambiar mi elección' : 'Corregir mi respuesta'}
          </button>
        </div>
      )}

      {prompt.tally.length > 0 && <Tally tally={prompt.tally} mine={prompt.myAnswer} />}

      {!esOpcionMultiple && prompt.answers.length > 0 && (
        <ul className="prompt__answers">
          {prompt.answers.map((answer) => (
            <li className="prompt__answer" key={answer.id}>
              <span className="prompt__answer-author">
                {answer.author}
                {answer.mine && ' · vos'}
              </span>
              <span>{answer.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
