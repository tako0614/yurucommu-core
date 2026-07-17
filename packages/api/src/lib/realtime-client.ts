/**
 * Realtime stream client — the ONE WebSocket a product keeps open per signed-in
 * user. Replaces the short-interval polling loops (talk messages 4s, typing 4s,
 * contacts 20s, unread badges 20-30s): the server pushes `RealtimeEvent`s and
 * the client fans them out to `on(type, handler)` subscribers.
 *
 * Transport: mints a one-time ticket over the normal authenticated fetch path
 * (`POST /api/realtime/ticket` — works with both cookie and bearer transports;
 * the browser WebSocket API cannot send an Authorization header), then connects
 * to `wss://…/api/realtime/socket?actor=…&ticket=…`.
 *
 * Lifecycle: `start()` probes `GET /api/realtime/config`. When the server has
 * no realtime runtime (`available:false` — e.g. a Bun self-host without
 * Durable Objects) the client settles in status "unavailable" and the product
 * enables its LOW-FREQUENCY fallback polling instead. Transient failures
 * (network, worker restart) reconnect with exponential backoff and replay the
 * missed gap via `hello{lastEventId}`; a `resync` answer means the gap
 * outlived the server buffer and subscribers should re-fetch via REST.
 */

import { apiFetch, apiPost } from "./api/fetch.ts";
import { getYurucommuApiTransport } from "./transport.ts";
import type { RealtimeEvent, RealtimeEventType } from "../types/realtime.ts";
import { parseRealtimeServerFrame } from "../types/realtime.ts";

export type RealtimeStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "unavailable";

export type RealtimeEventHandler = (event: RealtimeEvent) => void;
export type RealtimeResyncHandler = () => void;
export type RealtimeStatusHandler = (status: RealtimeStatus) => void;

export interface RealtimeClient {
  start(): void;
  stop(): void;
  status(): RealtimeStatus;
  /** True while the live socket is up — products gate fallback polling on it. */
  isConnected(): boolean;
  on(type: RealtimeEventType | "*", handler: RealtimeEventHandler): () => void;
  /** Fired on reconnect gaps the server could not replay: re-fetch via REST. */
  onResync(handler: RealtimeResyncHandler): () => void;
  onStatus(handler: RealtimeStatusHandler): () => void;
}

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const PING_INTERVAL_MS = 25_000;
/** No frame for this long ⇒ the socket is dead (missed pings): reconnect. */
const IDLE_TIMEOUT_MS = 60_000;

interface TicketResponse {
  ticket?: string;
  actor_ap_id?: string;
}

