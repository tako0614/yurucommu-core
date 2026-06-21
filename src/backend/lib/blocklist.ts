/**
 * Federation moderation blocklist.
 *
 * Backed by two tables (`blocked_domains` and `blocked_actors`) populated by
 * operators. Inbox content handlers consult both helpers at activity ingest
 * so that blocked traffic is silently discarded (200/202 ACK, not 4xx) — a
 * 4xx would cause sender instances to retry on a backoff, wasting their
 * delivery budget and ours.
 *
 * The helpers return `false` when the underlying read fails so that a
 * transient database error never causes federation traffic to be black-holed.
 * Each call site logs the failure so that the operator can investigate.
 */

import { eq, inArray } from "drizzle-orm";

import type { Database } from "../../db/index.ts";
import { blockedActors, blockedDomains } from "../../db/index.ts";
import { logger } from "./logger.ts";

const log = logger.child({ component: "blocklist" });

/**
 * Normalise an actor AP-ID hostname for blocklist lookups: lowercase and
 * strip any trailing dot (DNS root form). Returns `null` when the input
 * cannot be parsed.
 */
export function normalizeDomain(input: string): string | null {
  try {
    // Allow callers to pass either a bare hostname or a full URL.
    const candidate = input.includes("://") ? new URL(input).hostname : input;
    const trimmed = candidate.trim().replace(/\.$/, "").toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Returns `true` when the operator has blocked the given hostname. Accepts
 * both bare hostnames (`example.org`) and full actor URLs.
 */
export async function isDomainBlocked(
  db: Database,
  hostnameOrUrl: string,
): Promise<boolean> {
  const domain = normalizeDomain(hostnameOrUrl);
  if (!domain) return false;

  try {
    const row = await db.query.blockedDomains.findFirst({
      where: eq(blockedDomains.domain, domain),
      columns: { domain: true },
    });
    return !!row;
  } catch (err) {
    log.warn("blocklist.isDomainBlocked failed", {
      event: "blocklist.domain_lookup_failed",
      domain,
      error: err,
    });
    return false;
  }
}

/**
 * Returns `true` when the operator has blocked the given actor AP-ID, or
 * (transitively) when the actor's hostname is blocked.
 */
export async function isActorBlocked(
  db: Database,
  actorApId: string,
): Promise<boolean> {
  if (typeof actorApId !== "string" || actorApId.length === 0) {
    return false;
  }

  try {
    const row = await db.query.blockedActors.findFirst({
      where: eq(blockedActors.actorApId, actorApId),
      columns: { actorApId: true },
    });
    if (row) return true;
  } catch (err) {
    log.warn("blocklist.isActorBlocked failed", {
      event: "blocklist.actor_lookup_failed",
      actor: actorApId,
      error: err,
    });
    return false;
  }

  const domain = normalizeDomain(actorApId);
  if (!domain) return false;
  return await isDomainBlocked(db, domain);
}

/**
 * Batched blocklist filter for a list of recipient actor AP-IDs: returns the
 * SUBSET that is blocked (by actor OR transitively by hostname) using exactly
 * two queries (blocked_actors + blocked_domains) instead of two-per-recipient.
 * Replaces an O(recipients) serial `isActorBlocked` loop on the delivery
 * fan-out hot path. Fail-open like the singular helpers: a read error yields an
 * empty blocked set so a transient DB error never black-holes federation.
 */
export async function filterBlockedActorApIds(
  db: Database,
  actorApIds: string[],
): Promise<Set<string>> {
  const blocked = new Set<string>();
  const uniqueIds = [...new Set(actorApIds.filter((id) => id.length > 0))];
  if (uniqueIds.length === 0) return blocked;

  try {
    const blockedActorRows = await db
      .select({ actorApId: blockedActors.actorApId })
      .from(blockedActors)
      .where(inArray(blockedActors.actorApId, uniqueIds));
    const blockedActorSet = new Set(blockedActorRows.map((r) => r.actorApId));

    const idToDomain = new Map<string, string | null>();
    const domains = new Set<string>();
    for (const id of uniqueIds) {
      const d = normalizeDomain(id);
      idToDomain.set(id, d);
      if (d) domains.add(d);
    }

    const blockedDomainSet = new Set<string>();
    if (domains.size > 0) {
      const blockedDomainRows = await db
        .select({ domain: blockedDomains.domain })
        .from(blockedDomains)
        .where(inArray(blockedDomains.domain, [...domains]));
      for (const r of blockedDomainRows) blockedDomainSet.add(r.domain);
    }

    for (const id of uniqueIds) {
      const d = idToDomain.get(id);
      if (blockedActorSet.has(id) || (d && blockedDomainSet.has(d))) {
        blocked.add(id);
      }
    }
  } catch (err) {
    log.warn("blocklist.filterBlockedActorApIds failed", {
      event: "blocklist.batch_lookup_failed",
      error: err,
    });
    return new Set(); // fail-open
  }
  return blocked;
}

/**
 * Insert (or update) a domain blocklist entry. Idempotent: re-blocking the
 * same domain refreshes the recorded reason but keeps the original
 * `created_at`.
 */
export async function blockDomain(
  db: Database,
  hostnameOrUrl: string,
  reason: string | null,
): Promise<void> {
  const domain = normalizeDomain(hostnameOrUrl);
  if (!domain) {
    throw new Error(`blocklist.blockDomain: invalid input "${hostnameOrUrl}"`);
  }

  await db
    .insert(blockedDomains)
    .values({ domain, reason })
    .onConflictDoUpdate({
      target: blockedDomains.domain,
      set: { reason },
    });
}

/**
 * Remove a domain from the blocklist. No-op when the domain was not blocked.
 */
export async function unblockDomain(
  db: Database,
  hostnameOrUrl: string,
): Promise<void> {
  const domain = normalizeDomain(hostnameOrUrl);
  if (!domain) {
    throw new Error(
      `blocklist.unblockDomain: invalid input "${hostnameOrUrl}"`,
    );
  }
  await db.delete(blockedDomains).where(eq(blockedDomains.domain, domain));
}

/**
 * Insert (or update) an actor blocklist entry. Idempotent.
 */
export async function blockActor(
  db: Database,
  actorApId: string,
  reason: string | null,
): Promise<void> {
  if (typeof actorApId !== "string" || actorApId.length === 0) {
    throw new Error("blocklist.blockActor: actorApId is required");
  }
  await db
    .insert(blockedActors)
    .values({ actorApId, reason })
    .onConflictDoUpdate({
      target: blockedActors.actorApId,
      set: { reason },
    });
}

/**
 * Remove an actor from the blocklist. No-op when the actor was not blocked.
 */
export async function unblockActor(
  db: Database,
  actorApId: string,
): Promise<void> {
  if (typeof actorApId !== "string" || actorApId.length === 0) return;
  await db.delete(blockedActors).where(eq(blockedActors.actorApId, actorApId));
}
