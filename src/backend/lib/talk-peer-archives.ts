import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  dmArchiveExpansions,
  dmPeerArchivedConversations,
  objects,
  type Database,
} from "../../db/index.ts";
import {
  applyTalkScopeWrite,
  type TalkReadScope,
} from "./talk-read-receipts.ts";

/** The same display counterpart as getOtherParticipant, for SQL grouping/filtering. */
export function otherParticipantSql(viewer: SQL): SQL {
  return sql`CASE WHEN ${objects.attributedTo} = ${viewer}
    THEN json_extract(${objects.toJson}, '$[0]') ELSE ${objects.attributedTo} END`;
}

/** Shared by rich contacts, archived contacts and the nav/push unread count. */
export function peerArchivedSql(
  viewer: SQL,
  peer: SQL,
  conversation: SQL,
): SQL {
  return sql`(EXISTS (SELECT 1 FROM dm_peer_archived_conversations p
      WHERE p.actor_ap_id = ${viewer} AND p.target_ap_id = ${peer})
    OR EXISTS (SELECT 1 FROM dm_archived_conversations old
      WHERE old.actor_ap_id = ${viewer} AND old.conversation_id = ${conversation}
        AND NOT EXISTS (SELECT 1 FROM dm_archive_expansions expanded
          WHERE expanded.actor_ap_id = old.actor_ap_id AND expanded.conversation_id = old.conversation_id)))`;
}

export async function setPeerArchived(
  db: Database,
  scope: TalkReadScope,
  archive: boolean,
  now: string,
): Promise<void> {
  if (scope.kind !== "user")
    throw new TypeError("Peer archive requires a user conversation");
  // The original marker is never deleted/reinterpreted on GET. On an explicit
  // mutation seed all currently indexed participants of that coarse marker,
  // then select the new peer state in the SAME atomic batch. Retry cannot
  // re-seed a peer the reader has already explicitly unarchived.
  const oldMarker = sql`SELECT COALESCE(old.archived_at, ${now}) FROM dm_archived_conversations old
    WHERE old.actor_ap_id = ${scope.viewer} AND old.conversation_id = ${scope.thread}
      AND NOT EXISTS (SELECT 1 FROM dm_archive_expansions expanded
        WHERE expanded.actor_ap_id = old.actor_ap_id AND expanded.conversation_id = old.conversation_id)`;
  const common = sql`o.visibility = 'direct' AND o.type = 'Note' AND o.conversation = ${scope.thread}
    AND EXISTS (${oldMarker})`;
  await applyTalkScopeWrite(db, scope, [
    db
      .insert(dmPeerArchivedConversations)
      .select(
        sql`
      SELECT DISTINCT ${scope.viewer}, p.recipient_ap_id, ${scope.thread}, (${oldMarker})
      FROM objects o JOIN object_recipients p ON p.object_ap_id = o.ap_id AND p.type = 'to'
      WHERE ${common} AND o.attributed_to = ${scope.viewer} AND p.recipient_ap_id <> ${scope.viewer}
      UNION
      SELECT DISTINCT ${scope.viewer}, o.attributed_to, ${scope.thread}, (${oldMarker})
      FROM objects o JOIN object_recipients p ON p.object_ap_id = o.ap_id AND p.type = 'to'
      WHERE ${common} AND p.recipient_ap_id = ${scope.viewer} AND o.attributed_to <> ${scope.viewer}
    `,
      )
      .onConflictDoNothing(),
    db
      .insert(dmArchiveExpansions)
      .select(
        sql`
      SELECT ${scope.viewer}, ${scope.thread}, ${now} WHERE EXISTS (${oldMarker})
    `,
      )
      .onConflictDoNothing(),
    archive
      ? db
          .insert(dmPeerArchivedConversations)
          .values({
            actorApId: scope.viewer,
            targetApId: scope.target,
            conversationId: scope.thread,
            archivedAt: now,
          })
          .onConflictDoNothing()
      : db
          .delete(dmPeerArchivedConversations)
          .where(
            and(
              eq(dmPeerArchivedConversations.actorApId, scope.viewer),
              eq(dmPeerArchivedConversations.targetApId, scope.target),
            ),
          ),
  ]);
}