function resolveSocketUrl(actorApId: string, ticket: string): string | null {
  if (typeof location === "undefined") return null;
  const transport = getYurucommuApiTransport();
  const resolved = transport.resolveUrl("/api/realtime/socket");
  let url: URL;
  try {
    url = new URL(resolved, location.origin);
  } catch {
    return null;
  }
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.searchParams.set("actor", actorApId);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

export function createRealtimeClient(): RealtimeClient {
  const handlers = new Map<string, Set<RealtimeEventHandler>>();
  const resyncHandlers = new Set<RealtimeResyncHandler>();
  const statusHandlers = new Set<RealtimeStatusHandler>();

  let currentStatus: RealtimeStatus = "idle";
  let socket: WebSocket | null = null;
  let started = false;
  let attempts = 0;
  let lastEventId: number | undefined;
  let lastFrameAt = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  function setStatus(next: RealtimeStatus): void {
    if (currentStatus === next) return;
    currentStatus = next;
    for (const handler of statusHandlers) {
      try {
        handler(next);
      } catch {
        // subscriber error must not break the stream
      }
    }
  }

  function dispatch(event: RealtimeEvent): void {
    for (const key of [event.type, "*"]) {
      const set = handlers.get(key);
      if (!set) continue;
      for (const handler of set) {
        try {
          handler(event);
        } catch {
          // subscriber error must not break the stream
        }
      }
    }
  }

  function dispatchResync(): void {
    for (const handler of resyncHandlers) {
      try {
        handler();
      } catch {
        // ignore
      }
    }
  }

  function clearTimers(): void {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function closeSocket(): void {
    if (!socket) return;
    const s = socket;
    socket = null;
    try {
      s.close();
    } catch {
      // already closed
    }
  }

  function scheduleReconnect(): void {
    if (!started) return;
    setStatus("reconnecting");
    attempts += 1;
    const backoff = Math.min(
      BACKOFF_CAP_MS,
      BACKOFF_BASE_MS * 2 ** Math.min(attempts - 1, 5),
    );
    const jitter = backoff * (0.5 + Math.random() * 0.5);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, jitter);
  }

  async function connect(): Promise<void> {
    if (!started || typeof WebSocket === "undefined") return;
    const myGeneration = ++generation;
    setStatus(attempts === 0 ? "connecting" : "reconnecting");

    // 1) Capability probe: an explicit `available:false` is a configuration
    //    fact (no DO runtime), not an outage — settle in fallback-polling mode.
    let available: boolean;
    try {
      const res = await apiFetch("/api/realtime/config");
      if (!res.ok) throw new Error(`config ${res.status}`);
      const body = (await res.json()) as { available?: unknown };
      available = body.available === true;
    } catch {
      if (!started || myGeneration !== generation) return;
      scheduleReconnect();
      return;
    }
    if (!started || myGeneration !== generation) return;
    if (!available) {
      setStatus("unavailable");
      return;
    }

    // 2) One-time ticket over the authenticated fetch path.
    let ticket: string;
    let actorApId: string;
    try {
      const res = await apiPost("/api/realtime/ticket");
      if (res.status === 401) {
        // Not signed in: nothing to stream. Products restart on login.
        setStatus("unavailable");
        return;
      }
      if (!res.ok) throw new Error(`ticket ${res.status}`);
      const body = (await res.json()) as TicketResponse;
      if (!body.ticket || !body.actor_ap_id) throw new Error("bad ticket");
      ticket = body.ticket;
      actorApId = body.actor_ap_id;
    } catch {
      if (!started || myGeneration !== generation) return;
      scheduleReconnect();
      return;
    }
    if (!started || myGeneration !== generation) return;

    const url = resolveSocketUrl(actorApId, ticket);
    if (!url) {
      setStatus("unavailable");
      return;
    }

    // 3) Connect + hello/replay.
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;
    lastFrameAt = Date.now();

    ws.onopen = () => {
      if (socket !== ws) return;
      ws.send(JSON.stringify({ t: "hello", lastEventId }));
    };

    ws.onmessage = (message: MessageEvent) => {
      if (socket !== ws) return;
      lastFrameAt = Date.now();
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(message.data));
      } catch {
        return;
      }
      const frame = parseRealtimeServerFrame(parsed);
      if (!frame) return;
      switch (frame.t) {
        case "hello_ok":
          attempts = 0;
          if (lastEventId === undefined) lastEventId = frame.lastEventId;
          else lastEventId = Math.max(lastEventId, frame.lastEventId);
          setStatus("connected");
          return;
        case "event":
          lastEventId = Math.max(lastEventId ?? 0, frame.event.id);
          dispatch(frame.event);
          return;
        case "resync":
          dispatchResync();
          return;
        case "ping":
          ws.send(JSON.stringify({ t: "pong" }));
          return;
        case "pong":
          return;
      }
    };

    const onGone = () => {
      if (socket !== ws) return;
      socket = null;
      scheduleReconnect();
    };
    ws.onclose = onGone;
    ws.onerror = onGone;

    if (pingTimer === null) {
      pingTimer = setInterval(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastFrameAt > IDLE_TIMEOUT_MS) {
          // Dead socket (missed pongs): force the reconnect path.
          closeSocket();
          scheduleReconnect();
          return;
        }
        try {
          socket.send(JSON.stringify({ t: "ping" }));
        } catch {
          // close/error handler will reconnect
        }
      }, PING_INTERVAL_MS);
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      attempts = 0;
      void connect();
    },
    stop() {
      started = false;
      generation += 1;
      clearTimers();
      closeSocket();
      lastEventId = undefined;
      setStatus("idle");
    },
    status() {
      return currentStatus;
    },
    isConnected() {
      return currentStatus === "connected";
    },
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => {
        set!.delete(handler);
      };
    },
    onResync(handler) {
      resyncHandlers.add(handler);
      return () => {
        resyncHandlers.delete(handler);
      };
    },
    onStatus(handler) {
      statusHandlers.add(handler);
      return () => {
        statusHandlers.delete(handler);
      };
    },
  };
}
