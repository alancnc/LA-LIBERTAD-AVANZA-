import { useCallback, useEffect, useRef, useState } from 'react';
import { listenToRoom } from './api.js';

/**
 * Mantiene un dato de la sala sincronizado.
 *
 * La vía principal es SSE (llega al instante). Además se refresca cada 15s como
 * red de seguridad, por si un proxy corta el stream sin avisar.
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
  // reabrir el stream SSE cada vez.
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

    const refresh = () => {
      if (active) void load();
    };

    refresh();
    const stop = listenToRoom(code, refresh);
    setConnected(true);
    const interval = setInterval(refresh, 15_000);

    return () => {
      active = false;
      clearInterval(interval);
      stop();
      setConnected(false);
    };
  }, [code, load, ...deps]);

  return { data, error, loading, connected, refresh: load };
}
