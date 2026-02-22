import type { PrismaClient } from '../../../generated/prisma';
import { safeJsonParse, objectApId } from '../../utils';

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
  return storyId.startsWith('http') ? storyId : objectApId(baseUrl, storyId);
}

/** Find a single Story object by ap_id. Returns null when not found. */
export function findStory(prisma: PrismaClient, apId: string) {
  return prisma.object.findFirst({
    where: { apId, type: 'Story' },
  });
}

// ---------------------------------------------------------------------------
// Blocked / muted helpers
// ---------------------------------------------------------------------------

/** Fetch blocked and muted ap_ids for the given actor. */
export async function fetchBlockedAndMutedIds(
  prisma: PrismaClient,
  actorApId: string,
): Promise<{ blockedIds: string[]; mutedIds: string[] }> {
  const [blocks, mutes] = await Promise.all([
    prisma.block.findMany({
      where: { blockerApId: actorApId },
      select: { blockedApId: true },
    }),
    prisma.mute.findMany({
      where: { muterApId: actorApId },
      select: { mutedApId: true },
    }),
  ]);

  return {
    blockedIds: blocks.map((b) => b.blockedApId),
    mutedIds: mutes.map((m) => m.mutedApId),
  };
}

// ---------------------------------------------------------------------------
// Vote helpers
// ---------------------------------------------------------------------------

/** Get vote counts for a single story, keyed by option index. */
export async function getVoteCounts(prisma: PrismaClient, storyApId: string): Promise<VoteResults> {
  const votes = await prisma.storyVote.groupBy({
    by: ['optionIndex'],
    where: { storyApId },
    _count: { id: true },
  });

  return Object.fromEntries(votes.map((v) => [v.optionIndex, v._count.id]));
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
  prisma: PrismaClient,
  storyApIds: string[],
  actorApId?: string,
): Promise<{ allVotes: Record<string, VoteResults>; userVotes: Record<string, number> }> {
  if (storyApIds.length === 0) {
    return { allVotes: {}, userVotes: {} };
  }

  const voteCounts = await prisma.storyVote.groupBy({
    by: ['storyApId', 'optionIndex'],
    where: { storyApId: { in: storyApIds } },
    _count: { id: true },
  });

  const allVotes: Record<string, VoteResults> = {};
  for (const v of voteCounts) {
    if (!allVotes[v.storyApId]) allVotes[v.storyApId] = {};
    allVotes[v.storyApId][v.optionIndex] = v._count.id;
  }

  let userVotes: Record<string, number> = {};
  if (actorApId) {
    const rows = await prisma.storyVote.findMany({
      where: { storyApId: { in: storyApIds }, actorApId },
      select: { storyApId: true, optionIndex: true },
    });
    userVotes = Object.fromEntries(rows.map((r) => [r.storyApId, r.optionIndex]));
  }

  return { allVotes, userVotes };
}

// ---------------------------------------------------------------------------
// Actor cache helper
// ---------------------------------------------------------------------------

/** Fetch cached actor info for remote authors missing a local actor row. */
export async function fetchActorCache(
  prisma: PrismaClient,
  remoteApIds: string[],
): Promise<Record<string, ActorCacheEntry>> {
  if (remoteApIds.length === 0) return {};

  const cached = await prisma.actorCache.findMany({
    where: { apId: { in: remoteApIds } },
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
  });

  return Object.fromEntries(
    cached.map((a) => [
      a.apId,
      { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Story data cleanup & transformation
// ---------------------------------------------------------------------------

export async function cleanupExpiredStories(prisma: PrismaClient): Promise<number> {
  const now = new Date().toISOString();

  const expiredStories = await prisma.object.findMany({
    where: { type: 'Story', endTime: { lt: now } },
    select: { apId: true },
  });

  if (expiredStories.length === 0) return 0;

  const expiredApIds = expiredStories.map((s) => s.apId);

  await prisma.storyVote.deleteMany({ where: { storyApId: { in: expiredApIds } } });
  await prisma.like.deleteMany({ where: { objectApId: { in: expiredApIds } } });
  await prisma.storyView.deleteMany({ where: { storyApId: { in: expiredApIds } } });
  await prisma.storyShare.deleteMany({ where: { storyApId: { in: expiredApIds } } });

  const result = await prisma.object.deleteMany({
    where: { type: 'Story', endTime: { lt: now } },
  });

  return result.count;
}

// ---------------------------------------------------------------------------
// Overlay validation
// ---------------------------------------------------------------------------

const POSITION_FIELDS = ['x', 'y', 'width', 'height'] as const;

export function validateOverlays(overlays: unknown[]): { valid: boolean; error?: string } {
  if (!Array.isArray(overlays)) {
    return { valid: false, error: 'overlays must be an array' };
  }

  for (const [i, raw] of overlays.entries()) {
    const overlay = raw as Record<string, unknown>;

    if (!overlay.type || typeof overlay.type !== 'string') {
      return { valid: false, error: `overlay[${i}].type is required` };
    }

    if (!overlay.position || typeof overlay.position !== 'object') {
      return { valid: false, error: `overlay[${i}].position is required` };
    }

    const position = overlay.position as Partial<OverlayPosition>;
    for (const field of POSITION_FIELDS) {
      const val = position[field];
      if (typeof val !== 'number' || val < 0 || val > 1) {
        return { valid: false, error: `overlay[${i}].position.${field} must be 0.0-1.0` };
      }
    }

    if (overlay.type === 'Question') {
      const oneOf = overlay.oneOf as unknown[] | undefined;
      if (!oneOf || !Array.isArray(oneOf) || oneOf.length < 2 || oneOf.length > 4) {
        return { valid: false, error: `overlay[${i}].oneOf must have 2-4 options` };
      }
    }

    if (overlay.type === 'Link') {
      if (!overlay.href || typeof overlay.href !== 'string') {
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
  displayDuration: string;
  overlays?: Overlay[];
} {
  const stored = safeJsonParse<StoredStoryData>(attachmentsJson, {});
  const r2Key = stored.attachment?.r2_key;
  const contentType = stored.attachment?.content_type || 'image/jpeg';
  const externalUrl = stored.attachment?.url;

  let url = '';
  if (r2Key) {
    url = `/media/${r2Key.replace('uploads/', '')}`;
  } else if (externalUrl) {
    url = externalUrl;
  }

  return {
    attachment: {
      type: contentType.startsWith('video/') ? 'Video' : 'Document',
      mediaType: contentType,
      url,
      r2_key: r2Key || '',
      width: stored.attachment?.width || 1080,
      height: stored.attachment?.height || 1920,
    },
    displayDuration: stored.displayDuration || 'PT5S',
    overlays: stored.overlays || undefined,
  };
}
