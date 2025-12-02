import { Hono } from "hono";
import { upgradeWebSocket } from "hono/cloudflare-workers";
import type { WSContext } from "hono/ws";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { fail, releaseStore } from "@takos/platform/server";
import { makeData } from "../data";
import { auth } from "../middleware/auth";

const encoder = new TextEncoder();
const KEEPALIVE_MS = 15000;
const POLL_INTERVAL_MS = 2500;
const DEFAULT_LOOKBACK_MS = 2 * 60 * 1000;
const DEFAULT_RETRY_AFTER_MS = 5000;
const SSE_MAX_PENDING_CHUNKS = 500;
const WS_MAX_BUFFERED_BYTES = 512 * 1024;

type BackoffHint = {
  reason: string;
  retry_after_ms: number;
};

type ParsedTopics = {
  home: boolean;
  notifications: boolean;
  userIds: Set<string>;
};

function parseTopics(raw: string | null): ParsedTopics {
  const result: ParsedTopics = {
    home: false,
    notifications: false,
    userIds: new Set<string>(),
  };
  const parts = (raw || "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length === 0) {
    result.home = true;
    result.notifications = true;
    return result;
  }

  for (const part of parts) {
    if (part === "home") result.home = true;
    else if (part === "notifications") result.notifications = true;
    else if (part.startsWith("user:")) {
      const userId = part.slice("user:".length).trim();
      if (userId) result.userIds.add(userId);
    }
  }

  if (!result.home && !result.notifications && result.userIds.size === 0) {
    result.home = true;
    result.notifications = true;
  }

  return result;
}

function parseCursor(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // First try parsing the whole string as a number (Unix timestamp)
  const numeric = Number(raw);
  if (!Number.isNaN(numeric) && numeric > 0) return numeric;
  // Then try parsing as ISO date string
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return parsed;
  // Finally, try splitting on ":" for cursor format "timestamp:type"
  const head = raw.split(":")[0];
  const headNumeric = Number(head);
  if (!Number.isNaN(headNumeric) && headNumeric > 0) return headNumeric;
  return null;
}

function getInitialCursor(url: URL, headerValue?: string | null): number {
  const cursorInput =
    url.searchParams.get("cursor") ??
    url.searchParams.get("since") ??
    headerValue ??
    "";
  return parseCursor(cursorInput) ?? Date.now() - DEFAULT_LOOKBACK_MS;
}

const toTimestamp = (value: string | number | Date | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const ts = new Date(value as any).getTime();
  return Number.isNaN(ts) ? null : ts;
};

function createBackoffHint(reason: string, retryAfterMs: number = DEFAULT_RETRY_AFTER_MS): BackoffHint {
  return { reason, retry_after_ms: retryAfterMs };
}

function formatSseMessage(
  event: string,
  data: any,
  id?: string,
  retryAfterMs?: number,
): string {
  const retry = retryAfterMs ? `retry: ${retryAfterMs}\n` : "";
  const eventId = id ? `id: ${id}\n` : "";
  return (
    eventId +
    retry +
    `event: ${event}\n` +
    `data: ${JSON.stringify(data)}\n\n`
  );
}

async function loadFriendIds(
  store: ReturnType<typeof makeData>,
  userId: string,
): Promise<Set<string>> {
  const relations: any[] = await store.listFriends(userId);
  const ids = new Set<string>();
  const addAll = (value: string | null | undefined, aliases?: any) => {
    if (value) ids.add(value);
    if (Array.isArray(aliases)) {
      for (const alias of aliases) {
        if (alias) ids.add(alias);
      }
    }
  };
  for (const rel of relations) {
    if (rel.requester_id === userId && rel.addressee_id) {
      addAll(rel.addressee_id, rel.addressee_aliases);
    } else if (rel.addressee_id === userId && rel.requester_id) {
      addAll(rel.requester_id, rel.requester_aliases);
    }
  }
  return ids;
}

type CursorState = {
  value: number;
};

type RealtimeContext = {
  store: ReturnType<typeof makeData>;
  userId: string;
  topics: ParsedTopics;
  friendIds: Set<string>;
  cursor: CursorState;
};

type EmitFn = (
  event: "post" | "notification",
  payload: any,
  cursorId: string,
  eventTimestamp: number,
) => void;

