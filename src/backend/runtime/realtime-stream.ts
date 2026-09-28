import type {
  RealtimeEvent,
  RealtimeServerFrame,
} from "../../../packages/api/src/types/realtime.ts";
import {
  isRealtimeEventInput,
  isRealtimeJsonWithinLimit,
  MAX_REALTIME_CONTROL_BYTES,
  MAX_REALTIME_EVENT_BYTES,
  parseRealtimeClientFrame,
} from "../../../packages/api/src/types/realtime.ts";

/** Internal app ports; neither adapter exposes its provider state to the engine. */
export interface RealtimeSocket {
  send(data: string): void | Promise<void>;
  close(code?: number, reason?: string): void | Promise<void>;
}
export interface RealtimeRepository {
  currentSeq(): Promise<number>;
  appendEvent(event: RealtimeEvent, retain: number): Promise<void>;
  eventAt(seq: number): Promise<RealtimeEvent | undefined>;
  mintTicket(): Promise<string>;
  consumeTicket(ticket: string): Promise<boolean>;
}
export interface RealtimeTransport {
  accept(request: Request): Promise<Response>;
  list(): readonly RealtimeSocket[] | Promise<readonly RealtimeSocket[]>;
}
const EVENT_BUFFER_SIZE = 200;

/** Read at most the event budget; Content-Length is only an early-reject hint. */
async function readEventBody(request: Request): Promise<string | Response> {
  const length = request.headers.get("Content-Length");
  if (length !== null && Number(length) > MAX_REALTIME_EVENT_BYTES) {
    void request.body?.cancel().catch(() => {});
    return new Response("event too large", { status: 413 });
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  let bytes = new Uint8Array(4096);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const nextSize = size + value.byteLength;
      if (nextSize > MAX_REALTIME_EVENT_BYTES) {
        void reader.cancel().catch(() => {});
        return new Response("event too large", { status: 413 });
      }
      // Bound retained memory independently of chunk count or backing-buffer size.
      if (nextSize > bytes.byteLength) {
        const grown = new Uint8Array(
          Math.min(
            MAX_REALTIME_EVENT_BYTES,
            Math.max(nextSize, bytes.byteLength * 2),
          ),
        );
        grown.set(bytes.subarray(0, size));
        bytes = grown;
      }
      bytes.set(value, size);
      size = nextSize;
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(0, size),
  );
}

export class RealtimeStream {
  constructor(
    private readonly repository: RealtimeRepository,
    private readonly transport: RealtimeTransport,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/_ws":
        return this.handleUpgrade(request);
      case "/_emit":
        return this.handleEmit(request);
      case "/_ticket":
        return this.handleMintTicket(request);
      case "/_state":
        return this.handleState();
      default:
        return new Response("not found", { status: 404 });
    }
  }

  // -------------------------------------------------------------------------
  // Ticket mint + verify (one-time, short-lived; stored only as a hash)
  // -------------------------------------------------------------------------
  private async handleMintTicket(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const ticket = await this.repository.mintTicket();
    return Response.json({ ticket });
  }

  private async consumeTicket(ticket: string): Promise<boolean> {
    return this.repository.consumeTicket(ticket);
  }

  // -------------------------------------------------------------------------
  // WebSocket upgrade
  // -------------------------------------------------------------------------
  private async handleUpgrade(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    // The trusted worker route authenticated the session (auth=session) or
    // forwards a ticket this per-user stream minted; consume it durably.
    const authMode = request.headers.get("X-Realtime-Auth");
    if (authMode === "ticket") {
      const ticket = request.headers.get("X-Realtime-Ticket") ?? "";
      if (!ticket || !(await this.consumeTicket(ticket))) {
        return new Response("invalid ticket", { status: 401 });
      }
    } else if (authMode !== "session") {
      return new Response("unauthorized", { status: 401 });
    }

    return this.transport.accept(request);
  }

  // -------------------------------------------------------------------------
  // Event ingest + fanout
  // -------------------------------------------------------------------------
  private async handleEmit(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    let body: unknown;
    try {
      const raw = await readEventBody(request);
      if (raw instanceof Response) return raw;
      body = JSON.parse(raw);
    } catch {
      return new Response("bad json", { status: 400 });
    }
    if (!isRealtimeEventInput(body)) {
      return new Response("bad event", { status: 400 });
    }
    const seq = (await this.repository.currentSeq()) + 1;
    const event: RealtimeEvent = {
      id: seq,
      type: body.type,
      data: body.data,
    };
    await this.repository.appendEvent(event, EVENT_BUFFER_SIZE);
    await this.broadcast({ t: "event", event });
    return Response.json({
      id: seq,
      sockets: (await this.transport.list()).length,
    });
  }

  private async handleState(): Promise<Response> {
    return Response.json({
      seq: await this.repository.currentSeq(),
      sockets: (await this.transport.list()).length,
    });
  }

  // -------------------------------------------------------------------------
  // Socket events (neither native sockets nor broker IDs enter domain state)
  // -------------------------------------------------------------------------
  async socketMessage(
    ws: RealtimeSocket,
    message: string | ArrayBuffer | Uint8Array,
  ): Promise<void> {
    if (typeof message !== "string") return;
    if (!isRealtimeJsonWithinLimit(message, MAX_REALTIME_CONTROL_BYTES)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    const frame = parseRealtimeClientFrame(parsed);
    if (!frame) return;

    switch (frame.t) {
      case "ping":
        await this.send(ws, { t: "pong" });
        return;
      case "pong":
        return;
      case "hello": {
        const seq = await this.repository.currentSeq();
        if (frame.lastEventId !== undefined && frame.lastEventId < seq) {
          const oldestBuffered = Math.max(1, seq - EVENT_BUFFER_SIZE + 1);
          if (frame.lastEventId >= oldestBuffered - 1) {
            for (let i = frame.lastEventId + 1; i <= seq; i++) {
              const event = await this.repository.eventAt(i);
              if (event) await this.send(ws, { t: "event", event });
            }
          } else {
            // Gap predates the ring buffer: the client must re-fetch via REST.
            await this.send(ws, { t: "resync" });
          }
        }
        await this.send(ws, { t: "hello_ok", lastEventId: seq });
        return;
      }
    }
  }

  async socketClose(ws: RealtimeSocket): Promise<void> {
    try {
      await ws.close();
    } catch {
      // already closing
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private async broadcast(frame: RealtimeServerFrame): Promise<void> {
    for (const ws of await this.transport.list()) await this.send(ws, frame);
  }

  private async send(
    ws: RealtimeSocket,
    frame: RealtimeServerFrame,
  ): Promise<void> {
    try {
      await ws.send(JSON.stringify(frame));
    } catch {
      // Best effort fanout: one failed connection cannot suppress other peers.
    }
  }
}
