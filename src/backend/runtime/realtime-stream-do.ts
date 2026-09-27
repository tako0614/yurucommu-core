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

import { RealtimeStream } from "./realtime-stream.ts";
import type { RealtimeRepository } from "./realtime-stream.ts";
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
const TICKET_PREFIX = "ticket:";
import { consumeOneTimeTicket, mintOneTimeTicket } from "./one-time-ticket.ts";

function eventKey(seq: number): string {
  // Fixed-width key so storage.list({prefix}) returns events in seq order.
  return `${EVENT_PREFIX}${String(seq).padStart(12, "0")}`;
}

/** CF persistence stays byte-compatible with existing seq/event/ticket keys. */
function repository(storage: DoStorage): RealtimeRepository {
  return {
    async currentSeq() {
      const stored = await storage.get<number>(SEQ_KEY);
      return typeof stored === "number" ? stored : 0;
    },
    async appendEvent(event, retain) {
      await storage.put(eventKey(event.id), event);
      await storage.put(SEQ_KEY, event.id);
      if (event.id > retain) await storage.delete(eventKey(event.id - retain));
    },
    eventAt: (seq) => storage.get(eventKey(seq)),
    mintTicket: () => mintOneTimeTicket(storage, { prefix: TICKET_PREFIX }),
    consumeTicket: (ticket) =>
      consumeOneTimeTicket(storage, ticket, { prefix: TICKET_PREFIX }),
  };
}

export class RealtimeStreamDO {
  private readonly stream: RealtimeStream;

  constructor(state: DoState) {
    this.stream = new RealtimeStream(repository(state.storage), {
      list: () => state.getWebSockets(),
      async accept() {
        const pair = new WebSocketPair();
        state.acceptWebSocket(pair[1]);
        return new Response(null, {
          status: 101,
          webSocket: pair[0],
        } as unknown as ResponseInit);
      },
    });
  }

  fetch(request: Request): Promise<Response> {
    return this.stream.fetch(request);
  }

  webSocketMessage(
    ws: DoWebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    return this.stream.socketMessage(ws, message);
  }

  webSocketClose(ws: DoWebSocket): Promise<void> {
    return this.stream.socketClose(ws);
  }

  async webSocketError(): Promise<void> {
    // getWebSockets() excludes the errored socket automatically.
  }
}
