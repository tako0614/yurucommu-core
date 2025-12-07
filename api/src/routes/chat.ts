import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { auth } from "../middleware/auth";
import { createDMService, createCommunityService } from "../services";
import { getAppAuthContext } from "../lib/auth-context";

const chat = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const parsePagination = (url: URL, defaults = { limit: 50, offset: 0 }) => {
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") || `${defaults.limit}`, 10)),
  );
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || `${defaults.offset}`, 10));
  return { limit, offset };
};

const ensureAuth = (ctx: AppAuthContext): AppAuthContext => {
  if (!ctx.userId) throw new Error("unauthorized");
  return ctx;
};

const handleError = (c: any, error: unknown) => {
  const message = (error as Error)?.message || "unexpected error";
  if (message === "unauthorized") return fail(c, message, 401);
  return fail(c, message, 400);
};

chat.get("/dm/threads", auth, async (c) => {
  try {
    const dm = createDMService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url, { limit: 20, offset: 0 });
    const page = await dm.listThreads(authCtx, { limit, offset });
    return ok(c, page.threads);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.get("/dm/threads/:threadId/messages", auth, async (c) => {
  try {
    const dm = createDMService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const messages = await dm.listMessages(authCtx, {
      thread_id: c.req.param("threadId"),
      limit,
      offset,
    });
    return ok(c, messages.messages);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.get("/dm/with/:handle", auth, async (c) => {
  try {
    const dm = createDMService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const other = c.req.param("handle");
    const result = await dm.openThread(authCtx, { participants: [other] });
    return ok(c, result);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.post("/dm/send", auth, async (c) => {
  try {
    const dm = createDMService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const participants = Array.isArray(body.recipients)
      ? body.recipients
      : body.recipient
        ? [body.recipient]
        : [];
    const message = await dm.sendMessage(authCtx, {
      thread_id: body.thread_id,
      participants,
      content: String(body.content ?? "").trim(),
      media_ids: Array.isArray(body.media_ids) ? body.media_ids : undefined,
    });
    return ok(c, message, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.get("/communities/:id/channels/:channelId/messages", auth, async (c) => {
  try {
    const communities = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit } = parsePagination(url, { limit: 50, offset: 0 });
    const messages = await communities.listChannelMessages(authCtx, {
      community_id: c.req.param("id"),
      channel_id: c.req.param("channelId"),
      limit,
      offset: 0,
    });
    return ok(c, messages);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.post("/communities/:id/channels/:channelId/messages", auth, async (c) => {
  try {
    const communities = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const activity = await communities.sendChannelMessage(authCtx, {
      community_id: c.req.param("id"),
      channel_id: c.req.param("channelId"),
      content: String(body.content ?? "").trim(),
      recipients: Array.isArray(body.recipients) ? body.recipients : undefined,
      in_reply_to: body.in_reply_to || body.inReplyTo || null,
    });
    return ok(c, activity, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

export default chat;
