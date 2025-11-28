// Chat-related routes (DM and channel messages)

import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { makeData } from "../data";
import {
  ok,
  fail,
  HttpError,
  releaseStore,
  requireInstanceDomain,
  getActorUri,
  webfingerLookup,
  getOrFetchActor,
} from "@takos/platform/server";
import {
  sendDirectMessage,
  sendChannelMessage,
  getDmThreadMessages,
  getChannelMessages,
  computeParticipantsHash,
  canonicalizeParticipants,
} from "@takos/platform/server";
import { auth } from "../middleware/auth";

const chat = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper: check community membership
async function requireMember(
  store: ReturnType<typeof makeData>,
  communityId: string,
  userId: string,
  env: any,
): Promise<boolean> {
  const localMember = await store.hasMembership(communityId, userId);
  if (localMember) return true;

  const instanceDomain = requireInstanceDomain(env as any);
  const actorUri = getActorUri(userId, instanceDomain);
  const follower = await store.findApFollower?.(`group:${communityId}`, actorUri).catch(() => null);
  return follower?.status === "accepted";
}

function makeInternalFetcher(env: Record<string, unknown>) {
  const rawRoot = typeof (env as any).ROOT_DOMAIN === "string" ? (env as any).ROOT_DOMAIN.trim() : "";
  const rootDomain = rawRoot ? rawRoot.toLowerCase() : "";
  const binding = (env as any).ACCOUNT_BACKEND;

  if (!rootDomain || !binding?.fetch) {
    return null;
  }

  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const urlStr = input instanceof Request ? input.url : input.toString();
      const url = new URL(urlStr);
      if (url.hostname.toLowerCase().endsWith(`.${rootDomain}`)) {
        return binding.fetch(input, init);
      }
    } catch {
      // Fall through
    }
    return fetch(input, init);
  };
}

async function resolveRecipientActorUris(
  env: Record<string, unknown>,
  rawRecipients: string[],
): Promise<string[]> {
  const instanceDomain = requireInstanceDomain(env as any);
  const internalFetcher = makeInternalFetcher(env) ?? fetch;
  const actorUris: string[] = [];

  for (const raw of rawRecipients) {
    const normalized = String(raw || "").trim();
    if (!normalized) continue;

    if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
      actorUris.push(normalized);
      continue;
    }

    const withoutPrefix = normalized.replace(/^@+/, "");
    const parts = withoutPrefix.split("@");

    if (parts.length >= 2) {
      const handle = (parts.shift() || "").trim();
      const domain = parts.join("@").trim().toLowerCase();
      if (!handle || !domain) continue;
      const account = `${handle}@${domain}`;
      const actorUri = await webfingerLookup(account, internalFetcher).catch(() => null);
      if (!actorUri) continue;
      const actor = await getOrFetchActor(actorUri, env as any, false, internalFetcher).catch(() => null);
      actorUris.push((actor as any)?.id || actorUri);
      continue;
    }

    actorUris.push(getActorUri(withoutPrefix.toLowerCase(), instanceDomain));
  }

  return Array.from(new Set(actorUris));
}

async function getOrCreateDmThread(
  store: ReturnType<typeof makeData>,
  participants: string[],
  limit: number,
) {
  const normalized = canonicalizeParticipants(participants);
  const hash = computeParticipantsHash(normalized);
  const thread = await store.upsertDmThread(hash, JSON.stringify(normalized));
  const messages = await store.listDmMessages(thread.id, limit);
  return { threadId: thread.id, messages };
}

// GET /dm/threads - List all DM threads for the authenticated user
chat.get("/dm/threads", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const instanceDomain = requireInstanceDomain(c.env);
    const userActorUri = getActorUri(user.handle || user.id, instanceDomain);

    // Get all threads where user is a participant
    const allThreads = await store.listAllDmThreads?.();
    if (!allThreads) {
      return ok(c, []);
    }

    const userThreads = allThreads.filter((thread: any) => {
      try {
        const participants = JSON.parse(thread.participants_json || "[]");
        return participants.includes(userActorUri);
      } catch {
        return false;
      }
    });

    // Enrich with latest message
    const enriched = await Promise.all(
      userThreads.map(async (thread: any) => {
        const messages = await store.listDmMessages(thread.id, 1);
        return {
          id: thread.id,
          participants: JSON.parse(thread.participants_json || "[]"),
          created_at: thread.created_at,
          latest_message: messages[0] || null,
        };
      })
    );

    return ok(c, enriched);
  } catch (error: unknown) {
    console.error("list dm threads failed", error);
    return fail(c, "failed to list dm threads", 500);
  } finally {
    await releaseStore(store);
  }
});

// GET /dm/threads/:threadId/messages - Get messages in a DM thread
chat.get("/dm/threads/:threadId/messages", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const threadId = c.req.param("threadId");
    const limit = parseInt(c.req.query("limit") || "50", 10);

    // Verify user is participant in this thread
    const thread = await store.getDmThread?.(threadId);
    if (!thread) {
      return fail(c, "thread not found", 404);
    }

    const instanceDomain = requireInstanceDomain(c.env);
    const userActorUri = getActorUri(user.handle || user.id, instanceDomain);
    const participants = JSON.parse(thread.participants_json || "[]");

    if (!participants.includes(userActorUri)) {
      return fail(c, "forbidden", 403);
    }

    const messages = await getDmThreadMessages(c.env, threadId, limit);
    return ok(c, messages);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("get dm messages failed", error);
    return fail(c, "failed to get messages", 500);
  } finally {
    await releaseStore(store);
  }
});

