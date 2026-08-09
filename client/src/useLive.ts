import { useCallback, useEffect, useRef, useState } from 'react';
import { getRealtimeMode, listenToRoom } from './api.js';

/**
 * Cada cuánto se refresca cuando el servidor no puede empujar los cambios.
 *
 * Estaba en 4 segundos, que en una clase de 20 personas son 18.000 lecturas de
 * la base por hora. Con una base medida por transferencia eso agota la cuota en
 * pocas clases, y a cambio de nada: nadie nota la diferencia entre enterarse de
 * una pregunta nueva a los 4 segundos o a los 10.
 */
const POLL_INTERVAL_MS = 10_000;
/** Refresco de respaldo con SSE activo, por si un proxy corta el stream sin avisar. */
const SSE_FALLBACK_INTERVAL_MS = 30_000;

/**
 * Mantiene un dato de la sala sincronizado.
 *
 * Se adapta a lo que soporte el despliegue: con un proceso persistente usa SSE
 * (los cambios llegan al instante); en serverless sondea cada pocos segundos.
 */
export function useLive<T>(
  code: string | undefined,
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): {
  data: T | null;
  error: string | null;
  loading: boolean;
  connected: boolean;
  refresh: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  // El fetcher se recrea en cada render; guardarlo en una ref evita
  // reabrir la suscripción cada vez.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Error inesperado');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!code) return;
    let active = true;
    let interval: ReturnType<typeof setInterval> | undefined;
    let stopStream: (() => void) | undefined;

    const refresh = () => {
      // Una pestaña en segundo plano no la está mirando nadie: seguir
      // sondeando ahí es gasto puro. Y es el caso más común — el alumno deja
      // la clase abierta en el celular y pasa a otra cosa.
      if (active && !document.hidden) void load();
    };

    refresh();

    void getRealtimeMode().then((mode) => {
      // El modo llega de forma asíncrona: si el componente ya se desmontó,
      // no hay que abrir nada.
      if (!active) return;
      if (mode === 'sse') {
        stopStream = listenToRoom(code, refresh);
        interval = setInterval(refresh, SSE_FALLBACK_INTERVAL_MS);
      } else {
        interval = setInterval(refresh, POLL_INTERVAL_MS);
      }
      setConnected(true);
    });

    // Al volver a la pestaña se refresca en el acto, para no quedar mirando
    // datos viejos hasta el próximo tic.
    const alVolver = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', alVolver);

    return () => {
      active = false;
      if (interval) clearInterval(interval);
      stopStream?.();
      document.removeEventListener('visibilitychange', alVolver);
      setConnected(false);
    };
  }, [code, load, ...deps]);

  return { data, error, loading, connected, refresh: load };
}
