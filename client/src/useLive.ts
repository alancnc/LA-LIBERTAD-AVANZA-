import { useCallback, useEffect, useRef, useState } from 'react';
import { getRealtimeMode, listenToRoom } from './api.js';

/** Cada cuánto se refresca cuando el servidor no puede empujar los cambios. */
const POLL_INTERVAL_MS = 4_000;
/** Refresco de respaldo con SSE activo, por si un proxy corta el stream sin avisar. */
const SSE_FALLBACK_INTERVAL_MS = 15_000;

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
      if (active) void load();
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

    return () => {
      active = false;
      if (interval) clearInterval(interval);
      stopStream?.();
      setConnected(false);
    };
  }, [code, load, ...deps]);

  return { data, error, loading, connected, refresh: load };
}
