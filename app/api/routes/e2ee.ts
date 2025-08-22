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
interface GeneratorInfo {
  id: string;
  type: string;
  name: string;
}

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
  generator?: string | GeneratorInfo;
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

async function registerKeyPackage(
  env: Record<string, string>,
  domain: string,
  db: ReturnType<typeof createDB>,
  user: string,
  data: Record<string, unknown>,
): Promise<
  | { keyId: string; groupInfo?: string; keyPackageRef?: string }
  | { error: string }
> {
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
    lastResort,
  } = data;

  if (typeof content !== "string") {
    return { error: "content is required" };
  }
  const mt = typeof mediaType === "string" && mediaType === "message/mls"
    ? mediaType
    : null;
  if (!mt) {
    return { error: 'mediaType must be "message/mls"' };
  }
  const enc = typeof encoding === "string" && encoding === "base64"
    ? encoding
    : null;
  if (!enc) {
    return { error: 'encoding must be "base64"' };
  }
  const actorId = `https://${domain}/users/${user}`;
  try {
    const id = extractBasicCredentialIdentity(b64ToBytes(content));
    if (!id) {
      return { error: "ap_mls.binding.policy_violation" };
    }
    if (id !== actorId) {
      return { error: "ap_mls.binding.identity_mismatch" };
    }
  } catch (_err) {
    return { error: "ap_mls.binding.policy_violation" };
  }
  const gi = typeof groupInfo === "string" ? groupInfo : undefined;
  let genObj: GeneratorInfo | undefined;
  if (
    typeof generator === "object" && generator &&
    typeof (generator as { id?: unknown }).id === "string" &&
    typeof (generator as { type?: unknown }).type === "string" &&
    typeof (generator as { name?: unknown }).name === "string"
  ) {
    genObj = {
      id: (generator as { id: string }).id,
      type: (generator as { type: string }).type,
      name: (generator as { name: string }).name,
    };
  } else if (typeof generator === "string") {
    genObj = { id: generator, type: "Application", name: generator };
  }
  const pkg = await db.createKeyPackage(
    user,
    content,
    mt,
    enc,
    gi,
    typeof expiresAt === "string" ? new Date(expiresAt) : undefined,
    typeof deviceId === "string" ? deviceId : undefined,
    typeof version === "string" ? version : undefined,
    typeof cipherSuite === "number" ? cipherSuite : undefined,
    genObj,
    undefined,
    typeof lastResort === "boolean" ? lastResort : undefined,
  ) as KeyPackageDoc;
  await db.cleanupKeyPackages(user);
  const keyObj = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://purl.archive.org/socialweb/mls",
    ],
    id: `https://${domain}/users/${user}/keyPackages/${pkg._id}`,
    type: ["Object", "KeyPackage"],
    attributedTo: actorId,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    mediaType: pkg.mediaType,
    encoding: pkg.encoding,
    summary:
      "This is binary-encoded cryptographic key package. See https://swicg.github.io/activitypub-e2ee/ …",
    content: pkg.content,
    groupInfo: pkg.groupInfo,
    expiresAt: pkg.expiresAt,
    version: pkg.version,
    cipherSuite: pkg.cipherSuite,
    generator: normalizeGenerator(pkg.generator),
    keyPackageRef: (pkg as { keyPackageRef?: string }).keyPackageRef,
    lastResort: (pkg as { lastResort?: boolean }).lastResort,
  };
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
  const createActivity = createCreateActivity(domain, actorId, keyObj);
  (createActivity as ActivityPubActivity).cc = [];
  await deliverToFollowers(env, user, createActivity, domain);
  const addActivity = createAddActivity(
    domain,
    actorId,
    createActivity.id,
    `https://${domain}/users/${user}/keyPackages`,
  );
  await deliverToFollowers(env, user, addActivity, domain);
  return {
    keyId: String(pkg._id),
    groupInfo: pkg.groupInfo,
    keyPackageRef: (pkg as { keyPackageRef?: string }).keyPackageRef,
  };
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

