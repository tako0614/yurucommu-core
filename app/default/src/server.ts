import { Hono } from "hono";
import type { TakosApp, AppEnv } from "@takos/app-sdk/server";
import { json, error, parseBody, parseQuery } from "@takos/app-sdk/server";
import { canonicalizeParticipants, computeParticipantsHash } from "@takos/platform/activitypub/chat";

const router = new Hono<{ Bindings: AppEnv }>();

router.get("/health", (c) => c.text("ok"));

const parsePagination = (query: Record<string, string>, defaults = { limit: 20, offset: 0 }) => {
  const limit = Math.min(
    100,
    Math.max(1, parseInt(query.limit || `${defaults.limit}`, 10)),
  );
  const offset = Math.max(0, parseInt(query.offset || `${defaults.offset}`, 10));
  const cursor = query.cursor || undefined;
  return { limit, offset, cursor };
};

const toList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((v) => v?.toString?.() ?? "").filter(Boolean);
  if (typeof value === "string") return [value];
  if (value === null || value === undefined) return [];
  return [String(value)];
};

const participantsFromObject = (obj: any): string[] => {
  const declared = toList(obj["takos:participants"]);
  const all = [
    obj.actor,
    ...toList(obj.to),
    ...toList(obj.cc),
    ...toList(obj.bto),
    ...toList(obj.bcc),
    ...declared,
  ].filter(Boolean);
  return canonicalizeParticipants(all);
};

const threadFromObject = (obj: any): { participants: string[]; threadId: string } => {
  const participants = participantsFromObject(obj);
  const threadId = (obj.context as string | undefined) || computeParticipantsHash(participants);
  return { participants, threadId };
};

const filterMessagesForUser = (objectsInThread: any[], userId: string): any[] => {
  return objectsInThread.filter((obj) => {
    const participants = participantsFromObject(obj);
    if (!participants.includes(userId)) return false;
    const draft = Boolean(obj["takos:draft"] ?? obj.draft);
    if (draft && obj.actor !== userId) return false;
    const recipients = new Set([
      ...toList(obj.to),
      ...toList(obj.bto),
      ...toList(obj.bcc),
      obj.actor,
    ]);
    return recipients.has(userId) || obj.actor === userId;
  });
};

const toDmMessage = (obj: any) => {
  const { threadId } = threadFromObject(obj);
  return {
    id: obj.local_id ?? obj.id ?? "",
    thread_id: threadId,
    sender_actor_uri: obj.actor,
    content: obj.content ?? "",
    created_at: obj.published ?? new Date().toISOString(),
    media: (obj.attachment || []).map((att: any) => ({
      id: att.url,
      url: att.url,
      type: att.type || "Document",
    })),
    in_reply_to: obj.inReplyTo ?? obj.in_reply_to ?? null,
    draft: Boolean(obj["takos:draft"] ?? obj.draft ?? false),
  };
};

router.get("/timeline/home", async (c) => {
  const query = parseQuery(c.req.raw);
  const { limit, cursor } = parsePagination(query, { limit: 50, offset: 0 });
  const url = new URL("/objects/timeline", c.req.url);
  url.searchParams.set("types", "Note,Article,Question");
  url.searchParams.set("visibility", "public,unlisted,followers,community");
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await c.env.fetch(url.pathname + url.search);
  if (!res.ok) return error("Failed to load timeline", res.status);
  const page = await res.json<any>();
  return json(page);
});

// DM APIs implemented in App layer using /objects endpoints.
router.get("/dm/threads", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const query = parseQuery(c.req.raw);
  const { limit, offset } = parsePagination(query, { limit: 20, offset: 0 });
  const url = new URL("/objects", c.req.url);
  url.searchParams.set("visibility", "direct");
  url.searchParams.set("include_direct", "true");
  url.searchParams.set("participant", c.env.auth.userId);
  url.searchParams.set("limit", String(limit * 5));
  url.searchParams.set("cursor", "0");
  url.searchParams.set("order", "desc");
  const res = await c.env.fetch(url.pathname + url.search);
  if (!res.ok) return error("Failed to list threads", res.status);
  const page = await res.json<any>();
  const contexts = new Map<string, any>();
  for (const item of page.items || []) {
    const { threadId } = threadFromObject(item);
    if (!threadId) continue;
    const draft = Boolean(item["takos:draft"] ?? item.draft);
    if (draft && item.actor !== c.env.auth.userId) continue;
    const existing = contexts.get(threadId);
    if (!existing || (existing.published || "").localeCompare(item.published || "") < 0) {
      contexts.set(threadId, item);
    }
    if (contexts.size >= limit + offset) break;
  }
  const slice = Array.from(contexts.values())
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .slice(offset, offset + limit);
  const threads = [];
  for (const obj of slice) {
    const { threadId, participants } = threadFromObject(obj);
    const threadRes = await c.env.fetch(`/objects/thread/${encodeURIComponent(threadId)}`);
    const messages = threadRes.ok ? await threadRes.json<any[]>() : [];
    const visible = filterMessagesForUser(messages, c.env.auth.userId);
    const latest = visible[visible.length - 1] ?? null;
    threads.push({
      id: threadId,
      participants,
      created_at: (latest?.published as string) ?? obj.published ?? new Date().toISOString(),
      latest_message: latest ? toDmMessage(latest) : null,
    });
  }
  return json({ threads, next_offset: threads.length < limit ? null : offset + threads.length });
});

