import { eq, and, or, desc, isNotNull, like } from 'drizzle-orm';
import type { Database } from '../../../db';
import { objects } from '../../../db';

export const MAX_DM_CONTENT_LENGTH = 5000;
export const MAX_DM_PAGE_LIMIT = 100;

export function getConversationId(baseUrl: string, ap1: string, ap2: string): string {
  const [p1, p2] = [ap1, ap2].sort();
  const hash = btoa(`${p1}:${p2}`).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
  return `${baseUrl}/ap/conversations/${hash}`;
}

export async function resolveConversationId(
  db: Database,
  baseUrl: string,
  actorApId: string,
  otherApId: string
): Promise<string> {
  const actorApIdJson = JSON.stringify(actorApId);
  const otherApIdJson = JSON.stringify(otherApId);

  // Find existing conversation between these two actors
  const existing = await db.select({ conversation: objects.conversation })
    .from(objects)
    .where(
      and(
        eq(objects.visibility, 'direct'),
        eq(objects.type, 'Note'),
        isNotNull(objects.conversation),
        or(
          and(
            eq(objects.attributedTo, actorApId),
            like(objects.toJson, `%${otherApIdJson}%`),
          ),
          and(
            eq(objects.attributedTo, otherApId),
            like(objects.toJson, `%${actorApIdJson}%`),
          ),
        ),
      ),
    )
    .orderBy(desc(objects.published))
    .limit(1)
    .get();

  return existing?.conversation || getConversationId(baseUrl, actorApId, otherApId);
}