// Resolve a list of recipient identifiers (http URLs, acct:..., or user@host)
// to ActivityPub actor IRIs. Unresolvable entries are returned in `unresolved`.
async function resolveRecipientsToActorIris(
  recipients: string[],
  env: Record<string, string>,
): Promise<{ resolved: string[]; unresolved: string[] }> {
  const resolved: string[] = [];
  const unresolved: string[] = [];

  for (const r of recipients) {
    if (!r || typeof r !== "string") continue;
    // If it's already an absolute IRI, keep as-is
    if (r.startsWith("http")) {
      resolved.push(r);
      continue;
    }

    // Strip acct: prefix if present
    let acct = r;
    if (acct.startsWith("acct:")) acct = acct.slice(5);

    // Expect username@host
    if (acct.includes("@")) {
      try {
        const actor = await resolveActorCached(acct, env);
        if (actor && typeof actor.id === "string") {
          resolved.push(actor.id);
          continue;
        }
      } catch (err) {
        console.error("resolveActorCached failed for", acct, err);
      }
      // Could not resolve -> exclude and mark unresolved
      unresolved.push(r);
      continue;
    }

    // Unknown format -> mark unresolved
    unresolved.push(r);
  }

  return { resolved: Array.from(new Set(resolved)), unresolved };
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
      const g = typeof kp.generator === "string"
        ? kp.generator
        : kp.generator?.id;
      if (
        g &&
        acc.some((v) => {
          const vg = typeof v.generator === "string"
            ? v.generator
            : v.generator?.id;
          return vg === g;
        })
      ) {
        return acc;
      }
      acc.push(kp);
      return acc;
    }, [])
    .slice(0, M);
}

