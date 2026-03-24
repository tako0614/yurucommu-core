/**
 * Takos Tools - Utility helpers
 *
 * Shared helpers extracted from takos-tools.ts for response formatting,
 * input validation, and common data operations.
 */

import { eq, and, inArray } from 'drizzle-orm';
import type { Database } from '../../db';
import { actors, follows, likes, bookmarks } from '../../db';
import { formatUsername, parseLimit, safeJsonParse } from '../utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ActorSummary {
  apId: string;
  preferredUsername: string;
  name: string | null;
  iconUrl: string | null;
}

export type Input = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

export function toolLimit(value: unknown, fallback: number, max: number): number {
  const normalized = value == null ? undefined : String(value);
  return parseLimit(normalized, fallback, max);
}

export function requireString(input: Input, key: string): string {
  return String(input[key] || '').trim();
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function errAuth(): ToolResponse {
  return { success: false, error: 'Authentication required' };
}

export function errRequired(field: string): ToolResponse {
  return { success: false, error: `${field} is required` };
}

export function errNotFound(entity: string): ToolResponse {
  return { success: false, error: `${entity} not found` };
}

export function ok(data: unknown): ToolResponse {
  return { success: true, data };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatActorSummary(a: ActorSummary): Record<string, unknown> {
  return {
    ap_id: a.apId,
    username: formatUsername(a.apId),
    preferred_username: a.preferredUsername,
    name: a.name,
    icon_url: a.iconUrl,
  };
}

export const ACTOR_SUMMARY_COLUMNS = {
  apId: actors.apId,
  preferredUsername: actors.preferredUsername,
  name: actors.name,
  iconUrl: actors.iconUrl,
} as const;

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

/**
 * Determine the conversation partner from a DM object.
 * Returns null when the current actor is not a verified participant (defense in depth).
 */
export function resolveDmPartner(
  dm: { attributedTo: string; toJson: string | null },
  actorApId: string,
): string | null {
  const toRecipients = safeJsonParse<string[]>(dm.toJson, []);

  if (dm.attributedTo === actorApId) {
    return toRecipients[0] || null;
  }

  // Defense in depth: verify we're actually a recipient.
  if (!toRecipients.includes(actorApId)) return null;
  return dm.attributedTo;
}

/**
 * Toggle a many-to-one relation (like, bookmark) on a post.
 */
export async function togglePostRelation(
  db: Database,
  table: typeof likes | typeof bookmarks,
  actorApIdVal: string,
  objectApIdVal: string,
  active: boolean,
): Promise<void> {
  if (active) {
    // Upsert: insert if not exists, ignore conflict
    await db.insert(table)
      .values({ actorApId: actorApIdVal, objectApId: objectApIdVal })
      .onConflictDoNothing();
  } else {
    await db.delete(table)
      .where(and(eq(table.actorApId, actorApIdVal), eq(table.objectApId, objectApIdVal)));
  }
}

/**
 * Fetch a follow-direction list for a given actor (followers or following).
 */
export async function fetchFollowList(
  db: Database,
  targetApId: string,
  direction: 'followers' | 'following',
  limit: number,
): Promise<ActorSummary[]> {
  const isFollowers = direction === 'followers';
  const followRows = await db.select()
    .from(follows)
    .where(and(
      eq(isFollowers ? follows.followingApId : follows.followerApId, targetApId),
      eq(follows.status, 'accepted'),
    ))
    .limit(limit);

  const relatedIds = followRows.map((f) => isFollowers ? f.followerApId : f.followingApId);
  if (relatedIds.length === 0) return [];

  return db.select(ACTOR_SUMMARY_COLUMNS)
    .from(actors)
    .where(inArray(actors.apId, relatedIds));
}
