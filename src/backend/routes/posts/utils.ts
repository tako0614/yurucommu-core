import { formatUsername } from '../../utils';

export const MAX_POST_CONTENT_LENGTH = 5000;
export const MAX_POST_SUMMARY_LENGTH = 500;
export const MAX_POSTS_PAGE_LIMIT = 100;

export function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

export function extractMentions(content: string): string[] {
  const mentionRegex = /@([a-zA-Z0-9_]+(?:@[a-zA-Z0-9.-]+)?)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  return [...new Set(mentions)];
}

export function formatPost(p: any, currentActorApId?: string): any {
  return {
    ap_id: p.ap_id,
    type: p.type,
    author: {
      ap_id: p.attributed_to,
      username: formatUsername(p.attributed_to),
      preferred_username: p.author_username,
      name: p.author_name,
      icon_url: p.author_icon_url,
    },
    content: p.content,
    summary: p.summary,
    attachments: JSON.parse(p.attachments_json || '[]'),
    in_reply_to: p.in_reply_to,
    visibility: p.visibility,
    community_ap_id: p.community_ap_id,
    like_count: p.like_count,
    reply_count: p.reply_count,
    announce_count: p.announce_count,
    published: p.published,
    liked: currentActorApId ? !!p.liked : false,
  };
}

export function normalizeVisibility(value?: string): 'public' | 'unlisted' | 'followers' | 'direct' {
  if (value === 'private' || value === 'followers_only') return 'followers';
  if (value === 'public' || value === 'unlisted' || value === 'followers' || value === 'direct') return value;
  return 'public';
}
