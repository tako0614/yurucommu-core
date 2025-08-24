import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import { createDB } from "../DB/mod.ts";
import { getDomain } from "../utils/activitypub.ts";
import { sendActivityPubObject } from "../utils/activitypub.ts";
import { isUrl } from "../../shared/url.ts";
import { resolveActor } from "../utils/activitypub.ts";
import Invite from "../models/takos/invite.ts";

const app = new Hono();

// /api にマウントされる前提でプレフィックス無しで定義
app.use("/rooms/*", authRequired);

function extractGroupName(id: string): string {
  // 受け取り得る形式: "name@domain" or ActivityPub URL or plain name
  try {
    if (id.startsWith("http")) {
      const u = new URL(id);
      const name = u.pathname.split("/").pop() || "";
      return name;
    }
  } catch {
    // ignore
  }
  if (id.includes("@")) return id.split("@")[0] || "";
  return id;
}

// 互換レイヤー: グループ宛の招待（/api/rooms/:id/invite -> /api/groups/:name/invite 相当）
app.post(
  "/rooms/:id/invite",
  zValidator("json", z.object({ actor: z.string().min(1) })),
  async (c) => {
    const rawId = c.req.param("id");
    const name = extractGroupName(rawId);
    if (!name) return c.json({ error: "invalid room id" }, 400);

    const { actor } = c.req.valid("json") as { actor: string };
    const env = getEnv(c);
    const db = createDB(env);

    const group = await db.findGroupByName(name);
    if (!group) return c.json({ error: "見つかりません" }, 404);
    if ((group as { allowInvites?: boolean }).allowInvites === false) {
      return c.json({ error: "招待が禁止されています" }, 400);
    }

    const domain = getDomain(c);
    const groupId = `https://${domain}/groups/${name}`;

    // actor の正規化（URL or user@host）
    let actorUrl = actor;
    if (!isUrl(actor)) {
      if (actor.includes("@")) {
        const [user, host] = actor.split("@");
        if (host === domain) {
          actorUrl = `https://${domain}/users/${user}`;
        } else {
          const resolved = await resolveActor(user, host).catch(() => null);
          if (!resolved || typeof resolved.id !== "string") {
            return c.json({ error: "Invalid actor" }, 400);
          }
          actorUrl = resolved.id as string;
        }
      } else {
        // ローカルユーザー名のみが来た場合はローカルとして解釈
        actorUrl = `https://${domain}/users/${actor}`;
      }
    }
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `https://${domain}/activities/${crypto.randomUUID()}`,
      type: "Invite" as const,
      actor: groupId,
      object: actorUrl,
      target: groupId,
      to: [actorUrl],
    };
    await sendActivityPubObject(actorUrl, activity, "system", domain, env);

    const inv = new Invite({ groupName: name, actor: actorUrl, inviter: groupId });
    await inv.save().catch(() => {});

    return c.json({ ok: true });
  },
);

// グループの保留中招待一覧（accepted=false）
app.get("/rooms/:id/pendingInvites", async (c) => {
  const rawId = c.req.param("id");
  const name = extractGroupName(rawId);
  if (!name) return c.json([], 200);
  const list = await Invite.find({ groupName: name, accepted: false })
    .select({ actor: 1 })
    .catch(() => [] as Array<{ actor: string }>);
  const actors = Array.isArray(list) ? list.map((x: { actor: string }) => x.actor) : [];
  return c.json(actors);
});

export default app;