async function pollRealtime(ctx: RealtimeContext, emit: EmitFn) {
  const sinceDate = new Date(ctx.cursor.value - 1);

  if (ctx.topics.home || ctx.topics.userIds.size > 0) {
    const posts = await ctx.store.listGlobalPostsSince(ctx.userId, sinceDate, {
      authorIds: Array.from(ctx.topics.userIds),
      friendIds: Array.from(ctx.friendIds),
      limit: 100,
    });
    for (const post of posts) {
      const ts = toTimestamp(post.created_at) ?? Date.now();
      const postCursor = `${ts}:${post.id}`;
      const targets: string[] = [];
      if (
        ctx.topics.home &&
        (ctx.friendIds.has(post.author_id) || post.author_id === ctx.userId)
      ) {
        targets.push("home");
      }
      if (ctx.topics.userIds.has(post.author_id)) {
        targets.push(`user:${post.author_id}`);
      }
      if (targets.length === 0 && ctx.topics.home) {
        targets.push("home");
      }
      emit("post", { post, targets }, postCursor, ts);
      if (ts > ctx.cursor.value) {
        ctx.cursor.value = ts;
      }
    }
  }

  if (ctx.topics.notifications) {
    const notifications = await ctx.store.listNotificationsSince(
      ctx.userId,
      sinceDate,
    );
    const unread = notifications.length
      ? await ctx.store.countUnreadNotifications(ctx.userId)
      : null;
    for (const notification of notifications) {
      const ts = toTimestamp(notification.created_at) ?? Date.now();
      const notificationCursor = `${ts}:${notification.id}`;
      emit(
        "notification",
        {
          notification,
          unread_count: unread ?? undefined,
        },
        notificationCursor,
        ts,
      );
      if (ts > ctx.cursor.value) {
        ctx.cursor.value = ts;
      }
    }
  }
}

const realtime = new Hono<{ Bindings: Bindings; Variables: Variables }>();

realtime.get("/realtime/stream", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const url = new URL(c.req.url);
  const topics = parseTopics(url.searchParams.get("topics"));
  const initialCursor = getInitialCursor(url, c.req.header("last-event-id"));

  let friendIds: Set<string>;
  try {
    friendIds = await loadFriendIds(store, me.id);
  } catch (error) {
    console.error("failed to load friends for realtime", error);
    await releaseStore(store);
    const response = fail(c, "failed to start realtime stream", 500);
    response.headers.set("Retry-After", String(Math.ceil(DEFAULT_RETRY_AFTER_MS / 1000)));
    return response;
  }

  let cleanup: (() => void) | null = null;
  let flushPending: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const cursor: CursorState = { value: initialCursor };
      let polling = false;
      const pending: Uint8Array[] = [];
      let shouldCloseAfterFlush = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let interval: ReturnType<typeof setInterval> | null = null;

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (interval) clearInterval(interval);
        void releaseStore(store).catch((error) =>
          console.error("failed to release store in realtime stream", error),
        );
        try {
          controller.close();
        } catch {
          // ignore close errors
        }
      };

      const flush = () => {
        if (closed) return;
        while (pending.length > 0 && (controller.desiredSize ?? 1) > 0) {
          controller.enqueue(pending.shift()!);
        }
        if (pending.length === 0 && shouldCloseAfterFlush) {
          close();
        }
      };
      flushPending = flush;

      const enqueueChunk = (chunk: Uint8Array) => {
        if (closed) return;
        if (shouldCloseAfterFlush) return;
        pending.push(chunk);
        if (pending.length > SSE_MAX_PENDING_CHUNKS && !shouldCloseAfterFlush) {
          console.warn("realtime SSE queue overflow; sending backoff");
          const hint = createBackoffHint("sse_queue_overflow");
          pending.length = 0;
          pending.push(
            encoder.encode(
              formatSseMessage(
                "backoff",
                hint,
                undefined,
                hint.retry_after_ms,
              ),
            ),
          );
          shouldCloseAfterFlush = true;
        }
        flush();
      };

      const send = (event: string, data: any, id?: string) => {
        enqueueChunk(encoder.encode(formatSseMessage(event, data, id)));
      };

      const sendComment = (text: string) => {
        enqueueChunk(encoder.encode(`: ${text}\n\n`));
      };

      const sendBackoffError = (reason: string) => {
        if (closed || shouldCloseAfterFlush) return;
        const hint = createBackoffHint(reason);
        enqueueChunk(
          encoder.encode(
            formatSseMessage(
              "error",
              { message: reason, retry_after_ms: hint.retry_after_ms },
              undefined,
              hint.retry_after_ms,
            ),
          ),
        );
      };

      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          await pollRealtime(
            {
              store,
              userId: me.id,
              topics,
              friendIds,
              cursor,
            },
            (event, payload, cursorId) => {
              send(event, payload, cursorId);
            },
          );
        } catch (error) {
          console.error("realtime poll failed", error);
          sendBackoffError("poll_failed");
        } finally {
          polling = false;
        }
      };

      heartbeat = setInterval(() => {
        if (closed) return;
        sendComment(`ping ${Date.now()}`);
      }, KEEPALIVE_MS);

      interval = setInterval(() => {
        void poll();
      }, POLL_INTERVAL_MS);

      // Initial hello + immediate catch-up
      send("ready", {
        user_id: me.id,
        topics: {
          home: topics.home,
          notifications: topics.notifications,
          users: Array.from(topics.userIds),
        },
        cursor: cursor.value,
        interval_ms: POLL_INTERVAL_MS,
      });
      void poll();

      cleanup = close;

      const signal = c.req.raw.signal;
      if (signal?.aborted) {
        close();
      } else if (signal) {
        signal.addEventListener("abort", close);
      }
    },
    pull(_controller: ReadableStreamDefaultController<Uint8Array>) {
      if (flushPending) {
        flushPending();
      }
    },
    cancel() {
      if (cleanup) cleanup();
    },
  });

  const headers = new Headers();
  headers.set("Content-Type", "text/event-stream");
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("Connection", "keep-alive");
  headers.set("X-Accel-Buffering", "no");
  return new Response(stream, { headers });
});

