import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type OpenRoom } from '../api.js';
import { Brand } from '../components/Brand.js';

/**
 * Portada.
 *
 * Está pensada para el alumno, que es quien la abre en el celular en medio de
 * la clase: elige su clase de la lista y entra. El acceso del docente es un
 * enlace aparte, porque lo usa una sola persona y una sola vez por clase.
 *
 * El listado es público a propósito: entrar dejó de requerir el código, que era
 * lo engorroso. El código sigue funcionando para quien lo tenga a mano.
 */
export function Home() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<OpenRoom[] | null>(null);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [conCodigo, setConCodigo] = useState(false);

  useEffect(() => {
    void api.listOpenRooms().then(
      ({ rooms: lista }) => setRooms(lista),
      (cause: unknown) => {
        setErrorLista(
          cause instanceof Error ? cause.message : 'No se pudo contactar al servidor',
        );
        setRooms([]);
      },
    );
  }, []);

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
            Elegí tu clase y mandá tu pregunta. Si alguien ya preguntó lo mismo, las juntamos y el
            tema sube en el ranking para que el docente lo responda antes.
          </p>
        </div>
      </header>

      <h2 style={{ fontSize: '1.05rem' }}>Clases abiertas</h2>

      {errorLista && <div className="error">{errorLista}</div>}

      {rooms === null ? (
        <p className="muted">Cargando clases...</p>
      ) : rooms.length === 0 ? (
        <div className="empty">
          No hay ninguna clase abierta en este momento. Cuando el docente abra una, va a aparecer
          acá sola.
        </div>
      ) : (
        <div className="rooms">
          {rooms.map((room) => (
            <Link key={room.code} to={`/r/${room.code}`} className="room">
              <span className="room__title">{room.title}</span>
              <span className="room__meta">
                {new Date(room.createdAt).toLocaleDateString()} · entrar
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* El código sigue sirviendo: es la forma de entrar a una clase que no
          está listada, por ejemplo una que el docente ya cerró. */}
      <p className="muted" style={{ marginTop: '1.5rem' }}>
        {conCodigo ? (
          <form onSubmit={handleJoin} className="stack" style={{ maxWidth: '18rem' }}>
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
              <button type="button" className="btn btn--ghost" onClick={() => setConCodigo(false)}>
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setConCodigo(true)}>
            ¿Tenés un código de clase?
          </button>
        )}
      </p>

      <div className="card" style={{ marginTop: '1.5rem' }}>
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
