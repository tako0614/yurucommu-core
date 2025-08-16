import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import { rateLimit } from "../utils/rate_limit.ts";
import {
  type ActivityPubActor,
  buildActivityFromStored,
  createAddActivity,
  createCreateActivity,
  createDeleteActivity,
  createObjectId,
  createRemoveActivity,
  deliverActivityPubObject,
  fetchJson,
  getDomain,
  jsonResponse,
  resolveActor,
} from "../utils/activitypub.ts";
import { deliverToFollowers } from "../utils/deliver.ts";
import { sendToUser } from "./ws.ts";
import { extractBasicCredentialIdentity } from "../utils/basic_credential.ts";
// MLS関連処理はクライアント側で完結するが、最低限の検証は行う

interface ActivityPubActivity {
  [key: string]: unknown;
  "@context"?: unknown;
  to?: unknown;
  cc?: unknown;
}

interface RemoteActorCache {
  actorUrl: string;
}

// KeyPackage 情報の簡易的な型定義
export interface KeyPackageDoc {
  _id?: unknown;
  content: string;
  mediaType: string;
  encoding: string;
  groupInfo?: string;
  expiresAt?: unknown;
  used?: boolean;
  version?: string;
  cipherSuite?: number;
  generator?: string;
  deviceId?: string;
  createdAt: string | number | Date;
}

interface EncryptedKeyPairDoc {
  content: string;
}

interface EncryptedMessageDoc {
  _id?: unknown;
  roomId?: string;
  from: string;
  to: string[];
  content: string;
  mediaType: string;
  encoding: string;
  createdAt: unknown;
  extra?: { attachments?: unknown[] };
}

interface HandshakeMessageDoc {
  _id?: unknown;
  roomId?: string;
  sender: string;
  recipients: string[];
  message: string;
  createdAt: unknown;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function resolveActorCached(
  acct: string,
  env: Record<string, string>,
) {
  const [name, host] = acct.split("@");
  if (!name || !host) return null;

  const db = createDB(env);
  const cached = await db.findRemoteActorByUrl(
    acct.startsWith("http") ? acct : "",
  ) as RemoteActorCache | null;

  let actor:
    | (ActivityPubActor & { keyPackages?: string | { id?: string } })
    | null = null;
  if (cached) {
    try {
      actor = await fetchJson<
        ActivityPubActor & { keyPackages?: string | { id?: string } }
      >(
        cached.actorUrl,
        {},
        undefined,
        env,
      );
    } catch (err) {
      console.error(`Failed to fetch cached actor ${cached.actorUrl}:`, err);
    }
  }

  if (!actor) {
    actor = await resolveActor(name, host) as
      | (ActivityPubActor & { keyPackages?: string | { id?: string } })
      | null;
    if (actor) {
      await db.upsertRemoteActor({
        actorUrl: actor.id,
        name: actor.name || "",
        preferredUsername: actor.preferredUsername || "",
        icon: actor.icon || null,
        summary: actor.summary || "",
      });
    }
  }

  return actor;
}

// KeyPackage の選択ロジックをテストから利用できるよう公開
export function selectKeyPackages(
  list: KeyPackageDoc[],
  suite: number,
  M = 3,
): KeyPackageDoc[] {
  return list
    .filter((kp) =>
      kp.version === "1.0" && kp.cipherSuite === suite && kp.used !== true
    )
    .sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return db - da;
    })
    .reduce((acc: KeyPackageDoc[], kp) => {
      if (kp.generator && acc.some((v) => v.generator === kp.generator)) {
        return acc;
      }
      acc.push(kp);
      return acc;
    }, [])
    .slice(0, M);
}

const app = new Hono();

async function handleHandshake(
  env: Record<string, string>,
  domain: string,
  roomId: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; id: string }
  | { ok: false; status: number; error: string }
