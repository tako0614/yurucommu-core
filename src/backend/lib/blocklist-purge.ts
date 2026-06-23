import { eq, inArray, like, or } from "drizzle-orm";
import { activities, objects } from "../../db/index.ts";
import type { Database } from "../../db/index.ts";
import type { IObjectStorage } from "../runtime/types.ts";
import { chunkForInClause } from "./chunk.ts";
import { normalizeDomain } from "./blocklist.ts";
import {
  deleteObjectCascade,
  purgeMediaBlobs,
} from "../routes/posts/delete-cascade.ts";
import { logger } from "./logger.ts";

const log = logger.child({ component: "blocklist" });

// Hard-delete a set of objects (with their child cascade + R2 blobs). Shared by
// the actor / domain purge below. apIds are EXACTLY the objects to remove.
async function purgeObjects(
  db: Database,
  apIds: string[],
  media?: IObjectStorage,
): Promise<void> {
  if (apIds.length === 0) return;
  const mediaKeys: string[] = [];
  for (const apId of apIds) {
    mediaKeys.push(...(await deleteObjectCascade(db, apId, media)));
  }
  for (const chunk of chunkForInClause(apIds)) {
    await db.delete(objects).where(inArray(objects.apId, chunk));
  }
  await purgeMediaBlobs(media, mediaKeys);
}

/**
 * Purge a blocked REMOTE actor's already-ingested content. The operator
 * blocklist is otherwise ingest/delivery-only, so without this a defederated
 * actor's prior posts/replies/stories stay live in timelines, search, and
 * object serving — contradicting the operator's "they're gone" expectation.
 * Removes the actor's authored objects (cascade) + their activity ledger rows.
 * Best-effort; never throws into the operator's response path.
 */
export async function purgeActorContent(
  db: Database,
  blockedApId: string,
  media?: IObjectStorage,
): Promise<void> {
  try {
    const rows = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.attributedTo, blockedApId));
    await purgeObjects(
      db,
      rows.map((r) => r.apId),
      media,
    );
    await db.delete(activities).where(eq(activities.actorApId, blockedApId));
  } catch (err) {
    log.warn("blocklist.purgeActorContent failed", {
      event: "blocklist.purge_actor_failed",
      actor: blockedApId,
      error: err,
    });
  }
}

/**
 * Purge already-ingested content authored by any actor on a blocked DOMAIN (the
 * host itself OR a subdomain). Host-anchored LIKE so `evil.com` matches
 * `https://evil.com/...` and `https://node1.evil.com/...` but NOT `notevil.com`.
 * Best-effort. Local content is never matched (local objects carry the local
 * host; the operator never blocks their own domain).
 */
export async function purgeDomainContent(
  db: Database,
  domainOrUrl: string,
  media?: IObjectStorage,
): Promise<void> {
  const domain = normalizeDomain(domainOrUrl);
  if (!domain) return;
  try {
    const hostMatch = or(
      like(objects.attributedTo, `https://${domain}/%`),
      like(objects.attributedTo, `https://%.${domain}/%`),
    );
    const rows = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(hostMatch);
    await purgeObjects(
      db,
      rows.map((r) => r.apId),
      media,
    );
    await db
      .delete(activities)
      .where(
        or(
          like(activities.actorApId, `https://${domain}/%`),
          like(activities.actorApId, `https://%.${domain}/%`),
        ),
      );
  } catch (err) {
    log.warn("blocklist.purgeDomainContent failed", {
      event: "blocklist.purge_domain_failed",
      domain,
      error: err,
    });
  }
}
