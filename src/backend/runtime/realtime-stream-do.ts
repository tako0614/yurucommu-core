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
import { parseRealtimeClientFrame } from "../../../packages/api/src/types/realtime.ts";

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
/** Outstanding one-time tickets per user (multiple tabs may mint at once). */
const MAX_OUTSTANDING_TICKETS = 8;
const TICKET_TTL_MS = 60_000;

interface StoredTicket {
  hash: string;
  expiresAt: number;
}

function eventKey(seq: number): string {
  // Fixed-width key so storage.list({prefix}) returns events in seq order.
  return `${EVENT_PREFIX}${String(seq).padStart(12, "0")}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time hex-string comparison (both inputs are fixed-width hashes). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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
    const ticket =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", "");
    const hash = await sha256Hex(ticket);
    const now = Date.now();

    const stored = await this.state.storage.list<StoredTicket>({
      prefix: TICKET_PREFIX,
    });
    // Drop expired tickets; keep the newest few so parallel tabs still work.
    const live = [...stored.entries()]
      .filter(([, t]) => t.expiresAt > now)
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [key] of stored) {
      if (!live.some(([liveKey]) => liveKey === key)) {
        await this.state.storage.delete(key);
      }
    }
    while (live.length >= MAX_OUTSTANDING_TICKETS) {
      const [oldestKey] = live.shift()!;
      await this.state.storage.delete(oldestKey);
    }
    await this.state.storage.put(`${TICKET_PREFIX}${hash}`, {
      hash,
      expiresAt: now + TICKET_TTL_MS,
    } satisfies StoredTicket);

    return Response.json({ ticket });
  }

  private async consumeTicket(ticket: string): Promise<boolean> {
    const hash = await sha256Hex(ticket);
    const key = `${TICKET_PREFIX}${hash}`;
    const stored = await this.state.storage.get<StoredTicket>(key);
    if (!stored) return false;
    // Single-use: consume before validating expiry so a replay always misses.
    await this.state.storage.delete(key);
    if (stored.expiresAt <= Date.now()) return false;
    return timingSafeEqualHex(stored.hash, hash);
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
    let body: { type?: unknown; data?: unknown };
    try {
      body = (await request.json()) as { type?: unknown; data?: unknown };
    } catch {
      return new Response("bad json", { status: 400 });
    }
    if (typeof body.type !== "string" || !body.type) {
      return new Response("bad event", { status: 400 });
    }
    const data =
      body.data && typeof body.data === "object"
        ? (body.data as Record<string, unknown>)
        : {};

    const seq = (await this.currentSeq()) + 1;
    const event: RealtimeEvent = {
      id: seq,
      type: body.type as RealtimeEvent["type"],
      data,
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
