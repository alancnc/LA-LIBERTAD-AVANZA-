import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  clearAdminKey,
  loadAdminKey,
  saveAdminKey,
  type AdminResponse,
  type ClusterStatus,
  type RankedCluster,
} from '../api.js';
import { useLive } from '../useLive.js';
import { ClusterCard } from '../components/ClusterCard.js';

type Filter = 'activas' | 'todas' | 'respondidas';

export function AdminPage() {
  const { code = '' } = useParams();
  const [searchParams] = useSearchParams();

  // La clave puede venir por URL (útil para abrir el panel en otro dispositivo)
  // o estar ya guardada de cuando se creó la sala.
  const [adminKey, setAdminKey] = useState<string | null>(() => {
    const fromUrl = searchParams.get('key');
    if (fromUrl) {
      saveAdminKey(code, fromUrl);
      return fromUrl;
    }
    return loadAdminKey(code);
  });

  const [keyInput, setKeyInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('activas');
  const [copied, setCopied] = useState(false);

  const fetcher = useCallback(() => {
    if (!adminKey) return Promise.reject(new Error('Falta la clave de administrador'));
    return api.getAdminBoard(code, adminKey);
  }, [code, adminKey]);

  const { data, error, loading, connected, refresh } = useLive<AdminResponse>(code, fetcher, [
    adminKey,
  ]);

  const clusters = useMemo(() => {
    if (!data) return [];
    if (filter === 'todas') return data.clusters;
    if (filter === 'respondidas') {
      return data.clusters.filter((cluster) => cluster.status === 'answered');
    }
    return data.clusters.filter(
      (cluster) => cluster.status === 'pending' || cluster.status === 'answering',
    );
  }, [data, filter]);

  /** Ejecuta una acción de admin y refresca el tablero. */
  async function run(action: (key: string) => Promise<unknown>) {
    if (!adminKey) return;
    setActionError(null);
    try {
      await action(adminKey);
      refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo completar la acción');
    }
  }

  function handleKeySubmit(event: FormEvent) {
    event.preventDefault();
    const clean = keyInput.trim();
    if (!clean) return;
    saveAdminKey(code, clean);
    setAdminKey(clean);
  }

  function handleMerge(cluster: RankedCluster) {
    if (mergeSource === cluster.id) {
      setMergeSource(null);
      return;
    }
    if (!mergeSource) {
      setMergeSource(cluster.id);
      return;
    }
    const source = mergeSource;
    setMergeSource(null);
    void run((key) => api.mergeClusters(code, source, cluster.id, key));
  }

  async function shareStudentLink() {
    const url = `${window.location.origin}/r/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Si el navegador bloquea el portapapeles, el código sigue visible en pantalla.
      setActionError(`Copiá el enlace a mano: ${url}`);
    }
  }

  if (!adminKey) {
    return (
      <div className="page">
        <header className="header">
          <div>
            <h1>Panel del docente</h1>
            <p className="header__sub">Sala {code}</p>
          </div>
        </header>
        <div className="card">
          <p className="muted">
            Este navegador no tiene la clave de la sala. Pegala para entrar al panel.
          </p>
          <form onSubmit={handleKeySubmit} className="stack">
            <input
              value={keyInput}
              onChange={(event) => setKeyInput(event.target.value)}
              placeholder="Clave de administrador"
              autoComplete="off"
            />
            <div className="row">
              <button type="submit" className="btn btn--primary">
                Entrar
              </button>
              <Link to="/" className="btn btn--ghost">
                Volver
              </Link>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (loading) return <div className="page"><p className="muted">Cargando panel...</p></div>;

  if (error && !data) {
    return (
      <div className="page">
        <div className="error">{error}</div>
        <div className="row" style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              clearAdminKey(code);
              setAdminKey(null);
            }}
          >
            Usar otra clave
          </button>
          <Link to="/" className="btn btn--ghost">
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  const stats = data?.stats;
  const closed = data?.room.closed ?? false;

  return (
    <div className="page page--wide">
      <header className="header">
        <div>
          <h1>{data?.room.title}</h1>
          <p className="header__sub">
            <span className={`live-dot${connected ? '' : ' live-dot--off'}`} />
            Panel del docente {closed && '· sala cerrada'}
          </p>
        </div>
        <div>
          <div className="label">Código para la clase</div>
          <div className="code-display">{code}</div>
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn btn--small" onClick={shareStudentLink}>
              {copied ? 'Enlace copiado' : 'Copiar enlace'}
            </button>
            <Link to={`/r/${code}`} className="btn btn--small btn--ghost">
              Ver como alumno
            </Link>
          </div>
        </div>
      </header>

      {stats && (
        <div className="stats">
          <div className="stat">
            <div className="stat__value">{stats.pendingCount}</div>
            <div className="stat__label">temas pendientes</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats.answeredCount}</div>
            <div className="stat__label">respondidos</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats.questionCount}</div>
            <div className="stat__label">preguntas</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats.clusterCount}</div>
            <div className="stat__label">temas distintos</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats.participants}</div>
            <div className="stat__label">participantes</div>
          </div>
        </div>
      )}

      {actionError && <div className="error" style={{ marginBottom: '1rem' }}>{actionError}</div>}

      {mergeSource && (
        <div className="notice" style={{ marginBottom: '1rem' }}>
          Fusión en curso: elegí el tema que absorbe al marcado. El grupo origen desaparece y sus
          preguntas pasan al destino.
        </div>
      )}

      <div className="row" style={{ marginBottom: '1rem' }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          {(['activas', 'respondidas', 'todas'] as Filter[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`tab${filter === option ? ' tab--active' : ''}`}
              onClick={() => setFilter(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn--small"
          onClick={() => void run((key) => api.updateRoom(code, { closed: !closed }, key))}
        >
          {closed ? 'Reabrir sala' : 'Cerrar sala'}
        </button>
      </div>

      {clusters.length === 0 ? (
        <div className="empty">
          {data?.clusters.length === 0
            ? `Todavía nadie preguntó. Compartí el código ${code} con la clase.`
            : 'No hay temas en este filtro.'}
        </div>
      ) : (
        clusters.map((cluster, index) => (
          <ClusterCard
            key={cluster.id}
            cluster={cluster}
            position={index + 1}
            expanded={expanded.has(cluster.id)}
            onToggle={() =>
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(cluster.id)) next.delete(cluster.id);
                else next.add(cluster.id);
                return next;
              })
            }
            admin={{
              mergeSource,
              onStatusChange: (clusterId: string, status: ClusterStatus) =>
                void run((key) => api.updateCluster(code, clusterId, { status }, key)),
              onRename: (target) => {
                const label = window.prompt('Nuevo título del tema', target.label);
                if (label && label.trim()) {
                  void run((key) => api.updateCluster(code, target.id, { label }, key));
                }
              },
              onNote: (target) => {
                const note = window.prompt('Nota sobre cómo lo respondiste', target.note);
                if (note !== null) {
                  void run((key) => api.updateCluster(code, target.id, { note }, key));
                }
              },
              onMerge: handleMerge,
              onSplitQuestion: (questionId) =>
                void run((key) => api.splitQuestion(code, questionId, key)),
              onHideQuestion: (questionId) => {
                if (window.confirm('¿Ocultar esta pregunta del tablero?')) {
                  void run((key) => api.hideQuestion(code, questionId, key));
                }
              },
            }}
          />
        ))
      )}

      <div className="card" style={{ marginTop: '2rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Sensibilidad del agrupamiento</h2>
        <p className="muted">
          Cuánto se tienen que parecer dos preguntas para contarlas como el mismo tema. Más bajo
          agrupa más (y arriesga mezclar temas); más alto separa más. Sólo afecta a las preguntas
          que lleguen a partir de ahora.
        </p>
        <div className="row">
          {[0.3, 0.42, 0.55, 0.7].map((value) => (
            <button
              key={value}
              type="button"
              className={`tab${data?.room.threshold === value ? ' tab--active' : ''}`}
              onClick={() => void run((key) => api.updateRoom(code, { threshold: value }, key))}
            >
              {value === 0.3
                ? 'Agrupar mucho'
                : value === 0.42
                  ? 'Equilibrado'
                  : value === 0.55
                    ? 'Estricto'
                    : 'Muy estricto'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
