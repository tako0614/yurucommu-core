import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail, HttpError } from "@takos/platform/server";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { auth } from "../middleware/auth";
import { getAppAuthContext } from "../lib/auth-context";
import { ensureDmSendAllowed, isEndpointDisabled } from "../lib/dm-guard";
import { buildTakosAppEnv, loadStoredAppManifest, loadTakosApp } from "../lib/app-sdk-loader";
import { ErrorCodes } from "../lib/error-codes";

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
  if (!ctx.userId) throw new HttpError(401, ErrorCodes.UNAUTHORIZED, "Authentication required");
  return ctx;
};

const handleError = (_c: any, error: unknown): never => {
  if (error instanceof HttpError) throw error;
  throw error;
};

const readJson = async (res: Response): Promise<any> => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const proxyRequestToDefaultApp = async (c: any, req: Request): Promise<Response> => {
  const appId = "default";
  const app = await loadTakosApp(appId, c.env);
  const manifest = await loadStoredAppManifest(c.env, appId);
  const appEnv = buildTakosAppEnv(c, appId, manifest);
  return await app.fetch(req, appEnv);
};

const proxyToDefaultApp = async (
  c: any,
  pathname: string,
  search: string = "",
): Promise<Response> => {
  const url = new URL(c.req.url);
  url.pathname = pathname;
  url.search = search;
  const req = new Request(url.toString(), c.req.raw);
  return await proxyRequestToDefaultApp(c, req);
};

const proxyJsonToDefaultApp = async (
  c: any,
  pathname: string,
  payload: unknown,
  search: string = "",
): Promise<Response> => {
  const url = new URL(c.req.url);
  url.pathname = pathname;
  url.search = search;
  const headers = new Headers(c.req.raw.headers);
  headers.set("content-type", "application/json");
  const req = new Request(url.toString(), {
    method: c.req.method,
    headers,
    body: JSON.stringify(payload ?? {}),
  });
  return await proxyRequestToDefaultApp(c, req);
};

const dmApiDisabled = (c: any): boolean => {
  const config = (c.get("takosConfig") as any) ?? (c.env as any).takosConfig;
  const path = new URL(c.req.url).pathname;
  return isEndpointDisabled(config, path);
};

