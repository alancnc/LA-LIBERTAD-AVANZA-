import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  clearAdminPassword,
  getConfig,
  loadAdminPassword,
  saveAdminKey,
  saveAdminPassword,
  type RoomSummary,
} from '../api.js';

/**
 * Área del docente: una contraseña, y desde ahí todas sus clases.
 *
 * La contraseña la fija el despliegue en `ADMIN_PASSWORD`. Si esa variable no
 * está, esta página lo dice en lugar de dejar un formulario que no valida nada.
 */
export function AdminHome() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [autenticado, setAutenticado] = useState(() => loadAdminPassword() !== null);
  const [habilitado, setHabilitado] = useState<boolean | null>(null);
  const [errorConfig, setErrorConfig] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    void getConfig().then(
      (config) => setHabilitado(config.masterAdmin),
      (cause: unknown) => {
        // No se puede concluir nada sobre la contraseña si no se pudo consultar
        // la configuración: se muestra el error real.
        setErrorConfig(cause instanceof Error ? cause.message : 'No se pudo contactar al servidor');
      },
    );
  }, []);

  const cargar = useCallback(async () => {
    try {
      const { rooms: lista } = await api.listRooms();
      setRooms(lista);
      setError(null);
    } catch (cause) {
      // Una contraseña guardada puede haber dejado de valer si cambió en el
      // servidor: en ese caso se vuelve al formulario en lugar de insistir.
      clearAdminPassword();
      setAutenticado(false);
      setError(cause instanceof Error ? cause.message : 'No se pudo leer la lista de clases');
    }
  }, []);

  useEffect(() => {
    if (autenticado) void cargar();
  }, [autenticado, cargar]);

  async function entrar(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      // Se valida contra el servidor antes de guardarla, para no dejar una
      // contraseña incorrecta dando vueltas en el navegador.
      saveAdminPassword(password);
      await api.login(password);
      setAutenticado(true);
      setPassword('');
    } catch (cause) {
      clearAdminPassword();
      setError(cause instanceof Error ? cause.message : 'No se pudo entrar');
    }
  }

  async function crear(event: FormEvent) {
    event.preventDefault();
    setCreando(true);
    setError(null);
    try {
      const room = await api.createRoom(titulo || 'Clase');
      saveAdminKey(room.code, room.adminKey);
      navigate(`/admin/${room.code}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la clase');
      setCreando(false);
    }
  }

  function salir() {
    clearAdminPassword();
    setAutenticado(false);
    setRooms(null);
  }

  if (errorConfig !== null) {
    return (
      <div className="page">
        <header className="header">
          <div>
            <h1>Área del docente</h1>
          </div>
        </header>
        <div className="card">
          <div className="error">No se pudo contactar al servidor: {errorConfig}</div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Revisá <code>/api/health</code> en este mismo dominio: ahí figura si la base de datos
            conectó y, si no, cuál fue el error exacto.
          </p>
          <p style={{ marginBottom: 0 }}>
            <Link to="/">Volver al inicio</Link>
          </p>
        </div>
      </div>
    );
  }

  if (habilitado === false) {
    return (
      <div className="page">
        <header className="header">
          <div>
            <h1>Área del docente</h1>
          </div>
        </header>
        <div className="card">
          <div className="error">
            Este despliegue no tiene contraseña de docente configurada.
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Definí la variable de entorno <code>ADMIN_PASSWORD</code> y volvé a desplegar. Sin
            eso, cada clase sólo se puede administrar desde el navegador donde se creó.
          </p>
          <p style={{ marginBottom: 0 }}>
            <Link to="/">Volver al inicio</Link>
          </p>
        </div>
      </div>
    );
  }

  if (!autenticado) {
    return (
      <div className="page">
        <header className="header">
          <div>
            <h1>Área del docente</h1>
            <p className="header__sub">Sólo para vos. Los alumnos entran con el código de clase.</p>
          </div>
        </header>
        <div className="card">
          <form onSubmit={entrar} className="stack">
            <div>
              <label className="label" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </div>
            {error && <div className="error">{error}</div>}
            <div className="row">
              <button type="submit" className="btn btn--primary" disabled={!password}>
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

  return (
    <div className="page page--wide">
      <header className="header">
        <div>
          <h1>Mis clases</h1>
          <p className="header__sub">Creá una clase y compartí el código con los alumnos.</p>
        </div>
        <button type="button" className="btn btn--small" onClick={salir}>
          Cerrar sesión
        </button>
      </header>

      {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Nueva clase</h2>
        <form onSubmit={crear} className="stack">
          <div>
            <label className="label" htmlFor="titulo">
              Nombre de la clase
            </label>
            <input
              id="titulo"
              value={titulo}
              onChange={(event) => setTitulo(event.target.value)}
              placeholder="Ej: Análisis Matemático II — Clase 7"
              maxLength={120}
            />
          </div>
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={creando}>
              {creando ? 'Creando...' : 'Crear clase'}
            </button>
          </div>
        </form>
      </div>

      <h2 style={{ fontSize: '1.05rem' }}>Clases anteriores</h2>
      {rooms === null ? (
        <p className="muted">Cargando...</p>
      ) : rooms.length === 0 ? (
        <div className="empty">Todavía no creaste ninguna clase.</div>
      ) : (
        rooms.map((room) => (
          <article className="cluster" key={room.code}>
            <div className="cluster__rank">
              <div className="cluster__score">{room.pendingCount}</div>
              <div className="cluster__score-label">pendientes</div>
            </div>
            <div className="cluster__body">
              <h3 className="cluster__label">{room.title}</h3>
              <div className="cluster__meta">
                <span className="badge badge--hot">{room.code}</span>
                {room.closed && <span className="badge badge--discarded">cerrada</span>}
                <span>
                  {room.questionCount} {room.questionCount === 1 ? 'pregunta' : 'preguntas'} ·{' '}
                  {new Date(room.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="cluster__actions">
                <Link to={`/admin/${room.code}`} className="btn btn--small btn--primary">
                  Abrir panel
                </Link>
                <Link to={`/r/${room.code}`} className="btn btn--small btn--ghost">
                  Ver como alumno
                </Link>
              </div>
            </div>
          </article>
        ))
      )}
    </div>
  );
}
