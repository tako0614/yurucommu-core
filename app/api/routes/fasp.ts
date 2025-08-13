import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getEnv } from "../../shared/config.ts";
import { createDB } from "../DB/mod.ts";
import { getDomain } from "../utils/activitypub.ts";
import { getSystemKey } from "../services/system_actor.ts";
import { faspFetch, notifyCapabilityActivation } from "../services/fasp.ts";
import { verifyDigest, verifyHttpSignature } from "../utils/activitypub.ts";
import authRequired from "../utils/auth.ts";

// FASP 関連の最小実装（docs/FASP.md のプロトタイプに準拠）
const app = new Hono();

// 管理系は通常の /api 配下に集約（要ログイン）
app.use("/api/fasp/*", authRequired);

// 以前の実装に戻す（provider_info の自己提供は行わない）

// deno-lint-ignore no-explicit-any
async function requireSignedJson(c: any): Promise<{ ok: boolean; body?: any }> {
  const bodyText = await c.req.text();
  const hasDigest = !!(
    c.req.header("content-digest") || c.req.header("digest")
  );
  if (!hasDigest) return { ok: false };
  const okDigest = await verifyDigest(c.req.raw, bodyText);
  const okSig = await verifyHttpSignature(c.req.raw, bodyText);
  if (!okDigest || !okSig) {
    return { ok: false };
  }
  try {
    return { ok: true, body: JSON.parse(bodyText) };
  } catch {
    return { ok: false };
  }
}

// POST /fasp/registration
// FASP からの登録要求を受理し、takos 側情報を返す
app.post("/fasp/registration", async (c) => {
  const env = getEnv(c);
  const domain = getDomain(c);
  const db = createDB(env);
  const signed = await requireSignedJson(c);
  if (!signed.ok) {
    return c.json({ error: "署名/ダイジェスト検証に失敗しました" }, 401);
  }
  const body = signed.body as {
    name?: string;
    baseUrl?: string;
    serverId?: string;
    publicKey?: string;
  };
  const { name = "", baseUrl = "", serverId = "", publicKey = "" } = body;
  if (!baseUrl || !serverId || !publicKey) {
    return c.json({ error: "必須フィールドが不足しています" }, 400);
  }

  const mongo = await db.getDatabase();
  const fasps = mongo.collection("fasps");
  const faspId = crypto.randomUUID();
  // 既存の仮登録（discover）を baseUrl でマージしつつ upsert
  await fasps.updateOne(
    { $or: [{ serverId }, { baseUrl }] },
    {
      $set: {
        name,
        baseUrl,
        serverId,
        publicKey,
        // 署名検証済みのため承認済みに更新
        status: "approved",
        approvedAt: new Date(),
        rejectedAt: null,
        updatedAt: new Date(),
      },
      $setOnInsert: { faspId },
    },
    { upsert: true },
  );

  const { publicKey: takosPublicKey } = await getSystemKey(db, domain);
  const registrationCompletionUri = `https://${domain}/api/fasp/providers`; // 管理APIを案内
  return c.json({
    faspId,
    publicKey: takosPublicKey,
    registrationCompletionUri,
  }, 201);
});

// data_sharing v0.1 のバリデーションスキーマ
const eventSubscriptionSchema = z.object({
  category: z.enum(["content", "account"]),
  subscriptionType: z.enum(["lifecycle", "trends"]),
  maxBatchSize: z.number().int().positive().optional(),
  threshold: z
    .object({
      timeframe: z.number().int().positive().optional(),
      shares: z.number().int().positive().optional(),
      likes: z.number().int().positive().optional(),
      replies: z.number().int().positive().optional(),
    })
    .optional(),
})
  .refine(
    (d) => d.category === "content" || d.subscriptionType !== "trends",
    {
      message:
        "subscriptionType に trends を指定する場合、category は content である必要があります",
    },
  )
  .refine(
    (d) => d.subscriptionType === "trends" || d.threshold === undefined,
    {
      message: "subscriptionType が trends の場合のみ threshold を指定できます",
    },
  );

const backfillRequestSchema = z.object({
  category: z.enum(["content", "account"]),
  maxCount: z.number().int().positive(),
});

// data_sharing v0.1: event_subscriptions の受信（作成）
app.post("/fasp/data_sharing/v0/event_subscriptions", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const signed = await requireSignedJson(c);
  if (!signed.ok) {
    return c.json({ error: "署名/ダイジェスト検証に失敗しました" }, 401);
  }
  const parsed = eventSubscriptionSchema.safeParse(signed.body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です" }, 422);
  }
  const payload = parsed.data;
  const mongo = await db.getDatabase();
  const col = mongo.collection("fasp_event_subscriptions");
  const id = crypto.randomUUID();
  await col.insertOne({ _id: id, payload, createdAt: new Date() });
  return c.json({ subscription: { id } }, 201);
});

