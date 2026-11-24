import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { Services } from './container.js';

/**
 * Real-time layer: every event-bus event is pushed to authenticated WebSocket clients.
 * Clients authenticate with ?token=<session token>.
 */
export function attachWebSocket(server: Server, s: Services): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

  wss.on('connection', (socket, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const user = s.auth.validate(url.searchParams.get('token') ?? undefined);
    if (!user) {
      socket.close(4401, 'unauthenticated');
      return;
    }
    (socket as any).isAlive = true;
    socket.on('pong', () => ((socket as any).isAlive = true));
    socket.on('message', (raw) => {
      // Only ping is accepted from clients; all mutations go through the authenticated REST API.
      if (raw.toString() === 'ping') socket.send('{"type":"pong"}');
    });
    socket.send(JSON.stringify({ type: 'hello', payload: { user }, ts: new Date().toISOString() }));
  });

  const unsubscribe = s.bus.subscribe((event) => {
    const data = JSON.stringify(event);
    for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(data);
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if ((client as any).isAlive === false) {
        client.terminate();
        continue;
      }
      (client as any).isAlive = false;
      client.ping();
    }
  }, 30_000);
  heartbeat.unref();

  wss.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });
  return wss;
}
