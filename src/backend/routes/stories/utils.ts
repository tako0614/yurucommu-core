import type { PrismaClient } from '../../../generated/prisma';

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

export async function cleanupExpiredStories(prisma: PrismaClient): Promise<number> {
  const now = new Date().toISOString();

  // Get expired story IDs
  const expiredStories = await prisma.object.findMany({
    where: {
      type: 'Story',
      endTime: { lt: now },
    },
    select: {
      apId: true,
    },
  });

  if (expiredStories.length === 0) {
    return 0;
  }

  const expiredApIds = expiredStories.map(s => s.apId);

  // Delete story votes
  await prisma.storyVote.deleteMany({
    where: {
      storyApId: { in: expiredApIds },
    },
  });

  // Delete story likes
  await prisma.like.deleteMany({
    where: {
      objectApId: { in: expiredApIds },
    },
  });

  // Delete story views
  await prisma.storyView.deleteMany({
    where: {
      storyApId: { in: expiredApIds },
    },
  });

  // Delete story shares
  await prisma.storyShare.deleteMany({
    where: {
      storyApId: { in: expiredApIds },
    },
  });

  // Delete expired stories
  const result = await prisma.object.deleteMany({
    where: {
      type: 'Story',
      endTime: { lt: now },
    },
  });

  return result.count;
}

export async function getVoteCounts(prisma: PrismaClient, storyApId: string): Promise<VoteResults> {
  const votes = await prisma.storyVote.groupBy({
    by: ['optionIndex'],
    where: {
      storyApId,
    },
    _count: {
      id: true,
    },
  });

  const results: VoteResults = {};
  votes.forEach(vote => {
    results[vote.optionIndex] = vote._count.id;
  });
  return results;
}

export function validateOverlays(overlays: unknown[]): { valid: boolean; error?: string } {
  if (!Array.isArray(overlays)) {
    return { valid: false, error: 'overlays must be an array' };
  }

  for (let i = 0; i < overlays.length; i++) {
    const overlay = overlays[i] as Record<string, unknown>;

    // type validation
    if (!overlay.type || typeof overlay.type !== 'string') {
      return { valid: false, error: `overlay[${i}].type is required` };
    }

    // position validation
    if (!overlay.position || typeof overlay.position !== 'object') {
      return { valid: false, error: `overlay[${i}].position is required` };
    }

    const position = overlay.position as Partial<OverlayPosition>;
    const { x, y, width, height } = position;
    if (typeof x !== 'number' || x < 0 || x > 1) {
      return { valid: false, error: `overlay[${i}].position.x must be 0.0-1.0` };
    }
    if (typeof y !== 'number' || y < 0 || y > 1) {
      return { valid: false, error: `overlay[${i}].position.y must be 0.0-1.0` };
    }
    if (typeof width !== 'number' || width < 0 || width > 1) {
      return { valid: false, error: `overlay[${i}].position.width must be 0.0-1.0` };
    }
    if (typeof height !== 'number' || height < 0 || height > 1) {
      return { valid: false, error: `overlay[${i}].position.height must be 0.0-1.0` };
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

export function transformStoryData(attachmentsJson: string): {
  attachment: StoryAttachment;
  displayDuration: string;
  overlays?: Overlay[];
} {
  const stored = JSON.parse(attachmentsJson || '{}') as StoredStoryData;
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
