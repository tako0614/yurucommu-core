// Shared helpers for DM conversations

import type { Context } from "hono";
import { and, eq, inArray, isNotNull, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import { actorCache, actors, objects } from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { safeJsonParse } from "../../federation-helpers.ts";

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
  // value; escaping the LIKE metacharacters keeps the wildcard semantics from
  // leaking out of the caller-supplied AP-ID.
  const token = JSON.stringify(apId)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  return sql`${objects.toJson} LIKE ${"%" + token + "%"} ESCAPE '\\'`;
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
 * Drizzle where clause for DM objects involving a given actor.
 *
 * `actorApIdJson` is accepted for backwards compatibility but the recipient
 * match is now built from `actorApId` via {@link recipientToJsonLike} so LIKE
 * metacharacters in the AP-ID are escaped.
 */
export function dmWhereForActor(actorApId: string, _actorApIdJson?: string) {
  return and(
    eq(objects.visibility, "direct"),
    eq(objects.type, "Note"),
    isNotNull(objects.conversation),
    or(
      eq(objects.attributedTo, actorApId),
      recipientToJsonLike(actorApId),
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
      !obj.conversation || !filterFn(obj.conversation) ||
      map.has(obj.conversation)
    ) continue;

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

  const replies = await db.selectDistinct({
    conversation: objects.conversation,
  })
    .from(objects)
    .where(
      and(
        inArray(objects.conversation, conversationIds),
        eq(objects.attributedTo, actorApId),
      ),
    );

  return new Set(replies.map((r) => r.conversation));
}

/** Collect unique values from a map's entries via accessor function. */
export function uniqueValues<V>(
  map: Map<string, V>,
  accessor: (v: V) => string,
): string[] {
  return [...new Set(Array.from(map.values()).map(accessor))];
}
