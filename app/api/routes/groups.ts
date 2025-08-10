import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import {
  deliverActivityPubObject,
  getDomain,
  jsonResponse,
} from "../utils/activitypub.ts";

// ルーム管理 API (ActivityPub 対応)
const app = new Hono();

// ActivityPub グループ一覧取得
app.get("/ap/groups", async (c) => {
  const owner = c.req.query("owner");
  if (!owner) return jsonResponse(c, { error: "missing owner" }, 400);
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(owner);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const groups = await db.listGroups(owner);
  return jsonResponse(c, { groups });
});

// グループアクター取得
app.get("/ap/groups/:id", async (c) => {
  const id = c.req.param("id");
  const db = createDB(getEnv(c));
  const result = await db.findGroup(id);
  if (!result) return jsonResponse(c, { error: "Group not found" }, 404);
  const { group: room } = result;
  const domain = getDomain(c);
  const actor = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/ap/groups/${id}`,
    type: "Group",
    name: room.name,
    members: room.members,
  };
  return jsonResponse(c, actor, 200, "application/activity+json");
});

// グループ作成
app.post("/ap/groups", authRequired, async (c) => {
  const body = await c.req.json();
  if (
    typeof body !== "object" ||
    typeof body.owner !== "string" ||
    typeof body.name !== "string" ||
    !Array.isArray(body.members)
  ) {
    return jsonResponse(c, { error: "invalid group" }, 400);
  }
  const room = {
    id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
    name: body.name,
    members: body.members.filter((m: unknown) => typeof m === "string"),
  };
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(body.owner);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  await db.addGroup(body.owner, room);
  const domain = getDomain(c);
  const actor = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/ap/groups/${room.id}`,
    type: "Group",
    name: room.name,
    members: room.members,
  };
  return jsonResponse(c, actor, 201, "application/activity+json");
});

// メンバー変更 (Add/Remove または MLS Proposal)
app.post("/ap/groups/:id/members", authRequired, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const db = createDB(getEnv(c));
  const result = await db.findGroup(id);
  if (!result) return jsonResponse(c, { error: "Group not found" }, 404);
  const { owner, group: room } = result;
  const account = await db.findAccountById(owner);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const domain = getDomain(c);

  if (body.type === "Add" && typeof body.object === "string") {
    if (!room.members.includes(body.object)) {
      room.members.push(body.object);
      await db.updateGroup(owner, room);
    }
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Add",
      actor: `https://${domain}/ap/groups/${id}`,
      object: body.object,
      target: `https://${domain}/ap/groups/${id}`,
    };
    deliverActivityPubObject(
      room.members,
      activity,
      account.userName,
      domain,
      getEnv(c),
    ).catch((err) => console.error("Delivery failed:", err));
    return jsonResponse(c, { members: room.members });
  }

  if (body.type === "Remove" && typeof body.object === "string") {
    room.members = room.members.filter((m) => m !== body.object);
    await db.updateGroup(owner, room);
    const activity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Remove",
      actor: `https://${domain}/ap/groups/${id}`,
      object: body.object,
      target: `https://${domain}/ap/groups/${id}`,
    };
    deliverActivityPubObject(
      room.members,
      activity,
      account.userName,
      domain,
      getEnv(c),
    ).catch((err) => console.error("Delivery failed:", err));
    return jsonResponse(c, { members: room.members });
  }

  if (body.type === "Proposal") {
    deliverActivityPubObject(
      room.members,
      body,
      account.userName,
      domain,
      getEnv(c),
    ).catch((err) => console.error("Delivery failed:", err));
    return jsonResponse(c, { members: room.members });
  }

  return jsonResponse(c, { error: "invalid activity" }, 400);
});

// --- 旧API 互換レイヤー ---
app.use("/accounts/*", authRequired);

app.get("/accounts/:id/groups", (c) => {
  const id = c.req.param("id");
  return c.redirect(`/ap/groups?owner=${id}`, 307);
});

app.post("/accounts/:id/groups", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  if (
    typeof body !== "object" ||
    typeof body.name !== "string" ||
    !Array.isArray(body.members)
  ) {
    return jsonResponse(c, { error: "invalid group" }, 400);
  }
  const room = {
    id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
    name: body.name,
    members: body.members.filter((m: unknown) => typeof m === "string"),
  };
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const groups = await db.addGroup(id, room);
  return jsonResponse(c, { groups });
});

app.delete("/accounts/:id/groups", async (c) => {
  const id = c.req.param("id");
  const { id: groupId } = await c.req.json();
  if (typeof groupId !== "string") {
    return jsonResponse(c, { error: "invalid group id" }, 400);
  }
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const groups = await db.removeGroup(id, groupId);
  return jsonResponse(c, { groups });
});

export default app;