> {
  const { from, to, content, mediaType, encoding, attachments } = body as {
    from?: unknown;
    to?: unknown;
    content?: unknown;
    mediaType?: unknown;
    encoding?: unknown;
    attachments?: unknown;
  };
  if (typeof from !== "string" || typeof content !== "string") {
    return { ok: false, status: 400, error: "invalid body" };
  }
  if (!Array.isArray(to) || to.some((v) => typeof v !== "string")) {
    return { ok: false, status: 400, error: "invalid recipients" };
  }
  const [sender] = from.split("@");
  if (!sender) {
    return { ok: false, status: 400, error: "invalid user format" };
  }
  const context = Array.isArray(body["@context"])
    ? body["@context"] as string[]
    : [
      "https://www.w3.org/ns/activitystreams",
      "https://purl.archive.org/socialweb/mls",
    ];
  const db = createDB(env);
  const found = await db.findChatroom(roomId);
  if (!found) return { ok: false, status: 404, error: "room not found" };
  // 宛先はクライアント（MLS ロスター）から供給されたものを使用
  const recipients = Array.from(
    new Set((to as string[]).filter((m) => m && m !== from)),
  );
  if (recipients.length === 0) {
    return { ok: false, status: 400, error: "no recipients" };
  }

  const mType = typeof mediaType === "string" ? mediaType : "message/mls";
  const encType = typeof encoding === "string" ? encoding : "base64";

  // --- MLS TLV デコードで種別判定 (client の mls_message.ts と整合) ---
  function decodeMlsEnvelope(
    b64: string,
  ): { type: string; body: Uint8Array } | null {
    try {
      const raw = atob(b64);
      const bin = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
      if (bin.length < 3) return null;
      const typeByte = bin[0];
      const len = (bin[1] << 8) | bin[2];
      if (bin.length < 3 + len) return null;
      const typeMap: Record<number, string> = {
        1: "PublicMessage",
        2: "PrivateMessage",
        3: "Welcome",
        4: "KeyPackage",
        5: "Commit",
        6: "Proposal",
        7: "GroupInfo",
      };
      return { type: typeMap[typeByte] ?? "", body: bin.subarray(3, 3 + len) };
    } catch {
      return null;
    }
  }
  const envelope = decodeMlsEnvelope(content);

  // If it's a welcome for a local member, save as PendingInvite and skip inbox delivery
  if (envelope && envelope.type === "Welcome") {
    // Welcome の本体は MLS Welcome 構造(バイナリ)で actor 情報は外側活動に含まれない。
    // 仕様整合: ローカル Actor の他端末へは inbox 送信せずサーバ保管 (PendingInvite)
    // 判定: from(送信者) は既存メンバー。ローカル他端末用 Welcome かどうかは
    // "local only" ポリシーに従い: 送信者と同じドメインのルーム内メンバーに限り保存。
    // 各ローカルメンバー全端末に同一 Welcome を再利用できるので sender 自身以外のローカルメンバーを保存対象とする。
    const localMembers = recipients.filter((m) =>
      m.endsWith(`@${domain}`)
    );
    if (localMembers.length > 0) {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      for (const lm of localMembers) {
        const uname = lm.split("@")[0];
        await db.savePendingInvite(roomId, uname, "", expiresAt);
        sendToUser(lm, {
          type: "pendingInvite",
          payload: { roomId, from, welcomeB64: content },
        });
      }
      return { ok: true, id: "pending" };
    }
  }

  const msg = await db.createHandshakeMessage({
    roomId,
    sender: from,
    recipients,
    message: content,
  }) as HandshakeMessageDoc;

  const extra: Record<string, unknown> = {
    mediaType: mType,
    encoding: encType,
  };
  if (Array.isArray(attachments)) {
    extra.attachments = attachments;
  }

  // Save message; if it's a remote welcome, we'll mark object type as Welcome when building activity
  const object = await db.saveMessage(
    domain,
    sender,
    content,
    extra,
    { to: recipients, cc: [] },
  );
  const saved = object as Record<string, unknown>;
  const activityObj = buildActivityFromStored(
    {
      ...saved,
      type: "PublicMessage",
    } as {
      _id: unknown;
      type: string;
      content: string;
      published: unknown;
      extra: Record<string, unknown>;
    },
    domain,
    sender,
    false,
  );
  (activityObj as ActivityPubActivity)["@context"] = context;

  const actorId = `https://${domain}/users/${sender}`;
  const activity = createCreateActivity(domain, actorId, activityObj);
  (activity as ActivityPubActivity)["@context"] = context;
  (activity as ActivityPubActivity).to = recipients;
  (activity as ActivityPubActivity).cc = [];

  // If it's a welcome for a remote actor, deliver to that actor's inbox only
  if (envelope && envelope.type === "Welcome") {
    // リモート宛: 既存ロジック（ルーム全員への deliver）ではなく
    // 仕様準拠: ルームのリモートメンバー inbox へ個別配送 (Welcome Object)
    const remoteMembers = recipients.filter((m) => !m.endsWith(`@${domain}`));
    if (remoteMembers.length > 0) {
      const welcomeObj = {
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://purl.archive.org/socialweb/mls",
        ],
        id: createObjectId(domain, "objects"),
        type: ["Object", "Welcome"],
        attributedTo: `https://${domain}/users/${sender}`,
        content: content,
      };
      const welcomeActivity = createCreateActivity(
        domain,
        `https://${domain}/users/${sender}`,
        welcomeObj,
      );
      (welcomeActivity as ActivityPubActivity)["@context"] = context;
      try {
        await deliverActivityPubObject(
          remoteMembers,
          welcomeActivity,
          sender,
          domain,
          env,
        );
      } catch (err) {
        console.error("deliver remote welcome failed", err);
      }
      const newMsg = {
        id: String(msg._id),
        roomId,
        sender: from,
        recipients: remoteMembers,
        message: content,
        createdAt: msg.createdAt,
      };
      sendToUser(from, { type: "publicMessage", payload: newMsg });
      return { ok: true, id: String(msg._id) };
    }
  }

  // default: deliver as before
  deliverActivityPubObject(recipients, activity, sender, domain, env).catch(
    (err) => {
      console.error("deliver failed", err);
    },
  );

  const newMsg = {
    id: String(msg._id),
    roomId,
    sender: from,
    recipients: recipients,
    message: content,
    createdAt: msg.createdAt,
  };
  sendToUser(from, { type: "publicMessage", payload: newMsg });
  for (const t of recipients) {
    sendToUser(t, { type: "publicMessage", payload: newMsg });
  }

  return { ok: true, id: String(msg._id) };
}

