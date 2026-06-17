/**
 * Operator moderation routes.
 *
 * Exposes the federation blocklist (blocked domains / actors) and the inbound
 * abuse-report queue to the INSTANCE OWNER only. Without these endpoints the
 * blocklist helpers in `lib/blocklist.ts` have no callers, so an operator has
 * no way to defederate a misbehaving domain or actor.
 *
 * Authorization: every route requires a logged-in actor whose `role` is
 * `"owner"` (the single-operator account, assigned to the first actor created
 * on the instance — see auth-helpers.ts). Arbitrary logged-in users are
 * rejected with 403 so moderation is never exposed to members.
 *
 * Mounted at `/api/moderation` by the index.ts wiring cluster.
 */

import { Hono } from "hono";
import { desc, isNull } from "drizzle-orm";

import type { Env, Variables } from "../types.ts";
import { parseLimit, parseOffset } from "../federation-helpers.ts";
import {
  blockActor,
  blockDomain,
  unblockActor,
  unblockDomain,
} from "../lib/blocklist.ts";
import { blockedActors, blockedDomains, reports } from "../../db/index.ts";
import { requireActor } from "./actors-helpers.ts";

export const moderationRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

/**
 * Require the current actor AND that it is the instance owner. Returns the
 * actor on success, or a 401/403 Response that the caller should return.
 */
function requireOwner(c: Parameters<typeof requireActor>[0]) {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  if (result.role !== "owner") {
    return c.json({ error: "Forbidden" }, 403);
  }
  return result;
}

async function readApIdBody(
  c: Parameters<typeof requireActor>[0],
  field: "domain" | "ap_id",
): Promise<{ value: string } | { error: Response }> {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return { error: c.json({ error: "Invalid JSON body" }, 400) };
  }
  const raw = body[field];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { error: c.json({ error: `${field} required` }, 400) };
  }
  return { value: raw.trim() };
}

function readReason(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const reason = (body as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

// ---------------------------------------------------------------------------
// Blocked domains
// ---------------------------------------------------------------------------

moderationRoutes.get("/domains", async (c) => {
  const owner = requireOwner(c);
  if (owner instanceof Response) return owner;

  const db = c.get("db");
  const limit = parseLimit(c.req.query("limit"), 100, 500);
  const offset = parseOffset(c.req.query("offset"), 0, 10000);

  const rows = await db
    .select()
    .from(blockedDomains)
    .orderBy(desc(blockedDomains.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    domains: rows.map((r) => ({
      domain: r.domain,
      reason: r.reason,
      created_at: r.createdAt,
    })),
  });
});

moderationRoutes.post("/domains", async (c) => {
  const owner = requireOwner(c);
  if (owner instanceof Response) return owner;

  const parsed = await readApIdBody(c, "domain");
  if ("error" in parsed) return parsed.error;

  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }

  try {
    await blockDomain(c.get("db"), parsed.value, readReason(body));
  } catch {
    return c.json({ error: "Invalid domain" }, 400);
  }
  return c.json({ success: true });
});

moderationRoutes.delete("/domains", async (c) => {
  const owner = requireOwner(c);
  if (owner instanceof Response) return owner;

  const parsed = await readApIdBody(c, "domain");
  if ("error" in parsed) return parsed.error;

  try {
    await unblockDomain(c.get("db"), parsed.value);
  } catch {
    return c.json({ error: "Invalid domain" }, 400);
  }
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Blocked actors
// ---------------------------------------------------------------------------

moderationRoutes.get("/actors", async (c) => {
  const owner = requireOwner(c);
  if (owner instanceof Response) return owner;

  const db = c.get("db");
  const limit = parseLimit(c.req.query("limit"), 100, 500);
  const offset = parseOffset(c.req.query("offset"), 0, 10000);

  const rows = await db
    .select()
    .from(blockedActors)
    .orderBy(desc(blockedActors.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    actors: rows.map((r) => ({
      actor_ap_id: r.actorApId,
      reason: r.reason,
      created_at: r.createdAt,
    })),
  });
});

moderationRoutes.post("/actors", async (c) => {
  const owner = requireOwner(c);
  if (owner instanceof Response) return owner;

  const parsed = await readApIdBody(c, "ap_id");
  if ("error" in parsed) return parsed.error;

  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }

  try {
    await blockActor(c.get("db"), parsed.value, readReason(body));
  } catch {
    return c.json({ error: "Invalid actor" }, 400);
  }
  return c.json({ success: true });
});

moderationRoutes.delete("/actors", async (c) => {
  const owner = requireOwner(c);
  if (owner instanceof Response) return owner;

  const parsed = await readApIdBody(c, "ap_id");
  if ("error" in parsed) return parsed.error;

  await unblockActor(c.get("db"), parsed.value);
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Reports (inbound Flag queue)
// ---------------------------------------------------------------------------

moderationRoutes.get("/reports", async (c) => {
  const owner = requireOwner(c);
  if (owner instanceof Response) return owner;

  const db = c.get("db");
  const limit = parseLimit(c.req.query("limit"), 100, 500);
  const offset = parseOffset(c.req.query("offset"), 0, 10000);
  // `?status=open` filters to unresolved reports; default returns all.
  const onlyOpen = c.req.query("status") === "open";

  const base = db.select().from(reports);
  const filtered = onlyOpen ? base.where(isNull(reports.resolvedAt)) : base;

  const rows = await filtered
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    reports: rows.map((r) => ({
      id: r.id,
      reporter_ap_id: r.reporterApId,
      target_ap_id: r.targetApId,
      content: r.content,
      instance: r.instance,
      created_at: r.createdAt,
      resolved_at: r.resolvedAt,
    })),
  });
});

export default moderationRoutes;
