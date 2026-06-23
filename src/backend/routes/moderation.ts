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
import { desc, eq, isNull } from "drizzle-orm";

import type { Env, Variables } from "../types.ts";
import {
  activityApId,
  generateId,
  isLocal,
  parseLimit,
  parseOffset,
} from "../federation-helpers.ts";
import {
  blockActor,
  blockDomain,
  unblockActor,
  unblockDomain,
} from "../lib/blocklist.ts";
import {
  purgeActorContent,
  purgeDomainContent,
} from "../lib/blocklist-purge.ts";
import {
  activities,
  blockedActors,
  blockedDomains,
  nowIso,
  reports,
} from "../../db/index.ts";
import { requireActor } from "./actors-helpers.ts";
import { getInstanceActor } from "./activitypub/query-helpers.ts";
import { enqueueDeliveryToActor } from "../lib/delivery/queue.ts";

const MAX_REPORT_REASON_LEN = 1000;

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
  // Defederation also purges the domain's already-ingested content so it stops
  // being served (the blocklist is otherwise ingest/delivery-only).
  await purgeDomainContent(c.get("db"), parsed.value, c.env.MEDIA);
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
  // Purge the blocked actor's already-ingested content so it stops being served.
  await purgeActorContent(c.get("db"), parsed.value, c.env.MEDIA);
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

/**
 * Mark a report handled (or reopen it).
 *
 * `POST /reports/:id/resolve` stamps `reports.resolvedAt = nowIso()` so the row
 * drops out of the `?status=open` queue. Sending `{ "reopen": true }` clears
 * `resolvedAt` instead, putting the report back on the open queue. Without this
 * route `resolvedAt` is never written, so `?status=open` would be dead and the
 * queue would grow forever.
 *
 * Owner-gated like every other moderation mutation; CSRF + rate-limit are
 * applied at the `/api/*` mount in index.ts.
 */
moderationRoutes.post("/reports/:id/resolve", async (c) => {
  const owner = requireOwner(c);
  if (owner instanceof Response) return owner;

  const id = c.req.param("id");
  if (typeof id !== "string" || id.trim().length === 0) {
    return c.json({ error: "id required" }, 400);
  }

  let reopen = false;
  try {
    const body = (await c.req.json()) as { reopen?: unknown };
    reopen = body?.reopen === true;
  } catch {
    // No body / invalid JSON => default resolve.
    reopen = false;
  }

  const db = c.get("db");
  const resolvedAt = reopen ? null : nowIso();
  const updated = await db
    .update(reports)
    .set({ resolvedAt })
    .where(eq(reports.id, id))
    .returning({ id: reports.id });

  if (updated.length === 0) {
    return c.json({ error: "Report not found" }, 404);
  }

  return c.json({ success: true, resolved_at: resolvedAt });
});

// ---------------------------------------------------------------------------
// Outbound reports (file an abuse Flag to a REMOTE actor's instance)
// ---------------------------------------------------------------------------

/**
 * `POST /reports/outbound` — file an AS2 `Flag` against a remote actor (and,
 * optionally, one of their posts) and federate it to their instance, so a
 * yurucommu owner can report abusive remote content the same way they can
 * triage inbound Flags. The Flag is sent FROM the instance actor (Mastodon's
 * convention — the individual reporter stays anonymous to the remote moderators)
 * and signed with the instance actor's key (the delivery worker resolves it).
 *
 * Owner-gated. Local targets are rejected: there is no remote instance to
 * notify — the owner should block/mute/defederate instead (stronger local
 * tools). The same CSRF + rate-limit apply at the `/api/*` mount.
 */
moderationRoutes.post("/reports/outbound", async (c) => {
  const owner = requireOwner(c);
  if (owner instanceof Response) return owner;

  const baseUrl = c.env.APP_URL;
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const targetActorApId =
    typeof body.target_actor_ap_id === "string"
      ? body.target_actor_ap_id.trim()
      : "";
  const postApId =
    typeof body.post_ap_id === "string" ? body.post_ap_id.trim() : "";
  const reason = readReason(body) ?? "";

  if (!targetActorApId) {
    return c.json({ error: "target_actor_ap_id required" }, 400);
  }
  if (isLocal(targetActorApId, baseUrl)) {
    return c.json(
      { error: "Cannot report a local actor; use block/mute instead" },
      400,
    );
  }
  if (reason.length > MAX_REPORT_REASON_LEN) {
    return c.json({ error: "reason too long" }, 400);
  }

  const db = c.get("db");
  const instance = await getInstanceActor(c);
  const flagId = activityApId(baseUrl, generateId());

  // AS2/Mastodon `Flag`: `object` lists the reported entity(ies) — the post (if
  // given) plus the actor, so the remote moderator can locate the content.
  const object = postApId ? [postApId, targetActorApId] : [targetActorApId];
  const flag = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: flagId,
    type: "Flag",
    actor: instance.apId,
    object,
    ...(reason ? { content: reason } : {}),
    to: [targetActorApId],
  };

  await db.insert(activities).values({
    apId: flagId,
    type: "Flag",
    actorApId: instance.apId,
    objectApId: targetActorApId,
    rawJson: JSON.stringify(flag),
    direction: "outbound",
  });

  // Async federation (no remote POST in the request path); the worker signs as
  // the instance actor and delivers to the reported actor's inbox.
  await enqueueDeliveryToActor(c.env, flagId, targetActorApId);

  return c.json({ success: true });
});

export default moderationRoutes;
