// Shared helpers for DM conversations

import type { Context } from "hono";
import { and, eq, inArray, isNotNull, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import {
  actorCache,
  actors,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { safeJsonParse } from "../../federation-helpers.ts";
import { chunkForInClause } from "../../lib/chunk.ts";

/**
 * Build a safe LIKE condition that matches the JSON-quoted token for an AP-ID
 * inside the recipient `toJson` array (e.g. `"https://host/ap/users/alice"`).
 *
 * The AP-ID can be an attacker-influenceable remote URL, so the LIKE pattern
 * MUST escape the `%` / `_` wildcards (and the escape char itself) — otherwise
 * those characters would act as wildcards and broaden or break the match. We
 * anchor on the JSON-stringified token (surrounding double quotes act as
 * delimiters) so a recipient ID that is a textual prefix of another cannot
 * cross-match. This is a substring scan of a JSON array column and is used only
 * to enumerate which conversations involve an actor; message-content access is
 * authorized separately by exact conversation + recipient checks.
 */
export function recipientToJsonLike(apId: string): SQL {
  // JSON.stringify yields a quoted token whose surrounding quotes delimit the
  // value, so a recipient ID that is a textual prefix of another cannot
  // cross-match. Match with instr() (a LITERAL substring search) — NOT
  // `LIKE '%...%'`: the AP-ID is caller-supplied and often long (a remote
  // `https://host/users/name` quoted token easily exceeds D1's LIKE
  // pattern-complexity limit, SQLITE_ERROR 7500 at ~50 chars). instr() has no
  // wildcards (so no escaping needed) and no length limit, and is exact
  // (AP-IDs are matched case-sensitively, as they must be).
  const token = JSON.stringify(apId);
  return sql`instr(${objects.toJson}, ${token}) > 0`;
}

/**
 * Indexed lookup of the object AP-IDs a given actor was addressed on as a DM
 * recipient.
 *
 * DM writes (dm/messages.ts, takos-tools/dm.ts, inbox-content-handlers.ts)
 * record every recipient in the `object_recipients` link table with
 * `type = 'to'` and `recipient_ap_id = <recipient>`, backed by the
 * `object_recipients_recipient_created_idx` index. Selecting object AP-IDs from
 * that table on an equality of `recipient_ap_id` is index-served, whereas the
 * equivalent `to_json LIKE '%"<apId>"%'` substring scan over the `objects`
 * table cannot use an index and degrades to a full-table scan.
 *
 * Returned as a Drizzle subquery so callers can use it inside `inArray(
 * objects.apId, ...)` — the same recipient-membership semantics as
 * {@link recipientToJsonLike} (the `to` audience contains the actor) without
 * the scan.
 */
export function recipientObjectIds(db: Database, recipientApId: string) {
  return db
    .select({ objectApId: objectRecipients.objectApId })
    .from(objectRecipients)
    .where(
      and(
        eq(objectRecipients.recipientApId, recipientApId),
        eq(objectRecipients.type, "to"),
      ),
    );
}

export type HonoEnv = { Bindings: Env; Variables: Variables };

export {
  type ActorInfo,
  formatActorSummary as formatActorProfile,
  loadActorInfoMap as buildActorInfoMap,
} from "../actors-helpers.ts";

export const ACTOR_INFO_FIELDS = {
  apId: actors.apId,
  preferredUsername: actors.preferredUsername,
  name: actors.name,
  iconUrl: actors.iconUrl,
} as const;

export const ACTOR_CACHE_INFO_FIELDS = {
  apId: actorCache.apId,
  preferredUsername: actorCache.preferredUsername,
  name: actorCache.name,
  iconUrl: actorCache.iconUrl,
} as const;

/** Extract the other participant's AP ID from a DM object. */
export function getOtherParticipant(
  obj: { attributedTo: string; toJson: string },
  actorApId: string,
): string {
  if (obj.attributedTo === actorApId) {
    return safeJsonParse<string[]>(obj.toJson, [])[0] || "";
  }
  return obj.attributedTo;
}

/**
 * Drizzle where clause for DM objects involving a given actor (author OR
 * recipient).
 *
 * Recipient membership is resolved through the indexed `object_recipients`
 * link via {@link recipientObjectIds} (`inArray(objects.apId, ...)`) instead of
 * an unindexable `to_json LIKE '%"<apId>"%'` substring scan. The semantics are
 * identical — a DM where the actor authored it (`attributed_to`) or was a `to`
 * recipient — but the query is index-served. `db` is required to build the
 * recipient subquery.
 */
export function dmWhereForActor(db: Database, actorApId: string) {
  return and(
    eq(objects.visibility, "direct"),
    eq(objects.type, "Note"),
    isNotNull(objects.conversation),
    or(
      eq(objects.attributedTo, actorApId),
      inArray(objects.apId, recipientObjectIds(db, actorApId)),
    ),
  );
}

/** Sort comparator: descending by time string, with fallback. */
export function byTimeDesc(a: string | null, b: string | null): number {
  return (b || "").localeCompare(a || "");
}

/** Decode and validate the :encodedApId route param. Returns null on failure after sending 400. */
export function parseOtherApId(c: Context<HonoEnv>): string | null {
  const raw = c.req.param("encodedApId");
  if (!raw) {
    c.status(400);
    return null;
  }
  const apId = decodeURIComponent(raw);
  if (!apId) {
    c.status(400);
    return null;
  }
  return apId;
}

type DmObject = {
  conversation: string | null;
  attributedTo: string;
  toJson: string;
  published: string;
  content?: string | null;
};

/**
 * Group DM objects by conversation, keeping only the first (most recent) per conversation.
 * `filterFn` controls which conversations to include.
 */
export function groupConversations(
  dmObjects: DmObject[],
  actorApId: string,
  filterFn: (conversationId: string) => boolean,
): Map<
  string,
  {
    conversation: string;
    otherApId: string;
    lastMessageAt: string;
    lastContent: string | null;
    lastSender: string;
  }
> {
  const map = new Map<
    string,
    {
      conversation: string;
      otherApId: string;
      lastMessageAt: string;
      lastContent: string | null;
      lastSender: string;
    }
  >();

  for (const obj of dmObjects) {
    if (
      !obj.conversation ||
      !filterFn(obj.conversation) ||
      map.has(obj.conversation)
    )
      continue;

    const otherApId = getOtherParticipant(obj, actorApId);
    if (!otherApId) continue;

    map.set(obj.conversation, {
      conversation: obj.conversation,
      otherApId,
      lastMessageAt: obj.published,
      lastContent: obj.content ?? null,
      lastSender: obj.attributedTo,
    });
  }

  return map;
}

/** Find the set of conversation IDs where the actor has sent at least one message. */
export async function findRepliedConversations(
  db: Database,
  conversationIds: string[],
  actorApId: string,
): Promise<Set<string | null>> {
  if (conversationIds.length === 0) return new Set();

  // Chunk the IN(...) lookup: the caller passes every conversation in the
  // contact list (up to 2000) and D1 caps a query at 100 bound parameters.
  // Chunks are disjoint id slices, so unioning the replied-conversation sets is
  // collision-free.
  const result = new Set<string | null>();
  for (const ids of chunkForInClause(conversationIds)) {
    const replies = await db
      .selectDistinct({
        conversation: objects.conversation,
      })
      .from(objects)
      .where(
        and(
          inArray(objects.conversation, ids),
          eq(objects.attributedTo, actorApId),
        ),
      );
    for (const r of replies) result.add(r.conversation);
  }
  return result;
}

/** Collect unique values from a map's entries via accessor function. */
export function uniqueValues<V>(
  map: Map<string, V>,
  accessor: (v: V) => string,
): string[] {
  return [...new Set(Array.from(map.values()).map(accessor))];
}
