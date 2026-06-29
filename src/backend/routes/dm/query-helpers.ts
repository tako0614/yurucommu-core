import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import { objects } from "../../../db/index.ts";
import { recipientObjectIds } from "./conversations-helpers.ts";
import { base64UrlEncode } from "../../lib/oauth-utils.ts";

export const MAX_DM_CONTENT_LENGTH = 5000;
// Capped at 90 (not 100): a page of DM ids is re-queried via `inArray` for
// author/recipient enrichment, and Cloudflare D1 allows at most 100 bound
// parameters per query. (Tests run on libsql's ~32k ceiling, which hides this.)
export const MAX_DM_PAGE_LIMIT = 90;

/**
 * Derive the deterministic conversation ID for a DM between two actors.
 *
 * The two participant AP-IDs are sorted (so the order in which the pair is
 * supplied does not matter) and joined with a newline — a byte that cannot
 * appear inside an AP-ID URL, so it is an unambiguous separator. The joined
 * pair is then base64url-encoded WITHOUT truncation, which makes the mapping
 * from actor-pair to conversation ID injective: distinct pairs always produce
 * distinct IDs, eliminating the collisions that the previous 16-char,
 * alnum-stripped base64 truncation produced (two same-host actor URLs share a
 * long common base64 prefix, so the old scheme collapsed every same-host pair
 * onto the same ID).
 *
 * Migration note: this changes the ID derived for a given pair, so DM objects,
 * read status and archive rows written under the old truncated scheme will not
 * be matched by the new ID. `resolveConversationId` first looks up the existing
 * conversation ID stored on prior DM objects, so already-threaded conversations
 * keep working; only the synchronous `getConversationId` fallback (no prior
 * message, archive, read-status) changes. There is no automatic backfill: the
 * old IDs were collision-prone and are intentionally not reproduced.
 */
export function getConversationId(
  baseUrl: string,
  ap1: string,
  ap2: string,
): string {
  const [p1, p2] = [ap1, ap2].sort();
  const bytes = new TextEncoder().encode(`${p1}\n${p2}`);
  // base64url, no padding: URL-safe and free of characters that would be
  // stripped, so the full (collision-free) encoding is preserved.
  const hash = base64UrlEncode(bytes.buffer);
  return `${baseUrl}/ap/conversations/${hash}`;
}

export async function resolveConversationId(
  db: Database,
  baseUrl: string,
  actorApId: string,
  otherApId: string,
): Promise<string> {
  // Find existing conversation between these two actors
  const existing = await db
    .select({ conversation: objects.conversation })
    .from(objects)
    .where(
      and(
        eq(objects.visibility, "direct"),
        eq(objects.type, "Note"),
        isNotNull(objects.conversation),
        // A DM between this pair = a Note authored by one and addressed to the
        // other. Recipient membership is resolved via the indexed
        // object_recipients link (see recipientObjectIds) instead of an
        // unindexable `to_json LIKE '%"<apId>"%'` scan; same semantics.
        or(
          and(
            eq(objects.attributedTo, actorApId),
            inArray(objects.apId, recipientObjectIds(db, otherApId)),
          ),
          and(
            eq(objects.attributedTo, otherApId),
            inArray(objects.apId, recipientObjectIds(db, actorApId)),
          ),
        ),
      ),
    )
    .orderBy(desc(objects.published))
    .limit(1)
    .get();

  return (
    existing?.conversation || getConversationId(baseUrl, actorApId, otherApId)
  );
}
