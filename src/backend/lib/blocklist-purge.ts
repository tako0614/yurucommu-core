import { inArray, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { activities, objects } from "../../db/index.ts";
import type { Database } from "../../db/index.ts";
import type { IObjectStorage } from "../runtime/types.ts";
import { chunkForInClause } from "./chunk.ts";
import { normalizeDomain } from "./blocklist.ts";
import { activityPubActorIdentityMatchesSql } from "./activitypub-actor-identity-sql.ts";
import {
  deleteObjectsCascade,
  purgeMediaBlobs,
} from "../routes/posts/delete-cascade.ts";
import { logger } from "./logger.ts";

const log = logger.child({ component: "blocklist" });

/**
 * Match an HTTPS ActivityPub URL by its exact hostname or a real subdomain.
 *
 * Do not replace this with LIKE. Cloudflare D1 rejects sufficiently long LIKE
 * patterns as too complex, which previously made a valid long domain block
 * retain all historical content. Extracting the authority with literal
 * instr/substr operations also keeps domain text in the URL path, lookalike
 * suffixes, credentials, and explicit ports outside the match — the same URL
 * boundary the former host-anchored patterns intended to enforce.
 */
function activityPubUrlHostMatchesDomain(
  column: SQLiteColumn,
  domain: string,
): SQL {
  const lowerUrl = sql`lower(${column})`;
  const authorityTail = sql`substr(${lowerUrl}, 9)`;
  const slash = sql`instr(${authorityTail}, '/')`;
  const authority = sql`substr(${authorityTail}, 1, ${slash} - 1)`;
  const subdomainSuffix = `.${domain}`;

  return sql`
    substr(${lowerUrl}, 1, 8) = 'https://'
    AND ${slash} > 1
    AND instr(${authority}, '@') = 0
    AND (
      ${authority} = ${domain}
      OR substr(${authority}, -length(${subdomainSuffix})) = ${subdomainSuffix}
    )
  `;
}

// Hard-delete a set of objects (with their child cascade + R2 blobs). Shared by
// the actor / domain purge below. apIds are EXACTLY the objects to remove.
async function purgeObjects(
  db: Database,
  apIds: string[],
  media?: IObjectStorage,
): Promise<void> {
  if (apIds.length === 0) return;
  const mediaKeys = await deleteObjectsCascade(db, apIds, media);
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
    const retainedObjectAuthors = activityPubActorIdentityMatchesSql(
      sql`SELECT ${objects.attributedTo} FROM ${objects}`,
      blockedApId,
    );
    const rows = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(sql`${objects.attributedTo} IN (${retainedObjectAuthors})`);
    await purgeObjects(
      db,
      rows.map((r) => r.apId),
      media,
    );
    const retainedActivityActors = activityPubActorIdentityMatchesSql(
      sql`SELECT ${activities.actorApId} FROM ${activities}`,
      blockedApId,
    );
    await db
      .delete(activities)
      .where(sql`${activities.actorApId} IN (${retainedActivityActors})`);
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
 * host itself OR a subdomain). Host-boundary matching means `evil.com` matches
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
    const rows = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(activityPubUrlHostMatchesDomain(objects.attributedTo, domain));
    await purgeObjects(
      db,
      rows.map((r) => r.apId),
      media,
    );
    await db
      .delete(activities)
      .where(activityPubUrlHostMatchesDomain(activities.actorApId, domain));
  } catch (err) {
    log.warn("blocklist.purgeDomainContent failed", {
      event: "blocklist.purge_domain_failed",
      domain,
      error: err,
    });
  }
}