// ルーム管理 API (ActivityPub 対応)

// ActivityPub ルーム一覧取得
// --- ルームメタ一覧 API（明示作成されたもののみ） ---
// GET /api/rooms?owner=:id
// - サーバが保持するメタデータ（id, name, icon）のみ返却
// - 検索・フィルタは行わない（クライアント側実装）
app.get("/rooms", authRequired, async (c) => {
  const owner = c.req.query("owner");
  if (!owner) return jsonResponse(c, { error: "missing owner" }, 400);
  const db = createDB(getEnv(c));
  const account = await db.findAccountById(owner);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const list = await db.listChatrooms(owner);
  return jsonResponse(c, {
    rooms: list.map((r) => ({ id: r.id, name: r.name, icon: r.icon ?? "" })),
  });
});

// Get pending invites for a local user (non-acked)
app.get("/users/:user/pendingInvites", authRequired, async (c) => {
  const user = c.req.param("user");
  const env = getEnv(c);
  const db = createDB(env);
  try {
    const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
    const list = await db.findPendingInvites({
      userName: user,
      acked: false,
      tenant_id: tenantId,
    });
    return c.json(list);
  } catch (err) {
    console.error("failed to fetch pending invites", err);
    return jsonResponse(c, { error: "failed" }, 500);
  }
});

