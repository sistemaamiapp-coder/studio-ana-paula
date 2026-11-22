// Durable Object: hub de WebSocket do painel (notificações em tempo real).
export class LiveHub {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const data = await request.text();
      for (const socket of this.state.getWebSockets()) {
        try { socket.send(data); } catch { /* socket morto: será removido no close */ }
      }
      return new Response('ok');
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'connected', at: new Date().toISOString() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(socket, message) {
    if (message === 'ping') socket.send('pong');
  }

  async webSocketClose(socket, code, reason) {
    try { socket.close(code, reason); } catch { /* já fechado */ }
  }
}
