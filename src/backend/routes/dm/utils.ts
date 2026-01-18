import type { PrismaClient } from '../../../generated/prisma';
import { parseLimit } from '../../utils';

export const MAX_DM_CONTENT_LENGTH = 5000;
export const MAX_DM_PAGE_LIMIT = 100;

export { parseLimit };

export function getConversationId(baseUrl: string, ap1: string, ap2: string): string {
  const [p1, p2] = [ap1, ap2].sort();
  const hash = btoa(`${p1}:${p2}`).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
  return `${baseUrl}/ap/conversations/${hash}`;
}

export async function resolveConversationId(
  prisma: PrismaClient,
  baseUrl: string,
  actorApId: string,
  otherApId: string
): Promise<string> {
  // Find existing conversation between these two actors
  const existing = await prisma.object.findFirst({
    where: {
      visibility: 'direct',
      type: 'Note',
      conversation: { not: null },
      OR: [
        {
          attributedTo: actorApId,
          toJson: { contains: otherApId },
        },
        {
          attributedTo: otherApId,
          toJson: { contains: actorApId },
        },
      ],
    },
    orderBy: { published: 'desc' },
    select: { conversation: true },
  });

  return existing?.conversation || getConversationId(baseUrl, actorApId, otherApId);
}
