import { and, count, eq, inArray, lt } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import {
  actorCache,
  blocks,
  likes,
  mutes,
  objects,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";
import { objectApId, safeJsonParse } from "../../federation-helpers.ts";

interface VoteResults {
  [optionIndex: number]: number;
}

type OverlayPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Overlay = {
  type: string;
  position: OverlayPosition;
  oneOf?: unknown[];
  href?: string;
};

type StoryAttachment = {
  type: string;
  mediaType: string;
  url: string;
  r2_key: string;
  width: number;
  height: number;
};

type StoredStoryData = {
  attachment?: {
    r2_key?: string;
    content_type?: string;
    url?: string;
    width?: number;
    height?: number;
  };
  displayDuration?: string;
  caption?: string;
  overlays?: Overlay[];
};

type ActorCacheEntry = {
  preferredUsername: string | null;
  name: string | null;
  iconUrl: string | null;
};

// ---------------------------------------------------------------------------
// Story lookup helpers
// ---------------------------------------------------------------------------

/** Resolve a story param (short ID or full URL) to a full ap_id. */
export function resolveStoryApId(storyId: string, baseUrl: string): string {
  return storyId.startsWith("http") ? storyId : objectApId(baseUrl, storyId);
}

/** Find a single Story object by ap_id. Returns null/undefined when not found. */
export function findStory(db: Database, apId: string) {
  return db
    .select()
    .from(objects)
    .where(and(eq(objects.apId, apId), eq(objects.type, "Story")))
    .get();
}

// ---------------------------------------------------------------------------
// Blocked / muted helpers
// ---------------------------------------------------------------------------

/** Fetch blocked and muted ap_ids for the given actor. */
export async function fetchBlockedAndMutedIds(
  db: Database,
  actorApId: string,
): Promise<{ blockedIds: string[]; mutedIds: string[] }> {
  const [blockRows, muteRows] = await Promise.all([
    db
      .select({ blockedApId: blocks.blockedApId })
      .from(blocks)
      .where(eq(blocks.blockerApId, actorApId)),
    db
      .select({ mutedApId: mutes.mutedApId })
      .from(mutes)
      .where(eq(mutes.muterApId, actorApId)),
  ]);

  return {
    blockedIds: blockRows.map((b) => b.blockedApId),
    mutedIds: muteRows.map((m) => m.mutedApId),
  };
}

// ---------------------------------------------------------------------------
// Vote helpers
// ---------------------------------------------------------------------------

/** Get vote counts for a single story, keyed by option index. */
export async function getVoteCounts(
  db: Database,
  storyApId: string,
): Promise<VoteResults> {
  const votes = await db
    .select({
      optionIndex: storyVotes.optionIndex,
      count: count(),
    })
    .from(storyVotes)
    .where(eq(storyVotes.storyApId, storyApId))
    .groupBy(storyVotes.optionIndex);

  return Object.fromEntries(votes.map((v) => [v.optionIndex, v.count]));
}

/** Sum all vote counts in a VoteResults record. */
export function sumVotes(votes: VoteResults): number {
  return Object.values(votes).reduce((sum, count) => sum + count, 0);
}

/**
 * Batch-fetch vote counts and (optionally) the current user's votes
 * for a list of story ap_ids.
 */
export async function fetchBatchVotes(
  db: Database,
  storyApIds: string[],
  actorApId?: string,
): Promise<{
  allVotes: Record<string, VoteResults>;
  userVotes: Record<string, number>;
}> {
  if (storyApIds.length === 0) {
    return { allVotes: {}, userVotes: {} };
  }

  const voteCounts = await db
    .select({
      storyApId: storyVotes.storyApId,
      optionIndex: storyVotes.optionIndex,
      count: count(),
    })
    .from(storyVotes)
    .where(inArray(storyVotes.storyApId, storyApIds))
    .groupBy(storyVotes.storyApId, storyVotes.optionIndex);

  const allVotes: Record<string, VoteResults> = {};
  for (const v of voteCounts) {
    if (!allVotes[v.storyApId]) allVotes[v.storyApId] = {};
    allVotes[v.storyApId][v.optionIndex] = v.count;
  }

  let userVotes: Record<string, number> = {};
  if (actorApId) {
    const rows = await db
      .select({
        storyApId: storyVotes.storyApId,
        optionIndex: storyVotes.optionIndex,
      })
      .from(storyVotes)
      .where(
        and(
          inArray(storyVotes.storyApId, storyApIds),
          eq(storyVotes.actorApId, actorApId),
        ),
      );
    userVotes = Object.fromEntries(
      rows.map((r) => [r.storyApId, r.optionIndex]),
    );
  }

  return { allVotes, userVotes };
}

// ---------------------------------------------------------------------------
// Actor cache helper
// ---------------------------------------------------------------------------

/** Fetch cached actor info for remote authors missing a local actor row. */
export async function fetchActorCache(
  db: Database,
  remoteApIds: string[],
): Promise<Record<string, ActorCacheEntry>> {
  if (remoteApIds.length === 0) return {};

  const cached = await db
    .select({
      apId: actorCache.apId,
      preferredUsername: actorCache.preferredUsername,
      name: actorCache.name,
      iconUrl: actorCache.iconUrl,
    })
    .from(actorCache)
    .where(inArray(actorCache.apId, remoteApIds));

  return Object.fromEntries(
    cached.map((a) => [
      a.apId,
      {
        preferredUsername: a.preferredUsername,
        name: a.name,
        iconUrl: a.iconUrl,
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Story data cleanup & transformation
// ---------------------------------------------------------------------------

export async function cleanupExpiredStories(db: Database): Promise<number> {
  const now = new Date().toISOString();

  const expiredStories = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(and(eq(objects.type, "Story"), lt(objects.endTime, now)));

  if (expiredStories.length === 0) return 0;

  const expiredApIds = expiredStories.map((s) => s.apId);

  await db
    .delete(storyVotes)
    .where(inArray(storyVotes.storyApId, expiredApIds));
  await db.delete(likes).where(inArray(likes.objectApId, expiredApIds));
  await db
    .delete(storyViews)
    .where(inArray(storyViews.storyApId, expiredApIds));
  await db
    .delete(storyShares)
    .where(inArray(storyShares.storyApId, expiredApIds));

  await db
    .delete(objects)
    .where(and(eq(objects.type, "Story"), lt(objects.endTime, now)));

  return expiredApIds.length;
}

// ---------------------------------------------------------------------------
// Overlay validation
// ---------------------------------------------------------------------------

const POSITION_FIELDS = ["x", "y", "width", "height"] as const;

function isOverlayRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateOverlays(overlays: unknown[]): {
  valid: boolean;
  error?: string;
} {
  if (!Array.isArray(overlays)) {
    return { valid: false, error: "overlays must be an array" };
  }

  for (const [i, raw] of overlays.entries()) {
    if (!isOverlayRecord(raw)) {
      return { valid: false, error: `overlay[${i}] must be an object` };
    }
    const overlay = raw;

    if (typeof overlay.type !== "string" || overlay.type === "") {
      return { valid: false, error: `overlay[${i}].type is required` };
    }

    if (!isOverlayRecord(overlay.position)) {
      return { valid: false, error: `overlay[${i}].position is required` };
    }

    const position = overlay.position;
    for (const field of POSITION_FIELDS) {
      const val = position[field];
      if (typeof val !== "number" || val < 0 || val > 1) {
        return {
          valid: false,
          error: `overlay[${i}].position.${field} must be 0.0-1.0`,
        };
      }
    }

    if (overlay.type === "Question") {
      const oneOf = overlay.oneOf;
      if (!Array.isArray(oneOf) || oneOf.length < 2 || oneOf.length > 4) {
        return {
          valid: false,
          error: `overlay[${i}].oneOf must have 2-4 options`,
        };
      }
    }

    if (overlay.type === "Link") {
      if (typeof overlay.href !== "string" || overlay.href === "") {
        return { valid: false, error: `overlay[${i}].href is required` };
      }
      try {
        new URL(overlay.href);
      } catch {
        return { valid: false, error: `overlay[${i}].href is invalid URL` };
      }
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Story data transformation
// ---------------------------------------------------------------------------

export function transformStoryData(attachmentsJson: string): {
  attachment: StoryAttachment;
  caption?: string;
  displayDuration: string;
  overlays?: Overlay[];
} {
  const stored = safeJsonParse<StoredStoryData>(attachmentsJson, {});
  const r2Key = stored.attachment?.r2_key;
  const contentType = stored.attachment?.content_type || "image/jpeg";
  const externalUrl = stored.attachment?.url;

  let url = "";
  if (r2Key) {
    // Strip the known leading `uploads/` prefix explicitly. `String.replace`
    // with a string argument only removes the first, anywhere-matching
    // occurrence, which would mangle keys whose remainder contains the token.
    const UPLOADS_PREFIX = "uploads/";
    const publicPath = r2Key.startsWith(UPLOADS_PREFIX)
      ? r2Key.slice(UPLOADS_PREFIX.length)
      : r2Key;
    url = `/media/${publicPath}`;
  } else if (externalUrl) {
    url = externalUrl;
  }

  return {
    attachment: {
      type: contentType.startsWith("video/") ? "Video" : "Document",
      mediaType: contentType,
      url,
      r2_key: r2Key || "",
      width: stored.attachment?.width || 1080,
      height: stored.attachment?.height || 1920,
    },
    caption: stored.caption || undefined,
    displayDuration: stored.displayDuration || "PT5S",
    overlays: stored.overlays || undefined,
  };
}
