import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Brand } from '../components/Brand.js';

/**
 * Portada.
 *
 * Está pensada para el alumno, que es quien la abre en el celular en medio de
 * la clase: entra un código y listo. El acceso del docente es un enlace aparte,
 * porque lo usa una sola persona y una sola vez por clase.
 */
export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setError(null);
    setEntrando(true);
    try {
      await api.getRoom(clean);
      navigate(`/r/${clean}`);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.includes('base de datos')
          ? cause.message
          : 'No encontramos ninguna clase con ese código. Revisalo con el docente.',
      );
      setEntrando(false);
    }
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <Brand subtitle="Misiones" />
          <h1 style={{ marginTop: '0.85rem' }}>Preguntas en vivo</h1>
          <p className="header__sub">
            Mandá tu pregunta. Si alguien ya preguntó lo mismo, las juntamos y el tema sube en el
            ranking para que el docente lo responda antes.
          </p>
        </div>
      </header>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Entrar a una clase</h2>
        <p className="muted">Ingresá el código de 6 caracteres que te pasó el docente.</p>
        <form onSubmit={handleJoin} className="stack">
          <div>
            <label className="label" htmlFor="codigo">
              Código de la clase
            </label>
            <input
              id="codigo"
              className="code-input"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={8}
              autoComplete="off"
              autoFocus
            />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={!code.trim() || entrando}>
              {entrando ? 'Entrando...' : 'Entrar'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Cómo funciona</h2>
        <ul className="muted" style={{ paddingLeft: '1.1rem', margin: 0 }}>
          <li>
            Cada pregunta que entra se compara con las que ya están: si es la misma consulta
            escrita distinta, se suma al mismo tema en lugar de duplicarlo.
          </li>
          <li>
            El puntaje de un tema es cuánta gente lo quiere: quienes lo preguntaron más quienes
            votaron alguna de esas preguntas.
          </li>
          <li>Podés votar las preguntas de otros que también querés que se respondan.</li>
          <li>
            <strong>Las preguntas van firmadas.</strong> Para preguntar hay que poner el nombre: no
            se aceptan preguntas anónimas.
          </li>
        </ul>
      </div>

      <p className="muted" style={{ textAlign: 'center', marginTop: '2rem' }}>
        ¿Sos el docente? <Link to="/admin">Entrar al área del docente</Link>
      </p>
    </div>
  );
}
