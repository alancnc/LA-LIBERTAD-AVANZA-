import type { Response } from 'express';

/**
 * Canal Server-Sent Events por sala: cuando alguien pregunta o vota, todos los
 * tableros abiertos se enteran al instante sin necesidad de polling.
 */

interface Subscriber {
  id: number;
  response: Response;
}

const subscribers = new Map<string, Subscriber[]>();
let nextSubscriberId = 1;

/** Registra una conexión SSE y devuelve la función para darla de baja. */
export function subscribe(roomId: string, response: Response): () => void {
  const subscriber: Subscriber = { id: nextSubscriberId, response };
  nextSubscriberId += 1;

  const list = subscribers.get(roomId) ?? [];
  list.push(subscriber);
  subscribers.set(roomId, list);

  return () => {
    const current = subscribers.get(roomId);
    if (!current) return;
    const remaining = current.filter((item) => item.id !== subscriber.id);
    if (remaining.length === 0) {
      subscribers.delete(roomId);
    } else {
      subscribers.set(roomId, remaining);
    }
  };
}

/** Avisa a los clientes de una sala que el tablero cambió. */
export function publish(roomId: string, event: string, payload: unknown = {}): void {
  const list = subscribers.get(roomId);
  if (!list || list.length === 0) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const subscriber of list) {
    subscriber.response.write(frame);
  }
}

export function subscriberCount(roomId: string): number {
  return subscribers.get(roomId)?.length ?? 0;
}
