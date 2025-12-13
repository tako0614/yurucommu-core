import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import type {
  CreateObjectInput,
  UpdateObjectInput,
  ObjectQueryParams,
  ObjectTimelineParams,
} from "@takos/platform/app/services/object-service";
import { auth } from "../middleware/auth";
import { getAppAuthContext } from "../lib/auth-context";
import { createObjectService } from "../services";

const objects = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const ensureAuth = (ctx: AppAuthContext): AppAuthContext => {
  if (!ctx.userId) {
    throw new Error("unauthorized");
  }
  return ctx;
};

const parseBool = (value: string | null): boolean | undefined => {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  return undefined;
};

const parseTypes = (raw: string | null): string | string[] | undefined => {
  if (!raw) return undefined;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  return parts.length === 1 ? parts[0] : parts;
};

const parseActors = (raw: string | null): string | string[] | undefined => {
  if (!raw) return undefined;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  return parts.length === 1 ? parts[0] : parts;
};

const parseVisibilityList = (raw: string | null): string[] | undefined => {
  if (!raw) return undefined;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
};

const parseLimitCursor = (url: URL, defaults = { limit: 20 }): { limit: number; cursor?: string } => {
  const limit = Math.min(
    200,
    Math.max(1, parseInt(url.searchParams.get("limit") || `${defaults.limit}`, 10)),
  );
  const cursor = url.searchParams.get("cursor") || undefined;
  return { limit, cursor };
};

const buildQueryParams = (url: URL): ObjectQueryParams => {
  const { limit, cursor } = parseLimitCursor(url);
  const type = parseTypes(url.searchParams.get("type") || url.searchParams.get("types"));
  const actor = parseActors(url.searchParams.get("actor") || url.searchParams.get("actors"));
  const visibilityRaw = url.searchParams.get("visibility");
  const visibility = visibilityRaw ? (visibilityRaw as any) : undefined;
  const params: ObjectQueryParams = {
    type,
    actor,
    context: url.searchParams.get("context") || undefined,
    visibility,
    inReplyTo: url.searchParams.get("in_reply_to") || url.searchParams.get("inReplyTo") || undefined,
    since: url.searchParams.get("since") || undefined,
    until: url.searchParams.get("until") || undefined,
    limit,
    cursor,
    includeDeleted: parseBool(url.searchParams.get("include_deleted")) ?? undefined,
    includeDirect: parseBool(url.searchParams.get("include_direct")) ?? undefined,
    participant: url.searchParams.get("participant") || undefined,
    order: (url.searchParams.get("order") as any) || undefined,
    isLocal: parseBool(url.searchParams.get("is_local")) ?? undefined,
  };
  return params;
};

const buildTimelineParams = (url: URL): ObjectTimelineParams => {
  const { limit, cursor } = parseLimitCursor(url);
  const type = parseTypes(url.searchParams.get("type") || url.searchParams.get("types"));
  const visibility = parseVisibilityList(url.searchParams.get("visibility")) as any;
  const actor = parseActors(url.searchParams.get("actor") || url.searchParams.get("actors"));
  return {
    type,
    visibility,
    limit,
    cursor,
    actor,
    communityId: url.searchParams.get("community_id") || url.searchParams.get("communityId") || undefined,
    listId: url.searchParams.get("list_id") || url.searchParams.get("listId") || undefined,
    onlyMedia: parseBool(url.searchParams.get("only_media")) ?? undefined,
    includeDirect: parseBool(url.searchParams.get("include_direct")) ?? undefined,
  };
};

const handleError = (c: any, error: unknown) => {
  const message = (error as Error)?.message || "unexpected error";
  if (message === "unauthorized") return fail(c, message, 401);
  return fail(c, message, 400);
};

const registerRoutes = (basePath: "" | "/-/api") => {
  objects.get(`${basePath}/objects/timeline`, auth, async (c) => {
    try {
      const service = createObjectService(c.env);
      const authCtx = ensureAuth(getAppAuthContext(c));
      const url = new URL(c.req.url);
      const page = await service.getTimeline(authCtx, buildTimelineParams(url));
      return ok(c, page);
    } catch (error) {
      return handleError(c, error);
    }
  });

  objects.get(`${basePath}/objects/thread/:contextId`, auth, async (c) => {
    try {
      const service = createObjectService(c.env);
      const authCtx = ensureAuth(getAppAuthContext(c));
      const items = await service.getThread(authCtx, c.req.param("contextId"));
      return ok(c, items);
    } catch (error) {
      return handleError(c, error);
    }
  });

  objects.get(`${basePath}/objects`, auth, async (c) => {
    try {
      const service = createObjectService(c.env);
      const authCtx = ensureAuth(getAppAuthContext(c));
      const url = new URL(c.req.url);
      const page = await service.query(authCtx, buildQueryParams(url));
      return ok(c, page);
    } catch (error) {
      return handleError(c, error);
    }
  });

  objects.get(`${basePath}/objects/:id`, auth, async (c) => {
    try {
      const service = createObjectService(c.env);
      const authCtx = ensureAuth(getAppAuthContext(c));
      const obj = await service.get(authCtx, c.req.param("id"));
      if (!obj) {
        return fail(c, "object not found", 404, {
          code: "OBJECT_NOT_FOUND",
          details: { id: c.req.param("id") },
        });
      }
      return ok(c, obj);
    } catch (error) {
      return handleError(c, error);
    }
  });

  objects.post(`${basePath}/objects`, auth, async (c) => {
    try {
      const service = createObjectService(c.env);
      const authCtx = ensureAuth(getAppAuthContext(c));
      const body = (await c.req.json().catch(() => ({}))) as CreateObjectInput;
      const created = await service.create(authCtx, body);
      return ok(c, created, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  objects.patch(`${basePath}/objects/:id`, auth, async (c) => {
    try {
      const service = createObjectService(c.env);
      const authCtx = ensureAuth(getAppAuthContext(c));
      const body = (await c.req.json().catch(() => ({}))) as UpdateObjectInput;
      const updated = await service.update(authCtx, c.req.param("id"), body);
      return ok(c, updated);
    } catch (error) {
      return handleError(c, error);
    }
  });

  objects.delete(`${basePath}/objects/:id`, auth, async (c) => {
    try {
      const service = createObjectService(c.env);
      const authCtx = ensureAuth(getAppAuthContext(c));
      await service.delete(authCtx, c.req.param("id"));
      return ok(c, { deleted: true });
    } catch (error) {
      return handleError(c, error);
    }
  });
};

registerRoutes("");
registerRoutes("/-/api");

export default objects;
