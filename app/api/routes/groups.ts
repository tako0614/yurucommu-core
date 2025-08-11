import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import {
  deliverActivityPubObject,
  getDomain,
  jsonResponse,
} from "../utils/activitypub.ts";
// 直接モデルを参照せず、DB 抽象を通して取得することで
// local / host いずれのモードでも同じコードで動くようにする

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
  const requestedMembers = body.members.filter((m: unknown) =>
    typeof m === "string"
  );
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(body.owner);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);

  const room = {
    id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
    name: body.name,
    icon: typeof body.icon === "string" ? body.icon : "",
    userSet: {
      name: !!(body.name && String(body.name).trim() !== ""),
      icon: !!(body.icon && String(body.icon).trim() !== ""),
    },
    members: requestedMembers,
  };
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
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const requestedMembers = body.members.filter((m: unknown) =>
    typeof m === "string"
  );
  await db.addGroup(id, {
    id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
    name: body.name,
    icon: typeof body.icon === "string" ? body.icon : "",
    userSet: {
      name: !!(body.name && String(body.name).trim() !== ""),
      icon: !!(body.icon && String(body.icon).trim() !== ""),
    },
    members: requestedMembers,
  } as unknown as { id: string; name: string; members: string[] });
  const groups = await db.listGroups(id);
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

// --- ルーム検索API（単一モデル／ファセット） ---
// GET /api/rooms?owner=:id&participants=u1,u2&match=all|any|none&hasName=true|false&hasIcon=true|false&members=eq:2|ge:3
app.get("/rooms", authRequired, async (c) => {
  const owner = c.req.query("owner");
  if (!owner) return jsonResponse(c, { error: "missing owner" }, 400);
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(owner);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const domain = getDomain(c);
  const ownerHandle = `${account.userName}@${domain}`;

  const qs = new URLSearchParams(c.req.url.split("?")[1] ?? "");
  const parts = (qs.get("participants") ?? "").split(",").map((s) => s.trim())
    .filter(Boolean);
  const match = (qs.get("match") ?? "all") as "all" | "any" | "none";
  const hasNameParam = qs.get("hasName");
  const hasIconParam = qs.get("hasIcon");
  const membersParam = qs.get("members"); // eq:2 | ge:3

  type Derived = {
    id: string;
    name: string;
    icon?: string;
    members: string[]; // others only
    hasName: boolean;
    hasIcon: boolean;
    membersCount: number;
    lastMessageAt?: Date;
  };

  const map = new Map<string, Derived>();

  const canonGroupKey = (members: string[]) =>
    `grp:${[...members].sort().join(",")}`;

  const applyParticipants = (participants: Set<string>, timestamp: Date) => {
    if (!participants.has(ownerHandle)) return;
    const others = [...participants].filter((m) => m !== ownerHandle);
    const membersCount = others.length + 1;
    const key = membersCount === 2
      ? others[0] // 1:1 は相手ハンドルをそのままIDとして扱う
      : canonGroupKey(others);
    const existing = map.get(key);
    if (existing) {
      if (!existing.lastMessageAt || existing.lastMessageAt < timestamp) {
        existing.lastMessageAt = timestamp;
      }
      return;
    }
    map.set(key, {
      id: key,
      name: "",
      icon: "",
      members: others,
      hasName: false,
      hasIcon: false,
      membersCount,
      lastMessageAt: timestamp,
    });
  };

  // 1) 暗号化メッセージ由来
  const encList = await db.findEncryptedMessages({
    $or: [{ from: ownerHandle }, { to: ownerHandle }],
  }, { limit: 500 }) as { from: string; to: string[]; createdAt: Date }[];
  for (const m of encList ?? []) {
    const participants = new Set<string>([m.from, ...m.to]);
    applyParticipants(participants, m.createdAt ?? new Date());
  }

  // 2) ハンドシェイク（不足分の補完）
  const hsList = await db.findHandshakeMessages({
    $or: [{ sender: ownerHandle }, { recipients: ownerHandle }],
  }, { limit: 200 }) as {
    sender: string;
    recipients: string[];
    createdAt: Date;
  }[];
  for (const h of hsList ?? []) {
    const participants = new Set<string>([h.sender, ...h.recipients]);
    applyParticipants(participants, h.createdAt ?? new Date());
  }

  // 3) グループメタデータ（名前・アイコン）
  const metaList = await db.listGroups(owner);
  for (const g of metaList ?? []) {
    const others = g.members.filter((m) => m !== ownerHandle);
    const membersCount = others.length + 1;
    const partnerKey = membersCount === 2 ? others[0] : canonGroupKey(others);
    const key = String(g.id);

    const existingByPartner = map.get(partnerKey);
    const lastMessageAt = existingByPartner?.lastMessageAt;
    // 保存済みルームは常に group.id をキーに独立表示し、
    // 相手ハンドル由来の一時キーは重複回避のため除去
    map.delete(partnerKey);

    map.set(key, {
      id: key,
      name: g.userSet?.name ? g.name : existingByPartner?.name ?? "",
      icon: g.userSet?.icon ? g.icon ?? "" : existingByPartner?.icon ?? "",
      members: others,
      hasName: !!g.userSet?.name,
      hasIcon: !!g.userSet?.icon,
      membersCount,
      lastMessageAt,
    });
  }

  let list = Array.from(map.values());

  if (parts.length > 0) {
    list = list.filter((r) => {
      const set = new Set(r.members);
      const matches = parts.map((p) => set.has(p));
      if (match === "all") return matches.every(Boolean);
      if (match === "any") return matches.some(Boolean);
      return matches.every((m) => !m);
    });
  }

  if (hasNameParam === "true") list = list.filter((r) => r.hasName);
  if (hasNameParam === "false") list = list.filter((r) => !r.hasName);
  if (hasIconParam === "true") list = list.filter((r) => r.hasIcon);
  if (hasIconParam === "false") list = list.filter((r) => !r.hasIcon);

  if (membersParam) {
    const [op, valStr] = membersParam.split(":");
    const val = Number(valStr);
    if (!Number.isNaN(val)) {
      if (op === "eq") list = list.filter((r) => r.membersCount === val);
      if (op === "ge") list = list.filter((r) => r.membersCount >= val);
    }
  }

  // 並び順: 最終メッセージ時刻の降順
  list.sort((a, b) =>
    (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0)
  );

  return jsonResponse(c, { rooms: list });
});
