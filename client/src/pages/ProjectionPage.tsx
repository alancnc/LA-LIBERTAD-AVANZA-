import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api, type BoardResponse } from '../api.js';
import { useLive } from '../useLive.js';

/** Cuántos temas entran en pantalla sin que la letra quede ilegible de lejos. */
const VISIBLE_TOPICS = 5;

/**
 * Pantalla para proyectar en el aula.
 *
 * Muestra en grande el código para entrar y el ranking en vivo, sin ningún
 * control: se abre en el proyector y se deja. Usa el tablero público, así que
 * no expone nada que un alumno no pueda ver desde su propio celular.
 */
export function ProjectionPage() {
  const { code = '' } = useParams();
  const fetcher = useCallback(() => api.getBoard(code), [code]);
  const { data, error } = useLive<BoardResponse>(code, fetcher);

  const visibles = (data?.clusters ?? [])
    .filter((cluster) => cluster.status !== 'answered' && cluster.status !== 'discarded')
    .slice(0, VISIBLE_TOPICS);

  return (
    <div className="projection">
      <img src="/logo.png" alt="Escuela de Dirigentes" className="projection__logo" />
      <h1 className="projection__title">{data?.room.title ?? 'Preguntas en vivo'}</h1>

      <div className="projection__code">{code}</div>
      <p className="projection__url">
        Entrá desde tu celular a <strong>{window.location.host}</strong> y poné este código
      </p>

      {error && <p className="projection__url">{error}</p>}

      <div className="projection__list">
        {visibles.length === 0 ? (
          <p className="projection__url" style={{ textAlign: 'center' }}>
            Todavía no hay preguntas.
          </p>
        ) : (
          visibles.map((cluster) => (
            <div
              key={cluster.id}
              className={`projection__item${
                cluster.status === 'answering' ? ' projection__item--answering' : ''
              }`}
            >
              <div className="projection__score">{cluster.score}</div>
              <div className="projection__question">{cluster.label}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
