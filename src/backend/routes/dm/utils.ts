import type { D1Database } from '@cloudflare/workers-types';

export const MAX_DM_CONTENT_LENGTH = 5000;
export const MAX_DM_PAGE_LIMIT = 100;

export function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

export function getConversationId(baseUrl: string, ap1: string, ap2: string): string {
  const [p1, p2] = [ap1, ap2].sort();
  const hash = btoa(`${p1}:${p2}`).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
  return `${baseUrl}/ap/conversations/${hash}`;
}

export async function resolveConversationId(
  db: D1Database,
  baseUrl: string,
  actorApId: string,
  otherApId: string
): Promise<string> {
  const existing = await db
    .prepare(
      `
    SELECT o.conversation
    FROM objects o
    WHERE o.visibility = 'direct'
      AND o.type = 'Note'
      AND o.conversation IS NOT NULL
      AND o.conversation != ''
      AND (
        (o.attributed_to = ? AND json_extract(o.to_json, '$[0]') = ?)
        OR (o.attributed_to = ? AND json_extract(o.to_json, '$[0]') = ?)
      )
    ORDER BY o.published DESC
    LIMIT 1
  `
    )
    .bind(actorApId, otherApId, otherApId, actorApId)
    .first<any>();

  return existing?.conversation || getConversationId(baseUrl, actorApId, otherApId);
}
