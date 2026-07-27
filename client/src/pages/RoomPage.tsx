import { useCallback, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type BoardResponse } from '../api.js';
import { useLive } from '../useLive.js';
import { ClusterCard } from '../components/ClusterCard.js';

const NAME_STORAGE_KEY = 'preguntas-en-vivo:nombre';

export function RoomPage() {
  const { code = '' } = useParams();
  const [text, setText] = useState('');
  const [author, setAuthor] = useState(() => localStorage.getItem(NAME_STORAGE_KEY) ?? '');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetcher = useCallback(() => api.getBoard(code), [code]);
  const { data, error, loading, connected, refresh } = useLive<BoardResponse>(code, fetcher);

  const closed = data?.room.closed ?? false;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (text.trim().length < 3) {
      setFormError('Escribí un poco más para que se entienda la pregunta');
      return;
    }
    setSending(true);
    setFormError(null);
    setFeedback(null);
    try {
      const result = await api.ask(code, text, author);
      localStorage.setItem(NAME_STORAGE_KEY, author);
      setText('');
      setFeedback(
        result.isNewCluster
          ? 'Listo, tu pregunta abrió un tema nuevo.'
          : `Ya había preguntas parecidas: la sumamos al tema "${result.clusterLabel}", así suma peso en el ranking.`,
      );
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

  if (loading) return <div className="page"><p className="muted">Cargando sala...</p></div>;

  if (error && !data) {
    return (
      <div className="page">
        <div className="error">{error}</div>
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
          <h1>{data?.room.title}</h1>
          <p className="header__sub">
            <span className={`live-dot${connected ? '' : ' live-dot--off'}`} />
            Sala {code} {closed && '· cerrada'}
          </p>
        </div>
      </header>

      {closed ? (
        <div className="notice" style={{ marginBottom: '1.25rem' }}>
          El docente cerró la sala. Ya no se aceptan preguntas ni votos.
        </div>
      ) : (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <form onSubmit={handleSubmit} className="stack">
            <div>
              <label className="label" htmlFor="pregunta">
                Tu pregunta
              </label>
              <textarea
                id="pregunta"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="¿Qué no te quedó claro?"
                maxLength={400}
              />
              <p className="muted" style={{ margin: '0.3rem 0 0' }}>
                {text.length}/400 · Si alguien ya preguntó lo mismo, tu pregunta se suma a ese
                tema y lo empuja arriba en el ranking.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="nombre">
                Tu nombre (opcional)
              </label>
              <input
                id="nombre"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="Anónimo"
                maxLength={40}
              />
            </div>
            {formError && <div className="error">{formError}</div>}
            {feedback && <div className="notice notice--success">{feedback}</div>}
            <div className="row">
              <button type="submit" className="btn btn--primary" disabled={sending}>
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