function normalizeGenerator(
  gen?: string | GeneratorInfo,
): GeneratorInfo | undefined {
  if (!gen) return undefined;
  if (typeof gen === "string") {
    return { id: gen, type: "Application", name: gen };
  }
  return gen;
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
  if (mediaType !== undefined && mediaType !== "message/mls") {
    return { ok: false, status: 400, error: "invalid mediaType" };
  }
  if (encoding !== undefined && encoding !== "base64") {
    return { ok: false, status: 400, error: "invalid encoding" };
  }
  // Public や followers などのコレクション URI を拒否
  const hasCollection = (to as string[]).some((v) => {
    if (v === "https://www.w3.org/ns/activitystreams#Public") return true;
    if (v.includes("/followers") || v.includes("/following")) {
      try {
        const path = v.startsWith("http") ? new URL(v).pathname : v;
        return path.endsWith("/followers") || path.endsWith("/following");
      } catch {
        return true;
      }
    }
    return false;
  });
  if (hasCollection) {
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
  ): { type: string; originalType: string; body: Uint8Array } | null {
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
      const originalType = typeMap[typeByte] ?? "";
      // Commit / Proposal は ActivityPub Object type として公開せず、PrivateMessage として扱う
      // （仕様で定義された表示用タイプのみ利用: PublicMessage / PrivateMessage / Welcome / KeyPackage / GroupInfo）
      const allowedExposure = new Set([
        "PublicMessage",
        "PrivateMessage",
        "Welcome",
        "KeyPackage",
        "GroupInfo",
      ]);
      let normalized = originalType;
      if (originalType === "Commit" || originalType === "Proposal") {
        normalized = "PrivateMessage"; // Handshake系を内部的には識別するが外部公開は PrivateMessage として統一
      }
      if (!allowedExposure.has(normalized)) normalized = "PublicMessage";
      return {
        type: normalized,
        originalType,
        body: bin.subarray(3, 3 + len),
      };
    } catch {
      return null;
    }
  }
  const envelope = decodeMlsEnvelope(content);
  const localTargets = envelope &&
      (envelope.originalType === "Welcome" ||
        envelope.originalType === "Commit")
    ? recipients.filter((m) => m.endsWith(`@${domain}`) && m !== from)
    : [];

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
      // 公開用タイプのみ利用（Commit / Proposal は decode 時点で PrivateMessage に正規化済み）
      type: envelope?.type ?? "PublicMessage",
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
  // Resolve recipients to actor IRIs (acct: or user@host) where possible.
  try {
    const { resolved, unresolved } = await resolveRecipientsToActorIris(
      recipients,
      env,
    );
    if (resolved.length === 0) {
      return { ok: false, status: 400, error: "no valid recipients" };
    }
    (activity as ActivityPubActivity).to = resolved;
    if (unresolved.length > 0) {
      console.warn("some recipients could not be resolved:", unresolved);
    }
  } catch (err) {
    console.error("failed to resolve recipients", err);
    return { ok: false, status: 500, error: "failed to resolve recipients" };
  }
  (activity as ActivityPubActivity).cc = [];

  const newMsg = {
    id: String(msg._id),
    roomId,
    sender: from,
    recipients: recipients,
    createdAt: msg.createdAt,
  };
  // REST-first: WebSocket は本文を渡さず軽量通知のみ送る
  sendToUser(from, {
    type: "hasUpdate",
    payload: { kind: "handshake", id: newMsg.id },
  });
  for (const t of recipients) {
    sendToUser(t, {
      type: "hasUpdate",
      payload: { kind: "handshake", id: newMsg.id },
    });
  }

  if (localTargets.length > 0) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    for (const lm of localTargets) {
      const uname = lm.split("@")[0];
      await db.savePendingInvite(roomId, uname, "", expiresAt);
      // pending invite の存在を軽量通知で送る
      sendToUser(lm, {
        type: "hasUpdate",
        payload: { kind: "pendingInvite", roomId },
      });
      try {
        // ローカルユーザー向けにサーバー側で通知を作成
        const acc = await db.findAccountByUserName(uname);
        if (acc && acc._id) {
          await db.createNotification(
            String(acc._id),
            "会話招待",
            JSON.stringify({ kind: "chat-invite", roomId, sender: from }),
            "chat-invite",
          );
          // 通知作成の存在を軽量通知で送る（詳細は /api/notifications で取得）
          sendToUser(lm, {
            type: "hasUpdate",
            payload: { kind: "notification", subtype: "chat-invite" },
          });
        }
      } catch (e) {
        console.error("failed to create invite notification", e);
      }
    }
  }

  // Welcome/Commit/Proposal などのハンドシェイクはリモートメンバーへ個別配送
  if (
    envelope &&
    ["Welcome", "Commit", "Proposal"].includes(envelope.originalType)
  ) {
    const remoteMembers = recipients.filter((m) => !m.endsWith(`@${domain}`));
    if (remoteMembers.length > 0) {
      for (const mem of remoteMembers) {
        let actorIri = "";
        try {
          const actor = await resolveActorCached(mem, env);
          if (actor?.id) actorIri = actor.id;
        } catch {
          // ignore
        }
        if (!actorIri) {
          if (mem.startsWith("http")) {
            actorIri = mem;
          } else {
            const [n, h] = mem.split("@");
            if (n && h) actorIri = `https://${h}/users/${n}`;
          }
        }

        const hsObj = {
          "@context": [
            "https://www.w3.org/ns/activitystreams",
            "https://purl.archive.org/socialweb/mls",
          ],
          id: createObjectId(domain, "objects"),
          // envelope.type は正規化済み（Commit/Proposal -> PrivateMessage）
          type: ["Object", envelope.type],
          attributedTo: `https://${domain}/users/${sender}`,
          content,
          mediaType: "message/mls",
          encoding: "base64",
          summary:
            "This is an encrypted private message. See https://swicg.github.io/activitypub-e2ee/ …",
        };

        if (hsObj.mediaType !== "message/mls" || hsObj.encoding !== "base64") {
          return {
            ok: false,
            status: 500,
            error:
              "ハンドシェイクオブジェクトに必要なフィールドが不足しています",
          };
        }

        const hsActivity = createCreateActivity(
          domain,
          `https://${domain}/users/${sender}`,
          hsObj,
        );
        (hsActivity as ActivityPubActivity)["@context"] = context;
        (hsActivity as ActivityPubActivity).to = [actorIri];
        (hsActivity as ActivityPubActivity).cc = [];

        try {
          await deliverActivityPubObject(
            [mem],
            hsActivity,
            sender,
            domain,
            env,
          );
        } catch (err) {
          console.error(
            `deliver remote ${envelope.type.toLowerCase()} failed for ${mem}`,
            err,
          );
        }
      }
    }
    return { ok: true, id: String(msg._id) };
  }

  // default: deliver as before
  deliverActivityPubObject(recipients, activity, sender, domain, env).catch(
    (err) => {
      console.error("deliver failed", err);
    },
  );

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
  return jsonResponse(c, { rooms: list.map((r) => ({ id: r.id })) });
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

