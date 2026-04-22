// DM typing indicators

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { dmTyping } from "../../../db/index.ts";
import { type HonoEnv, parseOtherApId } from "./conversations-helpers.ts";

const typing = new Hono<HonoEnv>();

typing.post("/user/:encodedApId/typing", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: "ap_id required" }, 400);

  const now = new Date().toISOString();
  await db.insert(dmTyping)
    .values({
      actorApId: actor.ap_id,
      recipientApId: otherApId,
      lastTypedAt: now,
    })
    .onConflictDoUpdate({
      target: [dmTyping.actorApId, dmTyping.recipientApId],
      set: { lastTypedAt: now },
    });

  return c.json({ success: true, typed_at: now });
});

typing.get("/user/:encodedApId/typing", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: "ap_id required" }, 400);

  const typingRecord = await db.select({ lastTypedAt: dmTyping.lastTypedAt })
    .from(dmTyping)
    .where(
      and(
        eq(dmTyping.actorApId, otherApId),
        eq(dmTyping.recipientApId, actor.ap_id),
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
    await db.delete(dmTyping).where(
      and(
        eq(dmTyping.actorApId, otherApId),
        eq(dmTyping.recipientApId, actor.ap_id),
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
