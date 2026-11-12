// DM typing indicators

import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import {
  actorCache,
  actors,
  blocks,
  dmTyping,
  remoteActorTombstones,
} from "../../../db/index.ts";
import { createGuardedDatabase } from "../../../db/guarded-writes.ts";
import {
  actorNotReservedSql,
  admissionGuard,
} from "../../lib/account-deletion-admission.ts";
import { normalizeActivityPubActorId } from "../../lib/activitypub-actor-identity.ts";
import { activityPubActorIdentityMatchesSql } from "../../lib/activitypub-actor-identity-sql.ts";
import { operatorActorNotBlockedSql } from "../../lib/blocklist.ts";
import {
  emitRealtimeBestEffort,
  runRealtimeAfterResponse,
} from "../../runtime/realtime-hub.ts";
import { type HonoEnv, parseOtherApId } from "./conversations-helpers.ts";

const typing = new Hono<HonoEnv>();

class TypingPeerUnavailableError extends Error {}

// The same current predicate gates the atomic write, the optional event and
// polling. A cached spelling cannot revive a deleted local or remote peer.
function typingAdmission(sender: string, recipient: string, peer: string) {
  const personalBlock = activityPubActorIdentityMatchesSql(
    sql`SELECT ${blocks.blockedApId} FROM ${blocks}
      WHERE ${blocks.blockerApId} = ${recipient}`,
    sender,
  );
  const canonicalPeer = normalizeActivityPubActorId(peer) ?? peer;
  return sql`(
    EXISTS (SELECT 1 FROM ${actors} WHERE ${actors.apId} = ${peer}
      AND ${actors.deletedAt} IS NULL AND ${actorNotReservedSql(peer)})
    OR (NOT EXISTS (SELECT 1 FROM ${actors}
        WHERE ${actors.apId} = ${peer} OR ${actors.apId} = ${canonicalPeer})
      AND EXISTS (SELECT 1 FROM ${actorCache} WHERE ${actorCache.apId} = ${peer}))
  ) AND NOT EXISTS (SELECT 1 FROM ${remoteActorTombstones}
      WHERE ${remoteActorTombstones.actorApId} = ${canonicalPeer})
    AND ${operatorActorNotBlockedSql(sql`${peer}`)}
    AND NOT EXISTS (${personalBlock})`;
}

typing.post("/user/:encodedApId/typing", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: "ap_id required" }, 400);

  const admission = typingAdmission(actor.ap_id, otherApId, otherApId);
  const guarded = createGuardedDatabase(db, () =>
    admissionGuard(db, admission, () => new TypingPeerUnavailableError()),
  );
  const now = new Date().toISOString();
  try {
    await guarded
      .insert(dmTyping)
      .values({
        actorApId: actor.ap_id,
        recipientApId: otherApId,
        lastTypedAt: now,
      })
      .onConflictDoUpdate({
        target: [dmTyping.actorApId, dmTyping.recipientApId],
        set: { lastTypedAt: now },
      });
  } catch (error) {
    if (!(error instanceof TypingPeerUnavailableError)) throw error;
    return c.json({ error: "User not found" }, 404);
  }

  // Push the indicator to the partner's live sockets; the GET endpoint stays
  // as the fallback-polling read.
  await runRealtimeAfterResponse(c, async () => {
    const current = await db
      .select({ lastTypedAt: dmTyping.lastTypedAt })
      .from(dmTyping)
      .where(
        and(
          eq(dmTyping.actorApId, actor.ap_id),
          eq(dmTyping.recipientApId, otherApId),
          eq(dmTyping.lastTypedAt, now),
          admission,
        ),
      )
      .get();
    if (!current) return;
    await emitRealtimeBestEffort(c.env, [
      {
        actorApId: otherApId,
        type: "talk.typing",
        data: { other_ap_id: actor.ap_id, is_typing: true, typed_at: now },
      },
    ]);
  });

  return c.json({ success: true, typed_at: now });
});

typing.get("/user/:encodedApId/typing", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: "ap_id required" }, 400);

  const typingRecord = await db
    .select({ lastTypedAt: dmTyping.lastTypedAt })
    .from(dmTyping)
    .where(
      and(
        eq(dmTyping.actorApId, otherApId),
        eq(dmTyping.recipientApId, actor.ap_id),
        typingAdmission(otherApId, actor.ap_id, otherApId),
      ),
    )
    .get();

  if (!typingRecord?.lastTypedAt) {
    return c.json({ is_typing: false, last_typed_at: null });
  }

  const lastTypedMs = Date.parse(typingRecord.lastTypedAt);
  const elapsedMs = Date.now() - lastTypedMs;
  const isValid = Number.isFinite(lastTypedMs);
  const isTyping = isValid && elapsedMs <= 8000;
  const isExpired = !isValid || elapsedMs > 5 * 60 * 1000;

  if (isExpired) {
    await db
      .delete(dmTyping)
      .where(
        and(
          eq(dmTyping.actorApId, otherApId),
          eq(dmTyping.recipientApId, actor.ap_id),
          eq(dmTyping.lastTypedAt, typingRecord.lastTypedAt),
        ),
      );
    return c.json({ is_typing: false, last_typed_at: null });
  }

  return c.json({
    is_typing: isTyping,
    last_typed_at: typingRecord.lastTypedAt,
  });
});

export default typing;
