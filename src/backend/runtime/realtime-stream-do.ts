/**
 * RealtimeStreamDO — per-local-user realtime fanout stream.
 *
 * One DO instance per local actor (`idFromName(actorApId)`). It is the single
 * standing WebSocket the browser keeps open; every live update the client used
 * to poll for (talk messages, typing, read receipts, notifications, unread
 * counters) is pushed through it as a `RealtimeEvent`.
 *
 * Producers (the worker's REST handlers and queue consumers) POST events to
 * `/_emit`; the DO assigns a monotonic id, persists the event into a small
 * ring buffer (so a reconnect can replay the gap across hibernation), and
 * broadcasts to every connected socket. Deliberately separate from
 * `CallSignalingDurableObject`: call signaling is ephemeral SDP/ICE with its
 * own state machine, while this stream is a durable-ordered event feed.
 *
 * Auth model: the DO binding is the trust boundary. `/ _ws` upgrades arrive
 * only via the worker route, which either resolved the session actor or
 * verified a one-time ticket this DO minted earlier (`/_ticket`); the DO
 * re-checks ticket upgrades against its own storage so a ticket is
 * single-use and expires even if the worker is confused.
 *
 * Uses Hibernatable WebSockets: idle sockets are evicted from memory and the
 * ring buffer lives in DO storage, so an idle connected user costs nothing.
 */

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

// --- Minimal Cloudflare DO + Hibernatable WebSocket surface ----------------
// (typed file-locally, matching call-signaling-do.ts, so this file does not
// depend on a specific @cloudflare/workers-types version)
interface DoWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
interface DoStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: {
    prefix?: string;
    limit?: number;
    reverse?: boolean;
  }): Promise<Map<string, T>>;
}
interface DoState {
  acceptWebSocket(ws: DoWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): DoWebSocket[];
  readonly storage: DoStorage;
}
declare const WebSocketPair: {
  new (): { 0: DoWebSocket; 1: DoWebSocket };
};

const SEQ_KEY = "seq";
const EVENT_PREFIX = "evt:";
/** Ring buffer size: how many events a reconnect can replay before `resync`. */
const EVENT_BUFFER_SIZE = 200;
const TICKET_PREFIX = "ticket:";
import { consumeOneTimeTicket, mintOneTimeTicket } from "./one-time-ticket.ts";

function eventKey(seq: number): string {
  // Fixed-width key so storage.list({prefix}) returns events in seq order.
  return `${EVENT_PREFIX}${String(seq).padStart(12, "0")}`;
}

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

export class RealtimeStreamDO {
  private seqCache: number | null = null;

  constructor(private readonly state: DoState) {}

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
    const ticket = await mintOneTimeTicket(this.state.storage, {
      prefix: TICKET_PREFIX,
    });
    return Response.json({ ticket });
  }

  private async consumeTicket(ticket: string): Promise<boolean> {
    return consumeOneTimeTicket(this.state.storage, ticket, {
      prefix: TICKET_PREFIX,
    });
  }

  // -------------------------------------------------------------------------
  // WebSocket upgrade
  // -------------------------------------------------------------------------
  private async handleUpgrade(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    // The worker route either authenticated the session itself (auth=session)
    // or forwards a ticket this DO minted; re-verify tickets against storage.
    const authMode = request.headers.get("X-Realtime-Auth");
    if (authMode === "ticket") {
      const ticket = request.headers.get("X-Realtime-Ticket") ?? "";
      if (!ticket || !(await this.consumeTicket(ticket))) {
        return new Response("invalid ticket", { status: 401 });
      }
    } else if (authMode !== "session") {
      return new Response("unauthorized", { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    return new Response(null, {
      status: 101,
      // `webSocket` is a Cloudflare-specific ResponseInit field.
      webSocket: client,
    } as unknown as ResponseInit);
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
    const seq = (await this.currentSeq()) + 1;
    const event: RealtimeEvent = {
      id: seq,
      type: body.type,
      data: body.data,
    };
    await this.state.storage.put(eventKey(seq), event);
    await this.state.storage.put(SEQ_KEY, seq);
    this.seqCache = seq;
    const pruneSeq = seq - EVENT_BUFFER_SIZE;
    if (pruneSeq > 0) {
      await this.state.storage.delete(eventKey(pruneSeq));
    }

    this.broadcast({ t: "event", event });
    return Response.json({
      id: seq,
      sockets: this.state.getWebSockets().length,
    });
  }

  private async handleState(): Promise<Response> {
    return Response.json({
      seq: await this.currentSeq(),
      sockets: this.state.getWebSockets().length,
    });
  }

  // -------------------------------------------------------------------------
  // Hibernatable WebSocket events
  // -------------------------------------------------------------------------
  async webSocketMessage(
    ws: DoWebSocket,
    message: string | ArrayBuffer,
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
        this.send(ws, { t: "pong" });
        return;
      case "pong":
        return;
      case "hello": {
        const seq = await this.currentSeq();
        if (frame.lastEventId !== undefined && frame.lastEventId < seq) {
          const oldestBuffered = Math.max(1, seq - EVENT_BUFFER_SIZE + 1);
          if (frame.lastEventId >= oldestBuffered - 1) {
            for (let i = frame.lastEventId + 1; i <= seq; i++) {
              const event = await this.state.storage.get<RealtimeEvent>(
                eventKey(i),
              );
              if (event) this.send(ws, { t: "event", event });
            }
          } else {
            // Gap predates the ring buffer: the client must re-fetch via REST.
            this.send(ws, { t: "resync" });
          }
        }
        this.send(ws, { t: "hello_ok", lastEventId: seq });
        return;
      }
    }
  }

  async webSocketClose(ws: DoWebSocket): Promise<void> {
    try {
      ws.close();
    } catch {
      // already closing
    }
  }

  async webSocketError(): Promise<void> {
    // getWebSockets() excludes the errored socket automatically.
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  private async currentSeq(): Promise<number> {
    if (this.seqCache !== null) return this.seqCache;
    const stored = await this.state.storage.get<number>(SEQ_KEY);
    this.seqCache = typeof stored === "number" ? stored : 0;
    return this.seqCache;
  }

  private broadcast(frame: RealtimeServerFrame): void {
    for (const ws of this.state.getWebSockets()) this.send(ws, frame);
  }

  private send(ws: DoWebSocket, frame: RealtimeServerFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // socket gone; getWebSockets() will drop it
    }
  }
}