router.get("/dm/threads/:threadId/messages", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const query = parseQuery(c.req.raw);
  const { limit, offset } = parsePagination(query, { limit: 50, offset: 0 });
  const threadId = c.req.param("threadId");
  const res = await c.env.fetch(`/objects/thread/${encodeURIComponent(threadId)}`);
  if (!res.ok) return error("Thread not found", res.status);
  const messages = await res.json<any[]>();
  const filtered = filterMessagesForUser(messages, c.env.auth.userId);
  const sliced = filtered.slice(offset, offset + limit);
  return json({
    messages: sliced.map(toDmMessage),
    next_offset: sliced.length < limit ? null : offset + sliced.length,
  });
});

router.get("/dm/with/:handle", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const other = c.req.param("handle");
  const participants = canonicalizeParticipants([other, c.env.auth.userId].filter(Boolean));
  const threadId = computeParticipantsHash(participants);
  const res = await c.env.fetch(`/objects/thread/${encodeURIComponent(threadId)}`);
  const messages = res.ok ? await res.json<any[]>() : [];
  const visible = filterMessagesForUser(messages, c.env.auth.userId);
  return json({ threadId, messages: visible.map(toDmMessage) });
});

router.post("/dm/send", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const content = String(body.content ?? "").trim();
  if (!content) return error("content is required", 400);
  const participantsRaw = Array.isArray(body.recipients)
    ? body.recipients
    : body.recipient
      ? [body.recipient]
      : Array.isArray(body.participants)
        ? body.participants
        : [];
  const participants = canonicalizeParticipants([...participantsRaw, c.env.auth.userId].filter(Boolean));
  if (participants.length < 2) return error("At least one other participant is required", 400);
  const threadId = body.thread_id || computeParticipantsHash(participants);
  const recipients = body.draft ? [c.env.auth.userId] : participants.filter((p) => p !== c.env.auth.userId);
  const apObject = {
    type: "Note",
    content,
    visibility: "direct",
    to: recipients,
    cc: [],
    bto: [],
    bcc: [],
    inReplyTo: body.in_reply_to ?? body.inReplyTo ?? null,
    context: threadId,
    "takos:participants": participants,
    "takos:draft": Boolean(body.draft),
    attachment: Array.isArray(body.media_ids)
      ? body.media_ids.map((url: string) => ({ type: "Document", url }))
      : undefined,
  };
  const res = await c.env.fetch("/objects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apObject),
  });
  if (!res.ok) return error("Failed to send message", res.status);
  const created = await res.json<any>();
  return json(toDmMessage(created), { status: 201 });
});

router.post("/dm/threads/:threadId/read", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const threadId = c.req.param("threadId");
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  return json({ thread_id: threadId, message_id: body.message_id ?? body.messageId, read_at: new Date().toISOString() });
});

router.delete("/dm/messages/:messageId", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const messageId = c.req.param("messageId");
  const existingRes = await c.env.fetch(`/objects/${encodeURIComponent(messageId)}`);
  if (!existingRes.ok) return error("Message not found", 404);
  const existing = await existingRes.json<any>();
  if (existing.actor !== c.env.auth.userId) return error("Only the sender can delete this message", 403);
  const res = await c.env.fetch(`/objects/${encodeURIComponent(messageId)}`, { method: "DELETE" });
  if (!res.ok) return error("Failed to delete message", res.status);
  return json({ deleted: true });
});

// Story APIs implemented in App layer using /objects endpoints.
router.post("/stories", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  const visibleToFriends = body.visible_to_friends === undefined ? true : !!body.visible_to_friends;
  const apObject = {
    type: "Note",
    content: "",
    visibility: visibleToFriends ? "followers" : "public",
    context: body.community_id ?? null,
    "takos:story": {
      items,
      expiresAt: body.expires_at ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  };
  const res = await c.env.fetch("/objects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apObject),
  });
  if (!res.ok) return error("Failed to create story", res.status);
  const created = await res.json<any>();
  return json(created, { status: 201 });
});

router.post("/communities/:id/stories", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  body.community_id = c.req.param("id");
  return router.fetch(new Request(new URL("/api/stories", c.req.url).toString(), { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), c.env);
});

router.get("/stories", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const query = parseQuery(c.req.raw);
  const { limit, cursor } = parsePagination(query, { limit: 20, offset: 0 });
  const url = new URL("/objects/timeline", c.req.url);
  url.searchParams.set("type", "Note");
  url.searchParams.set("visibility", "public,followers,community");
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  if (query.community_id) url.searchParams.set("community_id", query.community_id);
  const res = await c.env.fetch(url.pathname + url.search);
  if (!res.ok) return error("Failed to list stories", res.status);
  const page = await res.json<any>();
  const stories = (page.items || []).filter((o: any) => !!o["takos:story"]);
  return json({ stories, next_cursor: page.nextCursor ?? null });
});

router.get("/communities/:id/stories", async (c) => {
  const url = new URL(c.req.url);
  url.searchParams.set("community_id", c.req.param("id"));
  return router.fetch(new Request(url.toString(), { method: "GET" }), c.env);
});

router.get("/stories/:id", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const res = await c.env.fetch(`/objects/${encodeURIComponent(id)}`);
  if (!res.ok) return error("story not found", 404);
  const obj = await res.json<any>();
  if (!obj["takos:story"]) return error("story not found", 404);
  return json(obj);
});

const app: TakosApp = {
  fetch: router.fetch,
};

export default app;

export { PostCard, type Post } from "./components/PostCard.js";
export {
  HomeScreen,
  ProfileScreen,
  ProfileEditScreen,
  NotificationsScreen,
  SettingsScreen,
  OnboardingScreen,
} from "./screens/index.js";