chat.get("/dm/threads", auth, async (c) => {
  try {
    if (dmApiDisabled(c)) return fail(c, "Not Found", 404);
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url, { limit: 20, offset: 0 });
    const proxyUrl = new URL(url.toString());
    proxyUrl.searchParams.set("limit", String(limit));
    proxyUrl.searchParams.set("offset", String(offset));
    const res = await proxyToDefaultApp(c, "/dm/threads", proxyUrl.search);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to list threads", res.status);
    return ok(c, json?.threads ?? []);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.get("/dm/threads/:threadId/messages", auth, async (c) => {
  try {
    if (dmApiDisabled(c)) return fail(c, "Not Found", 404);
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const proxyUrl = new URL(url.toString());
    proxyUrl.searchParams.set("limit", String(limit));
    proxyUrl.searchParams.set("offset", String(offset));
    const res = await proxyToDefaultApp(
      c,
      `/dm/threads/${encodeURIComponent(c.req.param("threadId"))}/messages`,
      proxyUrl.search,
    );
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Thread not found", 404, { code: ErrorCodes.THREAD_NOT_FOUND, details: { threadId: c.req.param("threadId") } });
      }
      return fail(c, json?.error ?? "Failed to list messages", res.status);
    }
    return ok(c, json?.messages ?? []);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.get("/dm/with/:handle", auth, async (c) => {
  try {
    if (dmApiDisabled(c)) return fail(c, "Not Found", 404);
    const res = await proxyToDefaultApp(c, `/dm/with/${encodeURIComponent(c.req.param("handle"))}`);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to open thread", res.status);
    return ok(c, json);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.post("/dm/send", auth, async (c) => {
  try {
    if (dmApiDisabled(c)) return fail(c, "Not Found", 404);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const mediaIds = Array.isArray(body.media_ids) ? body.media_ids : undefined;
    const limitCheck = await ensureDmSendAllowed(c.env, authCtx, { mediaKeys: mediaIds });
    if (!limitCheck.ok) {
      return fail(c, limitCheck.message, limitCheck.status, {
        code: limitCheck.code,
        details: limitCheck.details,
      });
    }
    const participants = Array.isArray(body.recipients)
      ? body.recipients
      : body.recipient
        ? [body.recipient]
        : [];
    const payload = {
      thread_id: body.thread_id,
      content: String(body.content ?? "").trim(),
      media_ids: mediaIds,
      in_reply_to: body.in_reply_to ?? body.inReplyTo ?? undefined,
      draft: body.draft === true,
      recipients: participants,
    };
    const res = await proxyJsonToDefaultApp(c, "/dm/send", payload);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to send message", res.status);
    return ok(c, json, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.post("/dm/threads/:threadId/reply", auth, async (c) => {
  try {
    if (dmApiDisabled(c)) return fail(c, "Not Found", 404);
    const body = (await c.req.json().catch(() => ({}))) as any;
    const payload = {
      thread_id: c.req.param("threadId"),
      content: String(body.content ?? "").trim(),
      media_ids: Array.isArray(body.media_ids) ? body.media_ids : undefined,
      in_reply_to: body.in_reply_to ?? body.inReplyTo ?? undefined,
    };
    const res = await proxyJsonToDefaultApp(c, "/dm/send", payload);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to send message", res.status);
    return ok(c, json, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.post("/dm/threads/:threadId/draft", auth, async (c) => {
  try {
    if (dmApiDisabled(c)) return fail(c, "Not Found", 404);
    const body = (await c.req.json().catch(() => ({}))) as any;
    const payload = {
      thread_id: c.req.param("threadId"),
      content: String(body.content ?? "").trim(),
      media_ids: Array.isArray(body.media_ids) ? body.media_ids : undefined,
      in_reply_to: body.in_reply_to ?? body.inReplyTo ?? undefined,
      draft: true,
    };
    const res = await proxyJsonToDefaultApp(c, "/dm/send", payload);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to save draft", res.status);
    return ok(c, json, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.post("/dm/threads/:threadId/read", auth, async (c) => {
  try {
    if (dmApiDisabled(c)) return fail(c, "Not Found", 404);
    const body = (await c.req.json().catch(() => ({}))) as any;
    const payload = { message_id: body.message_id ?? body.messageId ?? undefined };
    const res = await proxyJsonToDefaultApp(
      c,
      `/dm/threads/${encodeURIComponent(c.req.param("threadId"))}/read`,
      payload,
    );
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to mark read", res.status);
    return ok(c, json);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.delete("/dm/messages/:messageId", auth, async (c) => {
  try {
    if (dmApiDisabled(c)) return fail(c, "Not Found", 404);
    const res = await proxyToDefaultApp(c, `/dm/messages/${encodeURIComponent(c.req.param("messageId"))}`);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to delete message", res.status);
    return ok(c, json ?? { deleted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

chat.get("/communities/:id/channels/:channelId/messages", auth, async (c) => {
  try {
    const url = new URL(c.req.url);
    const { limit } = parsePagination(url, { limit: 50, offset: 0 });
    ensureAuth(getAppAuthContext(c));
    const proxyUrl = new URL(url.toString());
    proxyUrl.searchParams.set("limit", String(limit));
    const res = await proxyToDefaultApp(
      c,
      `/communities/${encodeURIComponent(c.req.param("id"))}/channels/${encodeURIComponent(c.req.param("channelId"))}/messages`,
      proxyUrl.search,
    );
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to list messages", res.status);
    return ok(c, json ?? []);
  } catch (error) {
    return handleError(c, error);
  }
});

chat.post("/communities/:id/channels/:channelId/messages", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const res = await proxyToDefaultApp(
      c,
      `/communities/${encodeURIComponent(c.req.param("id"))}/channels/${encodeURIComponent(c.req.param("channelId"))}/messages`,
    );
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to send message", res.status);
    return ok(c, json, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

export default chat;
