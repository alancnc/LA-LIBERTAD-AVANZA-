import { useCallback, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type AskResponse, type BoardResponse } from '../api.js';
import { useLive } from '../useLive.js';
import { ClusterCard } from '../components/ClusterCard.js';
import { Brand } from '../components/Brand.js';

const NAME_STORAGE_KEY = 'preguntas-en-vivo:nombre';
/** Igual que `MIN_AUTHOR_LENGTH` en el servidor: acá sólo evita el viaje de ida. */
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 40;
const MAX_TEXT_LENGTH = 400;

/** Nombre con el que firma quien está usando este navegador. */
function loadName(): string {
  return localStorage.getItem(NAME_STORAGE_KEY)?.trim() ?? '';
}

export function RoomPage() {
  const { code = '' } = useParams();
  const [text, setText] = useState('');
  const [author, setAuthor] = useState(loadName);
  // El nombre queda fijado recién cuando se confirma: hasta entonces la sala
  // muestra el paso de identificación en lugar del formulario de preguntas.
  const [identificado, setIdentificado] = useState(() => loadName().length >= MIN_NAME_LENGTH);
  const [sending, setSending] = useState(false);
  const [ultima, setUltima] = useState<AskResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetcher = useCallback(() => api.getBoard(code), [code]);
  const { data, error, loading, connected, refresh } = useLive<BoardResponse>(code, fetcher);

  const closed = data?.room.closed ?? false;
  const nombreLimpio = author.trim().replace(/\s+/g, ' ');
  const nombreValido = nombreLimpio.length >= MIN_NAME_LENGTH;

  function confirmarNombre(event: FormEvent) {
    event.preventDefault();
    if (!nombreValido) {
      setFormError('Escribí tu nombre para entrar a la clase');
      return;
    }
    localStorage.setItem(NAME_STORAGE_KEY, nombreLimpio);
    setAuthor(nombreLimpio);
    setFormError(null);
    setIdentificado(true);
  }

  function cambiarNombre() {
    setIdentificado(false);
    setUltima(null);
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // Se revalida acá porque el nombre puede haberse vaciado después de confirmarlo.
    if (!nombreValido) {
      setIdentificado(false);
      setFormError('Ingresá tu nombre para poder preguntar');
      return;
    }
    if (text.trim().length < 3) {
      setFormError('Escribí un poco más para que se entienda la pregunta');
      return;
    }
    setSending(true);
    setFormError(null);
    setUltima(null);
    try {
      const result = await api.ask(code, text, nombreLimpio);
      localStorage.setItem(NAME_STORAGE_KEY, nombreLimpio);
      setText('');
      setUltima(result);
      // Mostramos el grupo donde cayó para que se vea qué pasó con la pregunta.
      setExpanded((current) => new Set(current).add(result.clusterId));
      refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'No se pudo enviar la pregunta');
    } finally {
      setSending(false);
    }
  }

  async function handleVote(questionId: string) {
    try {
      await api.vote(code, questionId);
      refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'No se pudo votar');
    }
  }

  function toggle(clusterId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(clusterId)) next.delete(clusterId);
      else next.add(clusterId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="page">
        <Brand subtitle="Preguntas en vivo" />
        <p className="muted" style={{ marginTop: '2rem' }}>
          Cargando la clase...
        </p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="page">
        <Brand subtitle="Preguntas en vivo" />
        <div className="error" style={{ marginTop: '1.5rem' }}>
          {error}
        </div>
        <p style={{ marginTop: '1rem' }}>
          <Link to="/">Volver al inicio</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <Brand subtitle={`Sala ${code}`} />
          <h1 style={{ marginTop: '0.85rem' }}>{data?.room.title}</h1>
          <p className="header__sub">
            <span className={`live-dot${connected ? '' : ' live-dot--off'}`} />
            {closed ? 'Sala cerrada' : 'En vivo'}
          </p>
        </div>
      </header>

      {closed ? (
        <div className="notice" style={{ marginBottom: '1.25rem' }}>
          El docente cerró la sala. Ya no se aceptan preguntas ni votos.
        </div>
      ) : !identificado ? (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Antes de preguntar, ¿quién sos?</h2>
          <p className="muted">
            Las preguntas de esta clase van firmadas: no se aceptan preguntas anónimas. Tu nombre
            queda guardado en este dispositivo, así lo escribís una sola vez.
          </p>
          <form onSubmit={confirmarNombre} className="stack">
            <div>
              <label className="label" htmlFor="nombre">
                Nombre y apellido <span className="label__req">obligatorio</span>
              </label>
              <input
                id="nombre"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="Ej: Sofía Pérez"
                maxLength={MAX_NAME_LENGTH}
                autoComplete="name"
                required
                autoFocus
              />
            </div>
            {formError && <div className="error">{formError}</div>}
            <div className="row">
              <button type="submit" className="btn btn--primary" disabled={!nombreValido}>
                Entrar a preguntar
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="row" style={{ marginBottom: '0.9rem' }}>
            <span className="muted">
              Preguntás como <strong className="question__author">{nombreLimpio}</strong>
            </span>
            <button type="button" className="btn btn--ghost btn--small" onClick={cambiarNombre}>
              No soy yo
            </button>
          </div>
          <form onSubmit={handleSubmit} className="stack">
            <div>
              <label className="label" htmlFor="pregunta">
                Tu pregunta <span className="label__req">obligatorio</span>
              </label>
              <textarea
                id="pregunta"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="¿Qué no te quedó claro?"
                maxLength={MAX_TEXT_LENGTH}
                required
              />
              <p className="muted" style={{ margin: '0.3rem 0 0' }}>
                {text.length}/{MAX_TEXT_LENGTH} · Si alguien ya preguntó lo mismo, tu pregunta se
                suma a ese tema y lo empuja arriba en el ranking.
              </p>
            </div>
            {formError && <div className="error">{formError}</div>}
            {ultima && (
              <div className="notice notice--success">
                {ultima.isNewCluster
                  ? 'Listo, tu pregunta abrió un tema nuevo.'
                  : `Ya había preguntas parecidas: la sumamos al tema "${ultima.clusterLabel}", así suma peso en el ranking.`}
              </div>
            )}
            <div className="row">
              <button
                type="submit"
                className="btn btn--primary"
                disabled={sending || text.trim().length < 3}
              >
                {sending ? 'Enviando...' : 'Enviar pregunta'}
              </button>
            </div>
          </form>
        </div>
      )}

      <h2 style={{ fontSize: '1.1rem' }}>Lo que más se está preguntando</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Votá las preguntas que también querés que respondan: cuantos más votos, más arriba.
      </p>

      {data && data.clusters.length === 0 ? (
        <div className="empty">Todavía no hay preguntas. Animate a ser el primero.</div>
      ) : (
        data?.clusters.map((cluster, index) => (
          <ClusterCard
            key={cluster.id}
            cluster={cluster}
            position={index + 1}
            expanded={expanded.has(cluster.id)}
            onToggle={() => toggle(cluster.id)}
            onVote={handleVote}
            votingDisabled={closed}
          />
        ))
      )}
    </div>
  );
}