realtime.get(
  "/ws",
  auth,
  upgradeWebSocket((c) => {
    const me = c.get("user") as any;
    const url = new URL(c.req.url);
    const topics = parseTopics(url.searchParams.get("topics"));
    const cursor: CursorState = { value: getInitialCursor(url) };
    let store: ReturnType<typeof makeData> | null = null;
    let friendIds: Set<string> | null = null;
    let polling = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    let backoffTriggered = false;

    const cleanup = async () => {
      if (closed) return;
      closed = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (store) {
        try {
          await releaseStore(store);
        } catch (error) {
          console.error("failed to release store in websocket", error);
        }
        store = null;
      }
    };

    const sendBackoffAndClose = async (
      ws: WSContext<WebSocket>,
      reason: string,
    ) => {
      if (closed) return;
      backoffTriggered = true;
      console.warn("realtime websocket backoff; closing connection", { reason });
      const hint = createBackoffHint(reason);
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ event: "backoff", data: hint }));
        } catch (error) {
          console.error("failed to send websocket backoff hint", error);
        }
        ws.close(1013, reason);
      }
      await cleanup();
    };

    const getBufferedAmount = (ws: WSContext<WebSocket>): number => {
      const direct = (ws as any).bufferedAmount;
      if (typeof direct === "number") return direct;
      const raw = (ws as any).raw as WebSocket | undefined;
      const rawBuffered = raw ? (raw as any).bufferedAmount : null;
      return typeof rawBuffered === "number" ? rawBuffered : 0;
    };

    const sendJson = (ws: WSContext<WebSocket>, message: any) => {
      if (closed || backoffTriggered || ws.readyState !== WebSocket.OPEN) return false;
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error("failed to send websocket realtime message", error);
        void sendBackoffAndClose(ws, "send_failed");
        return false;
      }
      if (getBufferedAmount(ws) > WS_MAX_BUFFERED_BYTES) {
        void sendBackoffAndClose(ws, "ws_queue_overflow");
        return false;
      }
      return true;
    };

    const poll = async (ws: WSContext<WebSocket>) => {
      if (polling || closed || backoffTriggered || !store || !friendIds) return;
      polling = true;
      try {
        await pollRealtime(
          {
            store,
            userId: me.id,
            topics,
            friendIds,
            cursor,
          },
          (event, payload, cursorId, ts) => {
            sendJson(ws, {
              event,
              data: payload,
              cursor: cursorId,
              ts,
            });
          },
        );
      } catch (error) {
        console.error("realtime websocket poll failed", error);
        sendJson(ws, {
          event: "error",
          data: { message: "poll_failed", retry_after_ms: DEFAULT_RETRY_AFTER_MS },
        });
      } finally {
        polling = false;
      }
    };

    return {
      async onOpen(_evt: Event, ws: WSContext<WebSocket>) {
        store = makeData(c.env as any, c);
        try {
          friendIds = await loadFriendIds(store, me.id);
        } catch (error) {
          console.error("failed to load friends for websocket", error);
          await sendBackoffAndClose(ws, "failed_to_start");
          return;
        }

        sendJson(ws, {
          event: "ready",
          data: {
            user_id: me.id,
            topics: {
              home: topics.home,
              notifications: topics.notifications,
              users: Array.from(topics.userIds),
            },
            cursor: cursor.value,
            interval_ms: POLL_INTERVAL_MS,
          },
          cursor: String(cursor.value),
          ts: cursor.value,
        });

        await poll(ws);
        timer = setInterval(() => {
          void poll(ws);
        }, POLL_INTERVAL_MS);
      },
      async onMessage(event: MessageEvent, ws: WSContext<WebSocket>) {
        if (typeof event.data !== "string") return;
        let parsed: any = null;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        if (parsed && parsed.type === "replay" && parsed.cursor) {
          const next = parseCursor(String(parsed.cursor));
          if (next) {
            cursor.value = next;
            await poll(ws);
          }
        }
      },
      async onClose() {
        await cleanup();
      },
      async onError() {
        await cleanup();
      },
    };
  }),
);

export default realtime;

export {
  DEFAULT_RETRY_AFTER_MS,
  createBackoffHint,
  formatSseMessage,
  getInitialCursor,
  parseCursor,
  parseTopics,
  pollRealtime,
};
