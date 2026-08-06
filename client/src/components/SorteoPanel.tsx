import { useEffect, useRef, useState, type FormEvent } from 'react';
import { barajar, limpiarNombres } from '../sorteo.js';

const STORAGE_KEY = 'preguntas-en-vivo:sorteo-expositores';
const MAX_NOMBRES = 30;
const MAX_LARGO = 40;
/** Cuánto dura el suspenso antes de mostrar el resultado. */
const DURACION_MS = 2600;

type Estado = 'inicio' | 'sorteando' | 'listo';

function cargarNombres(): string[] {
  try {
    const crudo = localStorage.getItem(STORAGE_KEY);
    if (!crudo) return [];
    const parsed: unknown = JSON.parse(crudo);
    return Array.isArray(parsed) ? limpiarNombres(parsed.map(String)) : [];
  } catch {
    // Un valor corrupto no puede impedir abrir el sorteo: se empieza vacío.
    return [];
  }
}

/** ¿El sistema pidió menos animación? Entonces se revela sin ruleta. */
function prefiereMenosMovimiento(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Sorteo del orden de exposición de los profesores.
 *
 * Herramienta interna del equipo docente: se abre desde el panel, que ya está
 * detrás de la contraseña. Nada de esto toca el servidor — los nombres viven
 * sólo en este navegador.
 */
export function SorteoPanel({ onClose }: { onClose: () => void }) {
  const [nombres, setNombres] = useState<string[]>(cargarNombres);
  const [entrada, setEntrada] = useState('');
  const [estado, setEstado] = useState<Estado>('inicio');
  const [orden, setOrden] = useState<string[]>([]);
  /** Índice que parpadea durante la ruleta. Es puro efecto visual. */
  const [resaltado, setResaltado] = useState(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nombres));
  }, [nombres]);

  // Cortar la ruleta si se cierra el panel a mitad de camino.
  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current);
  }, []);

  useEffect(() => {
    function alPresionar(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [onClose]);

  function agregar(event: FormEvent) {
    event.preventDefault();
    const nuevos = limpiarNombres([...nombres, ...entrada.split(/[,\n]/)]).slice(0, MAX_NOMBRES);
    setNombres(nuevos);
    setEntrada('');
    setEstado('inicio');
  }

  function quitar(nombre: string) {
    setNombres((actuales) => actuales.filter((item) => item !== nombre));
    setEstado('inicio');
  }

  function sortear() {
    if (nombres.length < 2 || estado === 'sorteando') return;

    // El resultado se decide ACÁ, de una vez y con el generador criptográfico.
    // La ruleta que viene después es decorado: no influye en quién sale, así
    // que no importa en qué momento termine ni cuánto dure.
    const resultado = barajar(nombres);

    if (prefiereMenosMovimiento()) {
      setOrden(resultado);
      setEstado('listo');
      return;
    }

    setEstado('sorteando');
    let transcurrido = 0;
    let espera = 55;

    const paso = () => {
      // Para el parpadeo alcanza Math.random: no decide nada.
      setResaltado(Math.floor(Math.random() * nombres.length));
      transcurrido += espera;
      espera *= 1.14;
      if (transcurrido < DURACION_MS) {
        temporizador.current = setTimeout(paso, espera);
      } else {
        setOrden(resultado);
        setEstado('listo');
      }
    };
    paso();
  }

  const ganador = orden[0];
  const resto = orden.slice(1);

  return (
    <div className="sorteo" role="dialog" aria-modal="true" aria-label="Sorteo de exposición">
      <button type="button" className="sorteo__cerrar" onClick={onClose} aria-label="Cerrar">
        ✕
      </button>

      <div className="sorteo__caja">
        <img src="/logo.png" alt="" className="sorteo__logo" />
        <p className="sorteo__eyebrow">Orden de exposición</p>

        {estado === 'listo' && ganador ? (
          <>
            <p className="sorteo__etiqueta">Expone primero</p>
            <h2 className="sorteo__ganador">{ganador}</h2>

            {resto.length > 0 && (
              <ol className="sorteo__orden">
                {resto.map((nombre, indice) => (
                  <li
                    key={nombre}
                    className="sorteo__puesto"
                    style={{ animationDelay: `${0.35 + indice * 0.09}s` }}
                  >
                    <span className="sorteo__numero">{indice + 2}</span>
                    <span>{nombre}</span>
                  </li>
                ))}
              </ol>
            )}

            <div className="sorteo__acciones">
              <button type="button" className="btn btn--primary" onClick={sortear}>
                Sortear de nuevo
              </button>
              <button type="button" className="btn" onClick={() => setEstado('inicio')}>
                Editar la lista
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="sorteo__titulo">
              {estado === 'sorteando' ? 'Sorteando...' : '¿Quién expone primero?'}
            </h2>

            {nombres.length === 0 ? (
              <p className="sorteo__ayuda">
                Cargá los nombres de quienes exponen. Podés pegar varios separados por comas.
              </p>
            ) : (
              <ul className="sorteo__lista">
                {nombres.map((nombre, indice) => (
                  <li
                    key={nombre}
                    className={`sorteo__chip${
                      estado === 'sorteando' && indice === resaltado ? ' sorteo__chip--activo' : ''
                    }`}
                  >
                    {nombre}
                    {estado !== 'sorteando' && (
                      <button
                        type="button"
                        className="sorteo__quitar"
                        onClick={() => quitar(nombre)}
                        aria-label={`Quitar a ${nombre}`}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {estado !== 'sorteando' && (
              <form onSubmit={agregar} className="sorteo__form">
                <input
                  value={entrada}
                  onChange={(event) => setEntrada(event.target.value)}
                  placeholder="Nombre del profesor"
                  maxLength={MAX_LARGO * 4}
                  autoComplete="off"
                  aria-label="Nombre del profesor"
                />
                <button type="submit" className="btn" disabled={!entrada.trim()}>
                  Agregar
                </button>
              </form>
            )}

            {estado !== 'sorteando' && (
              <div className="sorteo__acciones">
                <button
                  type="button"
                  className="btn btn--primary sorteo__boton"
                  onClick={sortear}
                  disabled={nombres.length < 2}
                >
                  Sortear
                </button>
                {nombres.length > 0 && (
                  <button type="button" className="btn" onClick={() => setNombres([])}>
                    Vaciar
                  </button>
                )}
              </div>
            )}

            {nombres.length === 1 && (
              <p className="sorteo__ayuda">Hace falta al menos otro nombre para sortear.</p>
            )}
          </>
        )}

        <p className="sorteo__nota">
          El orden se saca con el generador aleatorio del navegador. Los nombres quedan sólo en
          este dispositivo: no se envían ni se guardan en el servidor.
        </p>
      </div>
    </div>
  );
}