// Ack a pending invite: { roomId, deviceId }
app.post("/users/:user/pendingInvites/ack", authRequired, async (c) => {
  const user = c.req.param("user");
  const body = await c.req.json();
  if (!body || typeof body.roomId !== "string") {
    return jsonResponse(c, { error: "invalid" }, 400);
  }
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const env = getEnv(c);
  const db = createDB(env);
  try {
    await db.markInviteAcked(body.roomId, user, deviceId);
    return c.json({ ok: true });
  } catch (err) {
    console.error("failed to mark invite acked", err);
    return jsonResponse(c, { error: "failed" }, 500);
  }
});

// ルームアクター取得
app.get("/ap/rooms/:id", async (c) => {
  const id = c.req.param("id");
  const db = createDB(getEnv(c));
  const result = await db.findChatroom(id);
  if (!result) return jsonResponse(c, { error: "Room not found" }, 404);
  const { room } = result;
  const domain = getDomain(c);
  const actor = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/ap/rooms/${id}`,
    type: "Group",
    name: room.name,
    // members は公開しない
  };
  return jsonResponse(c, actor, 200, "application/activity+json");
});

// ルーム作成
app.post("/ap/rooms", authRequired, async (c) => {
  const body = await c.req.json();
  if (
    typeof body !== "object" ||
    typeof body.owner !== "string" ||
    typeof body.name !== "string"
  ) {
    return jsonResponse(c, { error: "invalid room" }, 400);
  }
  const env = getEnv(c);
  const db = createDB(env);
  const account = await db.findAccountById(body.owner);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);

  // 1:1 未設定名（DM）重複防止: 同一メンバー構成・nameが空の既存ルームを再利用
  const existingList = await db.listChatrooms(body.owner);
  const existing = existingList.find((g) => {
    const hasName = !!(g.name && String(g.name).trim() !== "");
    if (hasName) return false;
    // 互換性を保たず、メンバー構成による再利用は行わない
    return false;
  });
  // 新しいトーク開始時に自動保存しない。
  // 既存ルームが見つからず、名前もアイコンも指定なしなら作成しない。
  const hasName = typeof body.name === "string" && body.name.trim() !== "";
  const hasIcon = typeof body.icon === "string" && body.icon.trim() !== "";
  if (!existing && !hasName && !hasIcon) {
    return jsonResponse(c, { error: "room metadata required" }, 400);
  }
  const room = existing ?? {
    id: typeof body.id === "string" ? body.id : crypto.randomUUID(),
    name: hasName ? body.name : "",
    icon: hasIcon ? body.icon : "",
    // サーバはメンバー情報を保持しない（メタのみ）
    members: [],
  };
  if (!existing) {
    await db.addChatroom(body.owner, room);
  }
  const domain = getDomain(c);
  const actor = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `https://${domain}/ap/rooms/${room.id}`,
    type: "Group",
    name: room.name,
    // members は返さない
  };
  if (body.handshake && typeof body.handshake === "object") {
    const hs = await handleHandshake(env, domain, room.id, body.handshake);
    if (!hs.ok) {
      return jsonResponse(c, { error: hs.error }, hs.status);
    }
  }
  return jsonResponse(c, actor, 201, "application/activity+json");
});