// ルーム作成とハンドシェイク
app.post("/ap/rooms", authRequired, async (c) => {
  const body = await c.req.json();
  if (
    typeof body !== "object" ||
    typeof body.owner !== "string"
  ) {
    return jsonResponse(c, { error: "invalid room" }, 400);
  }
  const env = getEnv(c);
  const db = createDB(env);
  const account = await db.findAccountById(body.owner);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const id = typeof body.id === "string" ? body.id : crypto.randomUUID();
  await db.addChatroom(body.owner, { id });
  const domain = getDomain(c);
  if (body.handshake && typeof body.handshake === "object") {
    const hs = await handleHandshake(env, domain, id, body.handshake);
    if (!hs.ok) {
      return jsonResponse(c, { error: hs.error }, hs.status);
    }
  }
  return jsonResponse(c, { id }, 201, "application/json");
});

app.get(
  "/users/:user/keyPackages",
  rateLimit({ windowMs: 60_000, limit: 20 }),
  async (c) => {
    const identifier = c.req.param("user");
    const domain = getDomain(c);
    const summary = c.req.query("summary");

    const [user, host] = identifier.split("@");
    if (!host || host === domain) {
      const username = user ?? identifier;
      const db = createDB(getEnv(c));
      if (summary === "1" || summary === "true") {
        const info = await db.summaryKeyPackages(username);
        return c.json(info);
      }
      const list = await db.listKeyPackages(username) as KeyPackageDoc[];
      const items = list.map((doc) => ({
        "@context": [
          "https://www.w3.org/ns/activitystreams",
          "https://purl.archive.org/socialweb/mls",
        ],
        id: `https://${domain}/users/${username}/keyPackages/${doc._id}`,
        type: ["Object", "KeyPackage"],
        content: doc.content,
        mediaType: doc.mediaType,
        encoding: doc.encoding,
        summary:
          "This is binary-encoded cryptographic key package. See https://swicg.github.io/activitypub-e2ee/ …",
        groupInfo: doc.groupInfo,
        expiresAt: doc.expiresAt,
        version: doc.version,
        cipherSuite: doc.cipherSuite,
        generator: normalizeGenerator(doc.generator),
        createdAt: doc.createdAt,
        keyPackageRef: (doc as { keyPackageRef?: string }).keyPackageRef,
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
      // Ensure each remote item has @context and type array format
      const norm = items.map((it) => {
        const obj = it as Record<string, unknown>;
        const out: Record<string, unknown> = { ...obj };
        if (!Array.isArray(out["@context"])) {
          out["@context"] = [
            "https://www.w3.org/ns/activitystreams",
            "https://purl.archive.org/socialweb/mls",
          ];
        }
        const t = out.type;
        if (Array.isArray(t)) {
          out.type = t;
        } else if (typeof t === "string") {
          out.type = ["Object", t];
        } else {
          out.type = ["Object", "KeyPackage"];
        }
        if (typeof out.summary !== "string") {
          out.summary =
            "This is binary-encoded cryptographic key package. See https://swicg.github.io/activitypub-e2ee/ …";
        }
        return out;
      });
      return c.json({ type: "Collection", items: norm });
    } catch (_err) {
      console.error("remote keyPackages fetch failed", _err);
      return c.json({ type: "Collection", items: [] });
    }
  },
);

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
    type: ["Object", "KeyPackage"],
    attributedTo: `https://${domain}/users/${user}`,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    mediaType: doc.mediaType,
    encoding: doc.encoding,
    summary:
      "This is binary-encoded cryptographic key package. See https://swicg.github.io/activitypub-e2ee/ …",
    content: doc.content,
    groupInfo: doc.groupInfo,
    expiresAt: doc.expiresAt,
    version: doc.version,
    cipherSuite: doc.cipherSuite,
    generator: normalizeGenerator(doc.generator),
    keyPackageRef: (doc as { keyPackageRef?: string }).keyPackageRef,
  };
  return c.json(object);
});

