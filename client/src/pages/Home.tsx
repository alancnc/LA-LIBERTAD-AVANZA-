import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, saveAdminKey } from '../api.js';

export function Home() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const room = await api.createRoom(title || 'Clase');
      // La clave queda en este navegador: es lo único que da acceso al panel.
      saveAdminKey(room.code, room.adminKey);
      navigate(`/admin/${room.code}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la sala');
      setCreating(false);
    }
  }

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setError(null);
    try {
      await api.getRoom(clean);
      navigate(`/r/${clean}`);
    } catch {
      setError('No encontramos ninguna sala con ese código');
    }
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Preguntas en vivo</h1>
          <p className="header__sub">
            Los alumnos preguntan, el sistema junta las preguntas parecidas y arma el ranking de
            lo que más gente quiere que respondas.
          </p>
        </div>
      </header>

      {error && <div className="error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Soy el docente</h2>
        <p className="muted">
          Creá una sala y compartí el código con la clase. Vas a ver el ranking de temas
          actualizándose en vivo.
        </p>
        <form onSubmit={handleCreate} className="stack">
          <div>
            <label className="label" htmlFor="titulo">
              Nombre de la clase
            </label>
            <input
              id="titulo"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ej: Análisis Matemático II — Clase 7"
              maxLength={120}
            />
          </div>
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={creating}>
              {creating ? 'Creando...' : 'Crear sala'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Soy alumno</h2>
        <p className="muted">Ingresá el código que te pasó el docente.</p>
        <form onSubmit={handleJoin} className="stack">
          <div>
            <label className="label" htmlFor="codigo">
              Código de la sala
            </label>
            <input
              id="codigo"
              className="code-input"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={8}
              autoComplete="off"
            />
          </div>
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={!code.trim()}>
              Entrar
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Cómo funciona el ranking</h2>
        <ul className="muted" style={{ paddingLeft: '1.1rem', margin: 0 }}>
          <li>
            Cada pregunta que entra se compara con las que ya están: si es la misma consulta
            escrita distinta, se suma al mismo tema en lugar de duplicarlo.
          </li>
          <li>
            El puntaje de un tema es la cantidad de personas que lo quieren: quienes lo
            preguntaron más quienes votaron alguna de esas preguntas.
          </li>
          <li>
            Vos ordenás la clase de arriba hacia abajo y vas marcando cada tema como respondido.
          </li>
        </ul>
      </div>
    </div>
  );
}