app.get("/users/:user/keyPackages", authRequired, async (c) => {
  const identifier = c.req.param("user");
  const domain = getDomain(c);

  const [user, host] = identifier.split("@");
  if (!host || host === domain) {
    const username = user ?? identifier;
    const db = createDB(getEnv(c));
    const list = await db.listKeyPackages(username) as KeyPackageDoc[];
    const items = list.map((doc) => ({
      id: `https://${domain}/users/${username}/keyPackages/${doc._id}`,
      type: "KeyPackage",
      content: doc.content,
      mediaType: doc.mediaType,
      encoding: doc.encoding,
      groupInfo: doc.groupInfo,
      expiresAt: doc.expiresAt,
      version: doc.version,
      cipherSuite: doc.cipherSuite,
      generator: doc.generator,
      createdAt: doc.createdAt,
    }));
    return c.json({ type: "Collection", items });
  }

  const acct = identifier;

  const actor = await resolveActorCached(
    acct,
    getEnv(c),
  );
  if (!actor) return c.json({ type: "Collection", items: [] });
  const kpUrl = typeof actor.keyPackages === "string"
    ? actor.keyPackages
    : actor.keyPackages?.id;
  if (!kpUrl) return c.json({ type: "Collection", items: [] });

  try {
    const col = await fetchJson<{ items?: unknown[] }>(
      kpUrl,
      {},
      undefined,
      getEnv(c),
    );
    const items = Array.isArray(col.items) ? col.items : [];
    return c.json({ type: "Collection", items });
  } catch (_err) {
    console.error("remote keyPackages fetch failed", _err);
    return c.json({ type: "Collection", items: [] });
  }
});

app.get("/users/:user/keyPackages/:keyId", async (c) => {
  const user = c.req.param("user");
  const keyId = c.req.param("keyId");
  const domain = getDomain(c);
  const db = createDB(getEnv(c));
  const doc = await db.findKeyPackage(user, keyId) as KeyPackageDoc | null;
  if (!doc) return c.body("Not Found", 404);
  await db.markKeyPackageUsed(user, keyId);
  await db.cleanupKeyPackages(user);
  const object = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://purl.archive.org/socialweb/mls",
    ],
    id: `https://${domain}/users/${user}/keyPackages/${keyId}`,
    type: "KeyPackage",
    attributedTo: `https://${domain}/users/${user}`,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    mediaType: doc.mediaType,
    encoding: doc.encoding,
    content: doc.content,
    groupInfo: doc.groupInfo,
    expiresAt: doc.expiresAt,
    deviceId: doc.deviceId,
    version: doc.version,
    cipherSuite: doc.cipherSuite,
    generator: doc.generator,
  };
  return c.json(object);
});

