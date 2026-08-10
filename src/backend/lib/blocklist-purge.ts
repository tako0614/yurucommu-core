import { and, asc, gt, inArray, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { activities, objects } from "../../db/index.ts";
import type { Database } from "../../db/index.ts";
import type { IObjectStorage } from "../runtime/types.ts";
import { chunkForInClause, D1_IN_CHUNK } from "./chunk.ts";
import { normalizeDomain } from "./blocklist.ts";
import { isSameActivityPubActor } from "./activitypub-actor-identity.ts";
import {
  deleteObjectsCascade,
  purgeMediaBlobs,
} from "../routes/posts/delete-cascade.ts";
import { logger } from "./logger.ts";

const log = logger.child({ component: "blocklist" });

// Actor identity equivalence cannot use a simple indexed equality lookup: the
// accepted cosmetic spellings include host case, default ports, fragments,
// and one trailing slash. Scan retained identity columns in fixed-size pages
// instead of re-materializing the whole table once per delete chunk.
const ACTOR_IDENTITY_SCAN_PAGE = 512;

export interface BlocklistContentPurgeResult {
  complete: boolean;
  deletedObjects: number;
  deletedActivities: number;
}

/**
 * Match an HTTPS ActivityPub URL by its exact hostname or a real subdomain.
 *
 * Do not replace this with LIKE. Cloudflare D1 rejects sufficiently long LIKE
 * patterns as too complex, which previously made a valid long domain block
 * retain all historical content. Extracting the authority with literal
 * instr/substr operations also keeps domain text in the URL path, lookalike
 * suffixes, and credentials outside the match. Parse the authority down to its
 * hostname so an explicit HTTPS port and a DNS root dot have the same meaning
 * as the block decision path.
 */
function activityPubUrlHostMatchesDomain(
  column: SQLiteColumn,
  domain: string,
): SQL {
  const lowerUrl = sql`lower(${column})`;
  const authorityTail = sql`substr(${lowerUrl}, 9)`;
  const slash = sql`instr(${authorityTail}, '/')`;
  const authority = sql`substr(${authorityTail}, 1, ${slash} - 1)`;
  const closingBracket = sql`instr(${authority}, ']')`;
  const hostWithRootDot = sql`
    CASE
      WHEN substr(${authority}, 1, 1) = '[' AND ${closingBracket} > 1
        THEN substr(${authority}, 1, ${closingBracket})
      WHEN instr(${authority}, ':') > 0
        THEN substr(${authority}, 1, instr(${authority}, ':') - 1)
      ELSE ${authority}
    END
  `;
  const host = sql`
    CASE
      WHEN substr(${hostWithRootDot}, -1) = '.'
        THEN substr(${hostWithRootDot}, 1, length(${hostWithRootDot}) - 1)
      ELSE ${hostWithRootDot}
    END
  `;
  const subdomainSuffix = `.${domain}`;

  return sql`
    substr(${lowerUrl}, 1, 8) = 'https://'
    AND ${slash} > 1
    AND instr(${authority}, '@') = 0
    AND (
      ${host} = ${domain}
      OR substr(${host}, -length(${subdomainSuffix})) = ${subdomainSuffix}
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
 * Delete a predicate's objects in bounded, retryable units.
 *
 * Selecting every matching id before the first delete made a large domain
 * block consume memory in direct proportion to retained history. Keeping each
 * unit at D1_IN_CHUNK also means a failed statement leaves at most one page
 * incomplete; retrying the idempotent operator block resumes from the rows that
 * remain instead of rebuilding an unbounded in-memory id set. A stable AP-ID
 * keyset prevents unmatched history before the current page from being scanned
 * again after each successful delete.
 */
async function purgeMatchingObjects(
  db: Database,
  where: SQL,
  media?: IObjectStorage,
  onPageDeleted?: (count: number) => void,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const rows = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(
        cursor === undefined ? where : and(where, gt(objects.apId, cursor)),
      )
      .orderBy(asc(objects.apId))
      .limit(D1_IN_CHUNK);
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]!.apId;
    await purgeObjects(
      db,
      rows.map((row) => row.apId),
      media,
    );
    onPageDeleted?.(rows.length);
  }
}

async function purgeMatchingActivities(
  db: Database,
  where: SQL,
  onPageDeleted?: (count: number) => void,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const rows = await db
      .select({ apId: activities.apId })
      .from(activities)
      .where(
        cursor === undefined ? where : and(where, gt(activities.apId, cursor)),
      )
      .orderBy(asc(activities.apId))
      .limit(D1_IN_CHUNK);
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]!.apId;
    await db.delete(activities).where(
      inArray(
        activities.apId,
        rows.map((row) => row.apId),
      ),
    );
    onPageDeleted?.(rows.length);
  }
}

/**
 * Scan retained objects once by stable AP-ID and remove matching actor rows in
 * D1-sized units. The operator block is active before this cleanup starts, so
 * the scan does not have to restart from the beginning after every delete.
 */
async function purgeActorObjects(
  db: Database,
  blockedApId: string,
  media?: IObjectStorage,
  onPageDeleted?: (count: number) => void,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const rows = await db
      .select({ apId: objects.apId, attributedTo: objects.attributedTo })
      .from(objects)
      .where(cursor === undefined ? undefined : gt(objects.apId, cursor))
      .orderBy(asc(objects.apId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE);
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]!.apId;

    const targetApIds = rows
      .filter((row) => isSameActivityPubActor(row.attributedTo, blockedApId))
      .map((row) => row.apId);
    for (const chunk of chunkForInClause(targetApIds)) {
      await purgeObjects(db, chunk, media);
      onPageDeleted?.(chunk.length);
    }
  }
}

async function purgeActorActivities(
  db: Database,
  blockedApId: string,
  onPageDeleted?: (count: number) => void,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const rows = await db
      .select({ apId: activities.apId, actorApId: activities.actorApId })
      .from(activities)
      .where(cursor === undefined ? undefined : gt(activities.apId, cursor))
      .orderBy(asc(activities.apId))
      .limit(ACTOR_IDENTITY_SCAN_PAGE);
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1]!.apId;

    const targetApIds = rows
      .filter((row) => isSameActivityPubActor(row.actorApId, blockedApId))
      .map((row) => row.apId);
    for (const chunk of chunkForInClause(targetApIds)) {
      await db.delete(activities).where(inArray(activities.apId, chunk));
      onPageDeleted?.(chunk.length);
    }
  }
}

/**
 * Purge a blocked REMOTE actor's already-ingested content. The operator
 * blocklist is otherwise ingest/delivery-only, so without this a defederated
 * actor's prior posts/replies/stories stay live in timelines, search, and
 * object serving — contradicting the operator's "they're gone" expectation.
 * Removes the actor's authored objects (cascade) + their activity ledger rows.
 * Failures are logged and returned to the operator route. The block mutation
 * remains active, while a non-success response makes retry converge cleanup.
 */
export async function purgeActorContent(
  db: Database,
  blockedApId: string,
  media?: IObjectStorage,
): Promise<BlocklistContentPurgeResult> {
  let deletedObjects = 0;
  let deletedActivities = 0;
  try {
    await purgeActorObjects(db, blockedApId, media, (count) => {
      deletedObjects += count;
    });
    await purgeActorActivities(db, blockedApId, (count) => {
      deletedActivities += count;
    });
    return { complete: true, deletedObjects, deletedActivities };
  } catch (err) {
    log.warn("blocklist.purgeActorContent failed", {
      event: "blocklist.purge_actor_failed",
      actor: blockedApId,
      error: err,
    });
    return { complete: false, deletedObjects, deletedActivities };
  }
}

/**
 * Purge already-ingested content authored by any actor on a blocked DOMAIN (the
 * host itself OR a subdomain). Host-boundary matching means `evil.com` matches
 * `https://evil.com/...` and `https://node1.evil.com/...` but NOT `notevil.com`.
 * Failures are logged and returned to the operator route so its response can
 * require a retry. Local content is never matched (local objects carry the
 * local host; the operator never blocks their own domain).
 */
export async function purgeDomainContent(
  db: Database,
  domainOrUrl: string,
  media?: IObjectStorage,
): Promise<BlocklistContentPurgeResult> {
  const domain = normalizeDomain(domainOrUrl);
  if (!domain) {
    return { complete: true, deletedObjects: 0, deletedActivities: 0 };
  }
  let deletedObjects = 0;
  let deletedActivities = 0;
  try {
    await purgeMatchingObjects(
      db,
      activityPubUrlHostMatchesDomain(objects.attributedTo, domain),
      media,
      (count) => {
        deletedObjects += count;
      },
    );
    await purgeMatchingActivities(
      db,
      activityPubUrlHostMatchesDomain(activities.actorApId, domain),
      (count) => {
        deletedActivities += count;
      },
    );
    return { complete: true, deletedObjects, deletedActivities };
  } catch (err) {
    log.warn("blocklist.purgeDomainContent failed", {
      event: "blocklist.purge_domain_failed",
      domain,
      error: err,
    });
    return { complete: false, deletedObjects, deletedActivities };
  }
}