// GET /dm/with/:handle - Get or create DM thread with specific user
chat.get("/dm/with/:handle", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const otherHandle = c.req.param("handle");
    const limit = parseInt(c.req.query("limit") || "50", 10);

    const handleLower = (otherHandle || "").toLowerCase();
    const otherUser = await store.getUser(handleLower).catch(() => null);
    if (otherUser) {
      const blocked = await store.isBlocked?.(user.id, otherUser.id).catch(() => false);
      const blocking = await store.isBlocked?.(otherUser.id, user.id).catch(() => false);
      if (blocked || blocking) {
        return fail(c, "forbidden", 403);
      }
    }

    const instanceDomain = requireInstanceDomain(c.env);
    const senderActorUri = getActorUri(user.handle || user.id, instanceDomain);
    const recipientActors = await resolveRecipientActorUris(c.env as any, [handleLower]);
    const targetActor = recipientActors[0];
    if (!targetActor) {
      return fail(c, "user not found", 404);
    }

    const participants = canonicalizeParticipants([senderActorUri, targetActor]);
    const { threadId, messages } = await getOrCreateDmThread(store, participants, limit);

    return ok(c, { threadId, messages });
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("get dm thread by handle failed", error);
    return fail(c, "failed to get dm thread", 500);
  } finally {
    await releaseStore(store);
  }
});

// POST /dm/send - Send a direct message
chat.post("/dm/send", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const body = (await c.req.json().catch(() => ({}))) as any;

    const recipients = Array.isArray(body.recipients)
      ? body.recipients
      : body.recipient
      ? [body.recipient]
      : [];

    if (recipients.length === 0) {
      throw new HttpError(400, "recipients required");
    }

    const content = String(body.content || "").trim();
    if (!content) {
      throw new HttpError(400, "content required");
    }

    const recipientHandles = recipients
      .map((r: any) => String(r || "").replace(/^@/, "").toLowerCase())
      .filter((r: string) => r && !r.startsWith("http") && !r.includes("/"));
    for (const handle of recipientHandles) {
      const recipient = await store.getUser(handle).catch(() => null);
      if (recipient) {
        const blocked = await store.isBlocked?.(user.id, recipient.id).catch(() => false);
        const blocking = await store.isBlocked?.(recipient.id, user.id).catch(() => false);
        if (blocked || blocking) {
          throw new HttpError(403, "forbidden");
        }
      }
    }

    const actorRecipients = await resolveRecipientActorUris(c.env as any, recipients);
    if (!actorRecipients.length) {
      throw new HttpError(404, "recipients not found");
    }

    const inReplyTo = body.in_reply_to || body.inReplyTo || undefined;

    const { threadId, activity } = await sendDirectMessage(
      c.env,
      user.handle || user.id,
      actorRecipients,
      content,
      inReplyTo,
    );

    return ok(c, { threadId, activity }, 201);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("send dm failed", error);
    return fail(c, "failed to send message", 500);
  } finally {
    await releaseStore(store);
  }
});

// GET /communities/:id/channels/:channelId/messages - Get channel messages
chat.get("/communities/:id/channels/:channelId/messages", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const communityId = c.req.param("id");
    const channelId = c.req.param("channelId");
    const limit = parseInt(c.req.query("limit") || "50", 10);

    // Verify community exists
    const community = await store.getCommunity(communityId);
    if (!community) {
      return fail(c, "community not found", 404);
    }

    // Verify user is member
    if (!(await requireMember(store, communityId, user.id, c.env))) {
      return fail(c, "forbidden", 403);
    }

    // Verify channel exists
    const channel = await store.getChannel?.(communityId, channelId);
    if (!channel) {
      return fail(c, "channel not found", 404);
    }

    const messages = await getChannelMessages(c.env, communityId, channelId, limit);
    return ok(c, messages);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("get channel messages failed", error);
    return fail(c, "failed to get messages", 500);
  } finally {
    await releaseStore(store);
  }
});

// POST /communities/:id/channels/:channelId/messages - Send channel message
chat.post("/communities/:id/channels/:channelId/messages", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const communityId = c.req.param("id");
    const channelId = c.req.param("channelId");
    const body = (await c.req.json().catch(() => ({}))) as any;

    // Verify community exists
    const community = await store.getCommunity(communityId);
    if (!community) {
      throw new HttpError(404, "community not found");
    }

    // Verify user is member
    if (!(await requireMember(store, communityId, user.id, c.env))) {
      throw new HttpError(403, "forbidden");
    }

    // Verify channel exists
    const channel = await store.getChannel?.(communityId, channelId);
    if (!channel) {
      throw new HttpError(404, "channel not found");
    }

    const content = String(body.content || "").trim();
    if (!content) {
      throw new HttpError(400, "content required");
    }

    const recipients = Array.isArray(body.recipients) ? body.recipients : [];
    const inReplyTo = body.in_reply_to || body.inReplyTo || undefined;

    const { activity } = await sendChannelMessage(
      c.env,
      user.handle || user.id,
      communityId,
      channelId,
      recipients,
      content,
      inReplyTo,
    );

    return ok(c, { activity }, 201);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("send channel message failed", error);
    return fail(c, "failed to send message", 500);
  } finally {
    await releaseStore(store);
  }
});

export default chat;