app.post("/users/:user/keyPackages", authRequired, async (c) => {
  const user = c.req.param("user");
  const {
    content,
    mediaType,
    encoding,
    groupInfo,
    expiresAt,
    deviceId,
    version,
    cipherSuite,
    generator,
  } = await c.req.json();
  if (typeof content !== "string") {
    return c.json({ error: "content is required" }, 400);
  }
  const domain = getDomain(c);
  const actorId = `https://${domain}/users/${user}`;
  // BasicCredential.identity と Actor の URL を照合
  try {
    const id = extractBasicCredentialIdentity(b64ToBytes(content));
    if (!id) {
      return c.json(
        { error: "ap_mls.binding.policy_violation" },
        400,
      );
    }
    if (id !== actorId) {
      return c.json({ error: "ap_mls.binding.identity_mismatch" }, 400);
    }
  } catch (err) {
    console.error("KeyPackage verification failed", err);
    return c.json({ error: "ap_mls.binding.policy_violation" }, 400);
  }
  const db = createDB(getEnv(c));
  const gi = typeof groupInfo === "string" ? groupInfo : undefined;
  const pkg = await db.createKeyPackage(
    user,
    content,
    mediaType,
    encoding,
    gi,
    expiresAt ? new Date(expiresAt) : undefined,
    typeof deviceId === "string" ? deviceId : undefined,
    typeof version === "string" ? version : undefined,
    typeof cipherSuite === "number" ? cipherSuite : undefined,
    typeof generator === "string" ? generator : undefined,
  ) as KeyPackageDoc;
  await db.cleanupKeyPackages(user);
  const keyObj = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://purl.archive.org/socialweb/mls",
    ],
    id: `https://${domain}/users/${user}/keyPackages/${pkg._id}`,
    type: "KeyPackage",
    attributedTo: actorId,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    mediaType: pkg.mediaType,
    encoding: pkg.encoding,
    content: pkg.content,
    groupInfo: pkg.groupInfo,
    expiresAt: pkg.expiresAt,
    deviceId: pkg.deviceId,
    version: pkg.version,
    cipherSuite: pkg.cipherSuite,
    generator: pkg.generator,
  };
  // Key Transparency ログへの追記
  try {
    const bin = atob(pkg.content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    const toHex = (arr: Uint8Array) =>
      Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
    const hash = toHex(new Uint8Array(buf));
    await fetch(`https://${domain}/.well-known/key-transparency/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor: actorId,
        keyPackageUrl: keyObj.id,
        keyPackageHash: hash,
      }),
    });
  } catch (err) {
    console.error("KT append failed", err);
  }
  const addActivity = createAddActivity(domain, actorId, keyObj);
  await deliverToFollowers(getEnv(c), user, addActivity, domain);
  return c.json({
    result: "ok",
    keyId: String(pkg._id),
    groupInfo: pkg.groupInfo,
  });
});

app.delete("/users/:user/keyPackages/:keyId", authRequired, async (c) => {
  const user = c.req.param("user");
  const keyId = c.req.param("keyId");
  const domain = getDomain(c);
  const db = createDB(getEnv(c));
  await db.deleteKeyPackage(user, keyId);
  await db.cleanupKeyPackages(user);
  const actorId = `https://${domain}/users/${user}`;
  const removeActivity = createRemoveActivity(
    domain,
    actorId,
    `https://${domain}/users/${user}/keyPackages/${keyId}`,
  );
  const deleteActivity = createDeleteActivity(
    domain,
    actorId,
    `https://${domain}/users/${user}/keyPackages/${keyId}`,
  );
  await deliverToFollowers(getEnv(c), user, removeActivity, domain);
  await deliverToFollowers(getEnv(c), user, deleteActivity, domain);
  return c.json({ result: "removed" });
});

app.get(
  "/users/:user/devices/:device/encryptedKeyPair",
  authRequired,
  async (c) => {
    const user = c.req.param("user");
    const device = c.req.param("device");
    const db = createDB(getEnv(c));
    const doc = await db.findEncryptedKeyPair(
      user,
      device,
    ) as EncryptedKeyPairDoc | null;
    if (!doc) return c.json({ content: null });
    return c.json({ content: doc.content });
  },
);

app.post(
  "/users/:user/devices/:device/encryptedKeyPair",
  authRequired,
  async (c) => {
    const user = c.req.param("user");
    const device = c.req.param("device");
    const { content } = await c.req.json();
    if (typeof content !== "string") {
      return c.json({ error: "invalid body" }, 400);
    }
    const db = createDB(getEnv(c));
    await db.upsertEncryptedKeyPair(user, device, content);
    return c.json({ result: "ok" });
  },
);

app.delete(
  "/users/:user/devices/:device/encryptedKeyPair",
  authRequired,
  async (c) => {
    const user = c.req.param("user");
    const device = c.req.param("device");
    const db = createDB(getEnv(c));
    await db.deleteEncryptedKeyPair(user, device);
    return c.json({ result: "removed" });
  },
);

app.post("/users/:user/resetKeys", authRequired, async (c) => {
  const user = c.req.param("user");
  const domain = getDomain(c);
  const actorId = `https://${domain}/users/${user}`;
  const db = createDB(getEnv(c));
  const keyPkgs = await db.listKeyPackages(user) as KeyPackageDoc[];
  for (const pkg of keyPkgs) {
    const removeActivity = createRemoveActivity(
      domain,
      actorId,
      `https://${domain}/users/${user}/keyPackages/${pkg._id}`,
    );
    const deleteActivity = createDeleteActivity(
      domain,
      actorId,
      `https://${domain}/users/${user}/keyPackages/${pkg._id}`,
    );
    await deliverToFollowers(getEnv(c), user, removeActivity, domain);
    await deliverToFollowers(getEnv(c), user, deleteActivity, domain);
  }
  await db.deleteKeyPackagesByUser(user);
  await db.deleteEncryptedKeyPairsByUser(user);
  return c.json({ result: "reset" });
});

app.post(
  "/rooms/:room/messages",
  authRequired,
  rateLimit({ windowMs: 60_000, limit: 20 }),
  async (c) => {
    const roomId = c.req.param("room");
    const body = await c.req.json();
    const { from, to, content, mediaType, encoding, attachments } = body as {
      from?: unknown;
      to?: unknown;
      content?: unknown;
      mediaType?: unknown;
      encoding?: unknown;
      attachments?: unknown;
    };
    if (
      typeof from !== "string" ||
      typeof content !== "string"
    ) {
      return c.json({ error: "invalid body" }, 400);
    }
    if (!Array.isArray(to) || to.some((v) => typeof v !== "string")) {
      return c.json({ error: "invalid recipients" }, 400);
    }
    const [sender, senderDomain] = from.split("@");
    if (!sender || !senderDomain) {
      return c.json({ error: "invalid user format" }, 400);
    }
    const context = Array.isArray(body["@context"])
      ? body["@context"] as string[]
      : [
        "https://www.w3.org/ns/activitystreams",
        "https://purl.archive.org/socialweb/mls",
      ];
    const domain = getDomain(c);
    const env = getEnv(c);
    const db = createDB(env);
    const found = await db.findChatroom(roomId);
    if (!found) return c.json({ error: "room not found" }, 404);
    // 宛先はクライアント提供（MLS ロスター由来）を使用
    const recipients = Array.from(
      new Set((to as string[]).filter((m) => m && m !== from)),
    );
    if (recipients.length === 0) {
      return c.json({ error: "no recipients" }, 400);
    }

    const mType = typeof mediaType === "string" ? mediaType : "message/mls";
    const encType = typeof encoding === "string" ? encoding : "base64";
    const storedContent = typeof content === "string" ? content : "";
    const msg = await db.createEncryptedMessage({
      roomId,
      from,
      to: recipients,
      content: storedContent,
      mediaType: mType,
      encoding: encType,
    }) as EncryptedMessageDoc;

    const extra: Record<string, unknown> = {
      mediaType: mType,
      encoding: encType,
    };
    if (Array.isArray(attachments)) {
      extra.attachments = attachments;
    }

    const object = await db.saveMessage(
      domain,
      sender,
      storedContent,
      extra,
      { to: recipients, cc: [] },
    );
    const saved = object as Record<string, unknown>;

    const activityObj = buildActivityFromStored(
      {
        ...saved,
        type: "PrivateMessage",
      } as {
        _id: unknown;
        type: string;
        content: string;
        published: unknown;
        extra: Record<string, unknown>;
      },
      domain,
      sender,
      false,
    );
    (activityObj as ActivityPubActivity)["@context"] = context;

    const actorId = `https://${domain}/users/${sender}`;
    const activity = createCreateActivity(domain, actorId, activityObj);
    (activity as ActivityPubActivity)["@context"] = context;
    (activity as ActivityPubActivity).to = recipients;
    (activity as ActivityPubActivity).cc = [];
    deliverActivityPubObject(recipients, activity, sender, domain, env).catch(
      (err) => {
        console.error("deliver failed", err);
      },
    );

    const newMsg = {
      id: String(msg._id),
      roomId,
      from,
      to: recipients,
      content: storedContent,
      mediaType: msg.mediaType,
      encoding: msg.encoding,
      createdAt: msg.createdAt,
      attachments: Array.isArray(attachments)
        ? attachments.map((att, idx) => {
          const a = att as Record<string, unknown>;
          if (typeof a.url === "string") {
            return {
              url: a.url,
              mediaType: typeof a.mediaType === "string"
                ? a.mediaType
                : "application/octet-stream",
              key: a.key,
              iv: a.iv,
            };
          }
          return {
            url: `https://${domain}/api/files/messages/${msg._id}/${idx}`,
            mediaType: (a.mediaType as string) || "application/octet-stream",
            key: a.key as string | undefined,
            iv: a.iv as string | undefined,
          };
        })
        : undefined,
    };
    sendToUser(from, { type: "encryptedMessage", payload: newMsg });
    for (const t of recipients) {
      sendToUser(t, { type: "encryptedMessage", payload: newMsg });
    }

    return c.json({ result: "sent", id: String(msg._id) });
  },
);

app.post(
  "/rooms/:room/handshakes",
  authRequired,
  rateLimit({ windowMs: 60_000, limit: 20 }),
  async (c) => {
    const roomId = c.req.param("room");
    const body = await c.req.json();
    const domain = getDomain(c);
    const env = getEnv(c);
    const result = await handleHandshake(env, domain, roomId, body);
    if (!result.ok) {
      return jsonResponse(c, { error: result.error }, result.status);
    }
    return c.json({ result: "sent", id: result.id });
  },
);

app.get("/rooms/:room/messages", authRequired, async (c) => {
  const roomId = c.req.param("room");
  const limit = Math.min(
    parseInt(c.req.query("limit") ?? "50", 10) || 50,
    100,
  );
  const before = c.req.query("before");
  const after = c.req.query("after");
  const db = createDB(getEnv(c));
  const sid = getCookie(c, "sessionId");
  if (sid) {
    await db.updateSessionActivity(sid);
  }
  const list = await db.findEncryptedMessages({ roomId }, {
    before: before ?? undefined,
    after: after ?? undefined,
    limit,
  }) as EncryptedMessageDoc[];
  list.sort((a, b) => {
    const dateA =
      typeof a.createdAt === "string" || typeof a.createdAt === "number" ||
        a.createdAt instanceof Date
        ? new Date(a.createdAt)
        : new Date(0);
    const dateB =
      typeof b.createdAt === "string" || typeof b.createdAt === "number" ||
        b.createdAt instanceof Date
        ? new Date(b.createdAt)
        : new Date(0);
    return dateA.getTime() - dateB.getTime();
  });
  list.reverse();
  const domain = getDomain(c);
  const messages = list.slice(0, limit).map((doc) => ({
    id: String(doc._id),
    roomId: doc.roomId,
    from: doc.from,
    to: doc.to,
    content: doc.content,
    mediaType: doc.mediaType,
    encoding: doc.encoding,
    createdAt: doc.createdAt,
    attachments:
      Array.isArray((doc.extra as Record<string, unknown>)?.attachments)
        ? (doc.extra as { attachments: unknown[] }).attachments.map(
          (att: unknown, idx: number) => {
            const a = att as Record<string, unknown>;
            if (typeof a.url === "string") {
              return {
                url: a.url,
                mediaType: typeof a.mediaType === "string"
                  ? a.mediaType
                  : "application/octet-stream",
                key: a.key,
                iv: a.iv,
              };
            }
            return {
              url: `https://${domain}/api/files/messages/${doc._id}/${idx}`,
              mediaType: (a.mediaType as string) || "application/octet-stream",
              key: a.key as string | undefined,
              iv: a.iv as string | undefined,
            };
          },
        )
        : undefined,
  }));
  return c.json(messages);
});

app.get("/rooms/:room/handshakes", authRequired, async (c) => {
  const roomId = c.req.param("room");
  const limit = Math.min(
    parseInt(c.req.query("limit") ?? "50", 10) || 50,
    100,
  );
  const before = c.req.query("before");
  const after = c.req.query("after");
  const db = createDB(getEnv(c));
  const list = await db.findHandshakeMessages({ roomId }, {
    before: before ?? undefined,
    after: after ?? undefined,
    limit,
  }) as HandshakeMessageDoc[];
  const messages = list.map((doc) => ({
    id: String(doc._id),
    roomId: doc.roomId,
    sender: doc.sender,
    recipients: doc.recipients,
    message: doc.message,
    createdAt: doc.createdAt,
  }));
  return c.json(messages);
});

export default app;
