import { Hono } from "hono";
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
  const head = raw.split(":")[0];
  const numeric = Number(head);
  if (!Number.isNaN(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(head);
  return Number.isNaN(parsed) ? null : parsed;
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

const realtime = new Hono<{ Bindings: Bindings; Variables: Variables }>();

realtime.get("/realtime/stream", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const url = new URL(c.req.url);
  const topics = parseTopics(url.searchParams.get("topics"));
  const cursorInput =
    url.searchParams.get("since") ?? c.req.header("last-event-id") ?? "";
  const initialCursor =
    parseCursor(cursorInput) ?? Date.now() - DEFAULT_LOOKBACK_MS;

  let friendIds: Set<string>;
  try {
    friendIds = await loadFriendIds(store, me.id);
  } catch (error) {
    console.error("failed to load friends for realtime", error);
    await releaseStore(store);
    return fail(c, "failed to start realtime stream", 500);
  }

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let cursor = initialCursor;
      let polling = false;

      const send = (event: string, data: any, id?: string) => {
        const payload =
          (id ? `id: ${id}\n` : "") +
          `event: ${event}\n` +
          `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      const sendComment = (text: string) => {
        controller.enqueue(encoder.encode(`: ${text}\n\n`));
      };

      const updateCursor = (value: string | number | Date | null | undefined) => {
        if (!value) return;
        const ts =
          value instanceof Date ? value.getTime() : Number(new Date(value).getTime());
        if (!Number.isNaN(ts) && ts > cursor) {
          cursor = ts;
        }
      };

      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const sinceDate = new Date(cursor - 1);

          if (topics.home || topics.userIds.size > 0) {
            const posts = await store.listGlobalPostsSince(me.id, sinceDate, {
              authorIds: Array.from(topics.userIds),
              friendIds: Array.from(friendIds),
              limit: 100,
            });
            for (const post of posts) {
              const postCursor = `${new Date(post.created_at).getTime()}:${post.id}`;
              const targets: string[] = [];
              if (
                topics.home &&
                (friendIds.has(post.author_id) || post.author_id === me.id)
              ) {
                targets.push("home");
              }
              if (topics.userIds.has(post.author_id)) {
                targets.push(`user:${post.author_id}`);
              }
              if (targets.length === 0 && topics.home) {
                targets.push("home");
              }
              send("post", { post, targets }, postCursor);
              updateCursor(post.created_at);
            }
          }

          if (topics.notifications) {
            const notifications = await store.listNotificationsSince(
              me.id,
              sinceDate,
            );
            const unread = notifications.length
              ? await store.countUnreadNotifications(me.id)
              : null;
            for (const notification of notifications) {
              const notificationCursor = `${new Date(notification.created_at).getTime()}:${notification.id}`;
              send(
                "notification",
                {
                  notification,
                  unread_count: unread ?? undefined,
                },
                notificationCursor,
              );
              updateCursor(notification.created_at);
            }
          }
        } catch (error) {
          console.error("realtime poll failed", error);
          send("error", { message: "poll_failed" });
        } finally {
          polling = false;
        }
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        sendComment(`ping ${Date.now()}`);
      }, KEEPALIVE_MS);

      const interval = setInterval(() => {
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
        cursor,
        interval_ms: POLL_INTERVAL_MS,
      });
      void poll();

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(interval);
        void releaseStore(store).catch((error) =>
          console.error("failed to release store in realtime stream", error),
        );
        try {
          controller.close();
        } catch {
          // ignore close errors
        }
      };

      cleanup = close;

      const signal = c.req.raw.signal;
      if (signal?.aborted) {
        close();
      } else if (signal) {
        signal.addEventListener("abort", close);
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

export default realtime;
