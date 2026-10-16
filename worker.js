import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/ws") {
      return new Response(
        "DARK PATH SERVER ONLINE\nUsa /ws?room=CODIGO",
        { status: 200 }
      );
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket requerido", { status: 426 });
    }

    const room = url.searchParams.get("room");

    if (!room) {
      return new Response("Falta el codigo de sala", { status: 400 });
    }

    const id = env.DARK_PATH_ROOMS.idFromName(room.toUpperCase());
    const roomObject = env.DARK_PATH_ROOMS.get(id);

    return roomObject.fetch(request);
  },
};

export class DarkPathRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    const sockets = this.ctx.getWebSockets();

    // Por ahora, máximo 8 jugadores por sala.
    if (sockets.length >= 8) {
      return new Response("Sala llena", { status: 403 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const playerId = crypto.randomUUID();

    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      id: playerId,
      x: 0,
      y: 0,
      z: 0,
      rot: 0,
      flashlight: true,
    });

    // Avisar a los demás que entró un jugador.
    this.broadcast({
      type: "player_join",
      id: playerId,
    }, server);

    // Enviar al nuevo jugador los jugadores que ya estaban.
    for (const ws of sockets) {
      if (ws === server) continue;

      const state = ws.deserializeAttachment();

      if (!state) continue;

      server.send(JSON.stringify({
        type: "player_state",
        id: state.id,
        x: state.x,
        y: state.y,
        z: state.z,
        rot: state.rot,
        flashlight: state.flashlight,
      }));
    }

    server.send(JSON.stringify({
      type: "welcome",
      id: playerId,
      players: this.ctx.getWebSockets().length,
    }));

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  webSocketMessage(ws, message) {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const state = ws.deserializeAttachment();

    if (!state || !data.type) return;

    if (data.type === "state") {
      state.x = Number(data.x) || 0;
      state.y = Number(data.y) || 0;
      state.z = Number(data.z) || 0;
      state.rot = Number(data.rot) || 0;

      if (typeof data.flashlight === "boolean") {
        state.flashlight = data.flashlight;
      }

      ws.serializeAttachment(state);

      this.broadcast({
        type: "player_state",
        id: state.id,
        x: state.x,
        y: state.y,
        z: state.z,
        rot: state.rot,
        flashlight: state.flashlight,
      }, ws);

      return;
    }

    // Eventos del juego:
    // sonido, piedra, monstruos, muerte, etc.
    if (data.type === "game_event") {
      this.broadcast({
        type: "game_event",
        id: state.id,
        event: data.event,
        data: data.data ?? null,
      }, ws);

      return;
    }

    // Señalización para el futuro sistema de voz/WebRTC.
    if (data.type === "voice_signal") {
      this.broadcast({
        type: "voice_signal",
        id: state.id,
        signal: data.signal,
      }, ws);
    }
  }

  webSocketClose(ws) {
    const state = ws.deserializeAttachment();

    if (!state) return;

    this.broadcast({
      type: "player_leave",
      id: state.id,
    }, ws);
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }

  broadcast(data, except = null) {
    const message = JSON.stringify(data);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;

      try {
        ws.send(message);
      } catch {
        // Ignorar conexiones que ya se cerraron.
      }
    }
  }
          }