// data_sharing v0.1: event_subscriptions の削除
app.delete("/fasp/data_sharing/v0/event_subscriptions/:id", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const mongo = await db.getDatabase();
  const col = mongo.collection("fasp_event_subscriptions");
  await col.deleteOne({ _id: id });
  return c.body(null, 204);
});

// data_sharing v0.1: backfill の作成
app.post("/fasp/data_sharing/v0/backfill_requests", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const signed = await requireSignedJson(c);
  if (!signed.ok) {
    return c.json({ error: "署名/ダイジェスト検証に失敗しました" }, 401);
  }
  const parsed = backfillRequestSchema.safeParse(signed.body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です" }, 422);
  }
  const payload = parsed.data;
  const mongo = await db.getDatabase();
  const col = mongo.collection("fasp_backfills");
  const id = crypto.randomUUID();
  await col.insertOne({
    _id: id,
    payload,
    status: "pending",
    createdAt: new Date(),
  });
  return c.json({ backfillRequest: { id } }, 201);
});

// data_sharing v0.1: backfill 継続通知
app.post(
  "/fasp/data_sharing/v0/backfill_requests/:id/continuation",
  async (c) => {
    const env = getEnv(c);
    const db = createDB(env);
    const id = c.req.param("id");
    const signed = await requireSignedJson(c);
    if (!signed.ok) {
      return c.json({
        error: "署名/ダイジェスト検証に失敗しました",
      }, 401);
    }
    const mongo = await db.getDatabase();
    const col = mongo.collection("fasp_backfills");
    await col.updateOne({ _id: id }, { $set: { continuedAt: new Date() } });
    return c.body(null, 204);
  },
);

export default app;

