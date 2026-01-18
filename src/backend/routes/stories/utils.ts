import type { D1Database } from '@cloudflare/workers-types';

interface VoteResults {
  [optionIndex: number]: number;
}

type VoteRow = {
  option_index: number;
  count: number;
};

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

export async function cleanupExpiredStories(db: D1Database): Promise<number> {
  const now = new Date().toISOString();

  const expiredStories = await db
    .prepare(
      `
    SELECT ap_id FROM objects
    WHERE type = 'Story' AND end_time < ?
  `
    )
    .bind(now)
    .all();

  if (!expiredStories.results || expiredStories.results.length === 0) {
    return 0;
  }

  await db
    .prepare(
      `
    DELETE FROM story_votes
    WHERE story_ap_id IN (
      SELECT ap_id FROM objects
      WHERE type = 'Story' AND end_time < ?
    )
  `
    )
    .bind(now)
    .run();

  await db
    .prepare(
      `
    DELETE FROM likes
    WHERE object_ap_id IN (
      SELECT ap_id FROM objects
      WHERE type = 'Story' AND end_time < ?
    )
  `
    )
    .bind(now)
    .run();

  await db
    .prepare(
      `
    DELETE FROM story_views
    WHERE story_ap_id IN (
      SELECT ap_id FROM objects
      WHERE type = 'Story' AND end_time < ?
    )
  `
    )
    .bind(now)
    .run();

  const result = await db
    .prepare(
      `
    DELETE FROM objects
    WHERE type = 'Story' AND end_time < ?
  `
    )
    .bind(now)
    .run();

  return result.meta.changes || 0;
}

export async function getVoteCounts(db: D1Database, storyApId: string): Promise<VoteResults> {
  const votes = await db
    .prepare(
      `
    SELECT option_index, COUNT(*) as count
    FROM story_votes
    WHERE story_ap_id = ?
    GROUP BY option_index
  `
    )
    .bind(storyApId)
    .all<VoteRow>();

  const results: VoteResults = {};
  (votes.results || []).forEach((vote: VoteRow) => {
    results[vote.option_index] = vote.count;
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