app.post("/users/:user/keyPackages", authRequired, async (c) => {
  const user = c.req.param("user");
  const body = await c.req.json();
  const env = getEnv(c);
  const domain = getDomain(c);
  const db = createDB(env);
  const result = await registerKeyPackage(env, domain, db, user, body);
  if ("error" in result) {
    return c.json({ error: result.error }, 400);
  }
  return c.json({
    result: "ok",
    keyId: result.keyId,
    groupInfo: result.groupInfo,
    keyPackageRef: result.keyPackageRef,
  });
});

app.post("/keyPackages/bulk", authRequired, async (c) => {
  const body = await c.req.json();
  if (!Array.isArray(body)) {
    return c.json({ error: "array required" }, 400);
  }
  const env = getEnv(c);
  const domain = getDomain(c);
  const db = createDB(env);
  const results: unknown[] = [];
  for (const item of body) {
    if (
      !item || typeof item.user !== "string" ||
      !Array.isArray(item.keyPackages)
    ) {
      continue;
    }
    const user = item.user as string;
    const resList: unknown[] = [];
    for (const kp of item.keyPackages) {
      const r = await registerKeyPackage(env, domain, db, user, kp);
      resList.push(r);
    }
    results.push({ user, results: resList });
  }
  return c.json({ results });
});

// KeyPackageRef で使用済みにマーキング: Welcome 消費後にクライアントがまとめて通知
app.post("/users/:user/keyPackages/markUsed", authRequired, async (c) => {
  const user = c.req.param("user");
  const body = await c.req.json().catch(() => ({}));
  const refs = Array.isArray(body.keyPackageRefs) ? body.keyPackageRefs : [];
  if (refs.length === 0) {
    return c.json({ ok: false, error: "keyPackageRefs required" }, 400);
  }
  const db = createDB(getEnv(c));
  for (const ref of refs) {
    if (typeof ref === "string" && /^[0-9a-fA-F]{64}$/.test(ref)) {
      await db.markKeyPackageUsedByRef(user, ref.toLowerCase());
    }
  }
  await db.cleanupKeyPackages(user);
  return c.json({ ok: true });
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

    // パブリックやフォロワー宛ての配送は拒否する
    if (
      recipients.some((r) =>
        r === "https://www.w3.org/ns/activitystreams#Public" ||
        r.endsWith("/followers") ||
        r.endsWith("/following")
      )
    ) {
      return c.json({ error: "invalid recipients" }, 400);
    }

    const mType = typeof mediaType === "string" ? mediaType : "message/mls";
    const encType = typeof encoding === "string" ? encoding : "base64";
    // MLS 以外の形式や Base64 以外のエンコードは受け付けない
    if (mType !== "message/mls" || encType !== "base64") {
      return c.json({ error: "unsupported format" }, 400);
    }
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
    // Resolve recipients to actor IRIs and exclude unresolved entries.
    try {
      const { resolved, unresolved } = await resolveRecipientsToActorIris(
        recipients,
        env,
      );
      if (resolved.length === 0) {
        return c.json({ error: "no valid recipients" }, 400);
      }
      (activity as ActivityPubActivity).to = resolved;
      (activity as ActivityPubActivity).cc = [];
      if (unresolved.length > 0) {
        console.warn("some recipients could not be resolved:", unresolved);
      }
      deliverActivityPubObject(resolved, activity, sender, domain, env).catch(
        (err) => {
          console.error("deliver failed", err);
        },
      );
    } catch (err) {
      console.error("failed to resolve recipients", err);
      return c.json({ error: "failed to resolve recipients" }, 500);
    }

    // WebSocket はリアルタイム通知のみ（本文等は送らない）
    const newMsg = {
      id: String(msg._id),
      roomId,
      from,
      to: recipients,
      createdAt: msg.createdAt,
    };
    // 本文は REST (/rooms/:room/messages) で取得させる
    sendToUser(from, {
      type: "hasUpdate",
      payload: { kind: "encryptedMessage", id: newMsg.id },
    });
    for (const t of recipients) {
      sendToUser(t, {
        type: "hasUpdate",
        payload: { kind: "encryptedMessage", id: newMsg.id },
      });
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