// 管理/デバッグ用: takos -> FASP アナウンス送信の簡易エンドポイント
// POST /api/fasp/announcements
app.post("/api/fasp/announcements", async (c) => {
  try {
    const req = await c.req.json();
    const faspBaseUrl: string = req.faspBaseUrl;
    if (!faspBaseUrl) return c.json({ error: "faspBaseUrl が必要です" }, 400);
    const payload = {
      source: req.source,
      category: req.category,
      eventType: req.eventType,
      objectUris: req.objectUris,
      moreObjectsAvailable: req.moreObjectsAvailable ?? false,
    };
    const body = JSON.stringify(payload);
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(body));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
    const headers = new Headers({
      "content-type": "application/json",
      Accept: "application/json",
      "Content-Digest": `sha-256=:${b64}:`,
    });
    const url = `${
      faspBaseUrl.replace(/\/$/, "")
    }/data_sharing/v0/announcements`;
    const res = await fetch(url, { method: "POST", headers, body });
    const text = await res.text();
    return c.body(text, res.status, Object.fromEntries(res.headers));
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// 管理用: プロバイダ一覧取得
app.get("/api/fasp/providers", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const mongo = await db.getDatabase();
  const list = await mongo.collection("fasps").find({}).toArray();
  const result = list.map((d) => ({
    name: d.name,
    baseUrl: d.baseUrl,
    serverId: d.serverId,
    faspId: d.faspId,
    status: d.status ?? "pending",
    capabilities: d.capabilities ?? {},
    updatedAt: d.updatedAt ?? null,
    approvedAt: d.approvedAt ?? null,
    rejectedAt: d.rejectedAt ?? null,
  }));
  return c.json(result);
});

// 管理用: ドメイン/URL から FASP を発見して仮登録
app.post(
  "/api/fasp/providers/discover",
  zValidator(
    "json",
    z.object({ domainOrUrl: z.string().min(1) }),
  ),
  async (c) => {
    const env = getEnv(c);
    const db = createDB(env);
    const { domainOrUrl } = c.req.valid("json") as { domainOrUrl: string };

    // ベースURLの正規化
    let baseUrl = domainOrUrl.trim();
    if (!/^https?:\/\//i.test(baseUrl)) {
      baseUrl = `https://${baseUrl}`;
    }
    baseUrl = baseUrl.replace(/\/$/, "");

    // provider_info の取得（シンプルな取得に戻す）
    let info: unknown;
    try {
      const res = await faspFetch(env, `${baseUrl}/provider_info`, {
        verifyResponseSignature: false,
      });
      if (!res.ok) {
        return c.json({ error: `provider_info 取得失敗 (${res.status})` }, 502);
      }
      info = await res.json();
    } catch (e) {
      return c.json({ error: `provider_info 取得エラー: ${String(e)}` }, 502);
    }

    // 最低限のフィールドのみ緩く検証
    const parsed = z.object({
      name: z.string().min(1),
      capabilities: z.array(
        z.object({ id: z.string().min(1), version: z.string().min(1) }),
      ).default([]),
    }).safeParse(info);
    if (!parsed.success) {
      return c.json({ error: "provider_info が不正です" }, 422);
    }

    const name = parsed.data.name;
    const capsArr = parsed.data.capabilities;
    const capabilities = Object.fromEntries(
      capsArr.map((c) => [c.id, { version: c.version, enabled: false }]),
    );

    const mongo = await db.getDatabase();
    const fasps = mongo.collection("fasps");

    // baseUrl で既存を検索して upsert（仮 serverId を付与）
    const provisionalServerId = `provisional:${crypto.randomUUID()}`;
    const faspId = crypto.randomUUID();
    const now = new Date();
    const res = await fasps.findOneAndUpdate(
      { baseUrl },
      {
        $setOnInsert: {
          faspId,
          serverId: provisionalServerId,
          status: "pending",
          createdAt: now,
        },
        $set: {
          name,
          baseUrl,
          capabilities,
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    return c.json({
      ok: true,
      provider: {
        name: res?.name ?? name,
        baseUrl,
        serverId: res?.serverId ?? provisionalServerId,
        faspId: res?.faspId ?? faspId,
        status: res?.status ?? "pending",
        capabilities: res?.capabilities ?? capabilities,
      },
    });
  },
);

// 管理用: プロバイダ詳細
app.get("/api/fasp/providers/:serverId", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const serverId = c.req.param("serverId");
  const mongo = await db.getDatabase();
  const d = await mongo.collection("fasps").findOne({ serverId });
  if (!d) return c.json({ error: "not found" }, 404);
  return c.json({
    name: d.name,
    baseUrl: d.baseUrl,
    serverId: d.serverId,
    faspId: d.faspId,
    publicKey: d.publicKey,
    status: d.status ?? "pending",
    capabilities: d.capabilities ?? {},
    updatedAt: d.updatedAt ?? null,
    approvedAt: d.approvedAt ?? null,
    rejectedAt: d.rejectedAt ?? null,
  });
});

// 管理用: 承認
app.post("/api/fasp/providers/:serverId/approve", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const serverId = c.req.param("serverId");
  const mongo = await db.getDatabase();
  const res = await mongo.collection("fasps").findOneAndUpdate(
    { serverId },
    { $set: { status: "approved", approvedAt: new Date(), rejectedAt: null } },
    { returnDocument: "after" },
  );
  if (!res) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// 管理用: 却下
app.post("/api/fasp/providers/:serverId/reject", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const serverId = c.req.param("serverId");
  const mongo = await db.getDatabase();
  const res = await mongo.collection("fasps").findOneAndUpdate(
    { serverId },
    { $set: { status: "rejected", rejectedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!res) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// 管理用: プロバイダ削除
app.delete("/api/fasp/providers/:serverId", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const serverId = c.req.param("serverId");
  const mongo = await db.getDatabase();
  const res = await mongo.collection("fasps").deleteOne({ serverId });
  if (!res || res.deletedCount === 0) {
    return c.json({ error: "not found" }, 404);
  }
  return c.body(null, 204);
});

// 管理用: capability 設定（ON/OFFとバージョンを保存）
app.put(
  "/api/fasp/providers/:serverId/capabilities",
  zValidator(
    "json",
    z.object({
      capabilities: z.record(
        z.object({ version: z.string(), enabled: z.boolean() }),
      ),
    }),
  ),
  async (c) => {
    const env = getEnv(c);
    const db = createDB(env);
    const serverId = c.req.param("serverId");
    const { capabilities } = c.req.valid("json") as {
      capabilities: Record<string, { version: string; enabled: boolean }>;
    };
    const mongo = await db.getDatabase();
    const res = await mongo.collection("fasps").findOneAndUpdate(
      { serverId },
      { $set: { capabilities, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!res) return c.json({ error: "not found" }, 404);
    const baseUrl = (res.baseUrl ?? "").replace(/\/$/, "");
    if (baseUrl) {
      // FASP に有効化/無効化を通知
      await Promise.all(
        Object.entries(capabilities).map(([id, info]) =>
          notifyCapabilityActivation(
            env,
            baseUrl,
            id,
            info.version,
            info.enabled,
          )
        ),
      );
    }
    return c.json({ ok: true });
  },
);

// 管理用: provider_info の取得（FASP から capabilities 情報を取得）
app.get("/api/fasp/providers/:serverId/provider_info", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const serverId = c.req.param("serverId");
  const mongo = await db.getDatabase();
  const rec = await mongo.collection("fasps").findOne({ serverId });
  if (!rec) return c.json({ error: "not found" }, 404);
  const baseUrl = (rec.baseUrl ?? "").replace(/\/$/, "");
  if (!baseUrl) return c.json({ error: "baseUrl missing" }, 400);
  try {
    const res = await faspFetch(env, `${baseUrl}/provider_info`, {
      verifyResponseSignature: false,
    });
    const text = await res.text();
    return c.body(text, res.status, Object.fromEntries(res.headers));
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});
