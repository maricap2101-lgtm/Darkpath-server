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

    const id = env.DARK_PATH_ROOMS.idFromName(room);
    const stub = env.DARK_PATH_ROOMS.get(id);

    return stub.fetch(request);
  },
};

export class DarkPathRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);

    const playerId = crypto.randomUUID();

    server.serializeAttachment({
      id: playerId,
      x: 0,
      y: 0,
      z: 0,
      rot: 0,
    });

    this.broadcast({
      type: "player_join",
      id: playerId,
    });

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

    const attachment = ws.deserializeAttachment();

    if (!attachment) return;

    if (data.type === "state") {
      attachment.x = Number(data.x) || 0;
      attachment.y = Number(data.y) || 0;
      attachment.z = Number(data.z) || 0;
      attachment.rot = Number(data.rot) || 0;

      ws.serializeAttachment(attachment);

      this.broadcast({
        type: "player_state",
        id: attachment.id,
        x: attachment.x,
        y: attachment.y,
        z: attachment.z,
        rot: attachment.rot,
      }, ws);
    }
  }

  webSocketClose(ws) {
    const attachment = ws.deserializeAttachment();

    if (attachment) {
      this.broadcast({
        type: "player_leave",
        id: attachment.id,
      }, ws);
    }
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }

  broadcast(data, except = null) {
    const message = JSON.stringify(data);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) {
        try {
          ws.send(message);
        } catch {}
      }
    }
  }
  }
