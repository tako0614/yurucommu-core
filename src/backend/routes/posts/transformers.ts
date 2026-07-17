import { formatUsername, safeJsonParse } from "../../federation-helpers.ts";

export const MAX_POST_CONTENT_LENGTH = 5000;
export const MAX_POST_SUMMARY_LENGTH = 500;
// Attachment bounds live in lib/attachments.ts (shared with the DM and
// community-chat validators); re-exported here for the existing post-route and
// inbound-handler importers.
export {
  boundAttachmentsJson,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_JSON_LENGTH,
} from "../../lib/attachments.ts";

/** Truncate a string to `max` characters (no-op when already within bounds). */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

// Remote inbound Note fields are attacker-controlled and were stored verbatim
// (capped only by the 512 KiB inbox body limit), vs the ~5 KB local ceiling.
// Truncate to the same local bounds at ingest. These never reject (a 5xx would
// just make the peer retry); they store a bounded version.
export function boundInboundContent(content: unknown): string {
  return typeof content === "string"
    ? truncate(content, MAX_POST_CONTENT_LENGTH)
    : "";
}
export function boundInboundSummary(summary: unknown): string | null {
  return typeof summary === "string" && summary.length > 0
    ? truncate(summary, MAX_POST_SUMMARY_LENGTH)
    : null;
}
// Capped at 90 (not 100): a page's object ids are re-queried via
// `inArray(col, objectApIds)` for like/bookmark enrichment, and Cloudflare D1
// allows at most 100 bound parameters per query. 90 leaves headroom for the
// other bound params in those enrichment statements. (Tests run on libsql,
// whose ~32k ceiling hides this — see lib/blocklist.ts for the same constraint.)
export const MAX_POSTS_PAGE_LIMIT = 90;

export type PostRow = {
  ap_id: string;
  type: string;
  attributed_to: string;
  author_username: string | null;
  author_name: string | null;
  author_icon_url: string | null;
  content: string;
  summary: string | null;
  attachments_json: string | null;
  in_reply_to: string | null;
  visibility: string;
  community_ap_id: string | null;
  like_count: number;
  reply_count: number;
  announce_count: number;
  published: string;
  updated?: string | null;
  liked?: number | boolean;
};

export type FormattedPost = {
  ap_id: string;
  type: string;
  author: {
    ap_id: string;
    username: string;
    preferred_username: string | null;
    name: string | null;
    icon_url: string | null;
  };
  content: string;
  summary: string | null;
  attachments: unknown[];
  in_reply_to: string | null;
  visibility: string;
  community_ap_id: string | null;
  like_count: number;
  reply_count: number;
  announce_count: number;
  published: string;
  edited_at: string | null;
  liked: boolean;
};

const MENTION_REGEX = /@([a-zA-Z0-9_]+(?:@[a-zA-Z0-9.-]+)?)/g;

export function extractMentions(content: string): string[] {
  const matches = Array.from(content.matchAll(MENTION_REGEX), (m) => m[1]);
  return [...new Set(matches)];
}

// Unicode-aware hashtag body (matches the web client tokenizer), so Japanese
// tags like #海の日 federate as AS2 Hashtag tags too.
const HASHTAG_REGEX = /#([\p{L}\p{N}_]+)/gu;

export function extractHashtags(content: string): string[] {
  const matches = Array.from(content.matchAll(HASHTAG_REGEX), (m) => m[1]);
  // De-duplicate case-insensitively, keeping first-seen casing.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of matches) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function formatPost(
  p: PostRow,
  currentActorApId?: string,
): FormattedPost {
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
    attachments: safeJsonParse(p.attachments_json, []),
    in_reply_to: p.in_reply_to,
    visibility: p.visibility,
    community_ap_id: p.community_ap_id,
    like_count: p.like_count,
    reply_count: p.reply_count,
    announce_count: p.announce_count,
    published: p.published,
    // Surfaced only when the post was actually edited (see timeline.formatPost).
    edited_at: p.updated && p.updated !== p.published ? p.updated : null,
    liked: currentActorApId ? !!p.liked : false,
  };
}

const VALID_VISIBILITIES = new Set([
  "public",
  "unlisted",
  "followers",
  "direct",
] as const);

export function normalizeVisibility(
  value?: string,
): "public" | "unlisted" | "followers" | "direct" {
  if (value === "private" || value === "followers_only") return "followers";
  if (
    VALID_VISIBILITIES.has(
      value as "public" | "unlisted" | "followers" | "direct",
    )
  ) {
    return value as "public" | "unlisted" | "followers" | "direct";
  }
  return "public";
}
