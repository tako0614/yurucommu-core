// Shared helpers for DM conversations

import type { Context } from 'hono';
import { eq, and, or, like, inArray, isNotNull } from 'drizzle-orm';
import type { Database } from '../../../db';
import { actors, actorCache, objects } from '../../../db';
import type { Env, Variables } from '../../types';
import { formatUsername, safeJsonParse } from '../../utils';

export type HonoEnv = { Bindings: Env; Variables: Variables };
export type ActorInfo = { preferredUsername: string | null; name: string | null; iconUrl: string | null };

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

/** Fetch actor info from local actors (preferred) with cache fallback, keyed by apId. */
export async function buildActorInfoMap(
  db: Database,
  apIds: string[],
): Promise<Map<string, ActorInfo>> {
  if (apIds.length === 0) return new Map();

  const [localActors, cachedActors] = await Promise.all([
    db.select(ACTOR_INFO_FIELDS).from(actors).where(inArray(actors.apId, apIds)),
    db.select(ACTOR_CACHE_INFO_FIELDS).from(actorCache).where(inArray(actorCache.apId, apIds)),
  ]);

  const map = new Map<string, ActorInfo>();
  for (const a of cachedActors) map.set(a.apId, a);
  for (const a of localActors) map.set(a.apId, a); // local takes precedence
  return map;
}

/** Build the standard actor profile shape used across all DM responses. */
export function formatActorProfile(apId: string, info: ActorInfo | undefined) {
  return {
    ap_id: apId,
    username: formatUsername(apId),
    preferred_username: info?.preferredUsername || null,
    name: info?.name || null,
    icon_url: info?.iconUrl || null,
  };
}

/** Extract the other participant's AP ID from a DM object. */
export function getOtherParticipant(obj: { attributedTo: string; toJson: string }, actorApId: string): string {
  if (obj.attributedTo === actorApId) {
    return safeJsonParse<string[]>(obj.toJson, [])[0] || '';
  }
  return obj.attributedTo;
}

/** Drizzle where clause for DM objects involving a given actor. */
export function dmWhereForActor(actorApId: string, actorApIdJson: string) {
  return and(
    eq(objects.visibility, 'direct'),
    eq(objects.type, 'Note'),
    isNotNull(objects.conversation),
    or(
      eq(objects.attributedTo, actorApId),
      like(objects.toJson, `%${actorApIdJson}%`),
    ),
  );
}

/** Sort comparator: descending by time string, with fallback. */
export function byTimeDesc(a: string | null, b: string | null): number {
  return (b || '').localeCompare(a || '');
}

/** Decode and validate the :encodedApId route param. Returns null on failure after sending 400. */
export function parseOtherApId(c: Context<HonoEnv>): string | null {
  const raw = c.req.param('encodedApId');
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
): Map<string, { conversation: string; otherApId: string; lastMessageAt: string; lastContent: string | null; lastSender: string }> {
  const map = new Map<string, { conversation: string; otherApId: string; lastMessageAt: string; lastContent: string | null; lastSender: string }>();

  for (const obj of dmObjects) {
    if (!obj.conversation || !filterFn(obj.conversation) || map.has(obj.conversation)) continue;

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

  const replies = await db.selectDistinct({ conversation: objects.conversation })
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
export function uniqueValues<V>(map: Map<string, V>, accessor: (v: V) => string): string[] {
  return [...new Set(Array.from(map.values()).map(accessor))];
}
