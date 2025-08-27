import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getEnv } from "@takos/config";
import { getDB } from "../db/mod.ts";
import { getDomain } from "../utils/activitypub.ts";
import { getSystemKey } from "../services/system_actor.ts";
import { faspFetch, notifyCapabilityActivation } from "../services/fasp.ts";
import { verifyDigest, verifyHttpSignature } from "../utils/activitypub.ts";
import authRequired from "../utils/auth.ts";
import {
  continueBackfill,
  createBackfill,
  deleteEventSubscription,
  insertEventSubscription,
  listProviders,
  registrationUpsert,
} from "../../takos/db/fasp_client.ts";

// FASP 関連の最小実装（docs/FASP.md のプロトタイプに準拠）
const app = new Hono();

// 管理系は通常の /api 配下に集約（要ログイン）
app.use("/api/fasp/*", authRequired);

// 以前の実装に戻す（provider_info の自己提供は行わない）

// deno-lint-ignore no-explicit-any
async function requireSignedJson(c: any): Promise<{ ok: boolean; body?: any }> {
  const bodyText = await c.req.text();
  const hasContentDigest = !!c.req.header("content-digest");
  if (!hasContentDigest) return { ok: false };
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
  const db = getDB(c);
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

  const faspId = crypto.randomUUID();
  // baseUrl の正規化（末尾のスラッシュを削除）
  const normalizedBaseUrl = String(baseUrl).replace(/\/$/, "");

  // FASP 登録情報は registrationUpsert で必ず保存する
  await registrationUpsert(env, {
    name,
    baseUrl: normalizedBaseUrl,
    serverId,
    publicKey,
    faspId,
  });

  const { publicKey: takosPublicKey } = await getSystemKey(db, domain);
  const registrationCompletionUri = `https://${domain}/api/fasp/providers`; // 管理APIを案内
  // keyid は登録時に交換する識別子として、サーバーの Actor 鍵IDを明示
  const keyId = `https://${domain}/actor#main-key`;
  return c.json({
    faspId,
    publicKey: takosPublicKey,
    keyId,
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
  const signed = await requireSignedJson(c);
  if (!signed.ok) {
    return c.json({ error: "署名/ダイジェスト検証に失敗しました" }, 401);
  }
  const parsed = eventSubscriptionSchema.safeParse(signed.body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です" }, 422);
  }
  const payload = parsed.data;
  const id = crypto.randomUUID();
  await insertEventSubscription(env, id, payload);
  return c.json({ subscription: { id } }, 201);
});

// data_sharing v0.1: event_subscriptions の削除
app.delete("/fasp/data_sharing/v0/event_subscriptions/:id", async (c) => {
  const env = getEnv(c);
  const id = c.req.param("id");
  await deleteEventSubscription(env, id);
  return c.body(null, 204);
});

// data_sharing v0.1: backfill の作成
app.post("/fasp/data_sharing/v0/backfill_requests", async (c) => {
  const env = getEnv(c);
  const signed = await requireSignedJson(c);
  if (!signed.ok) {
    return c.json({ error: "署名/ダイジェスト検証に失敗しました" }, 401);
  }
  const parsed = backfillRequestSchema.safeParse(signed.body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です" }, 422);
  }
  const payload = parsed.data;
  const id = crypto.randomUUID();
  await createBackfill(env, id, payload);
  return c.json({ backfillRequest: { id } }, 201);
});

// data_sharing v0.1: backfill 継続通知
app.post(
  "/fasp/data_sharing/v0/backfill_requests/:id/continuation",
  async (c) => {
    const env = getEnv(c);
    const id = c.req.param("id");
    const signed = await requireSignedJson(c);
    if (!signed.ok) {
      return c.json({
        error: "署名/ダイジェスト検証に失敗しました",
      }, 401);
    }
    await continueBackfill(env, id);
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
    return new Response(text, {
      status: res.status,
      headers: Object.fromEntries(res.headers),
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// 管理用: プロバイダ一覧取得
app.get("/api/fasp/providers", async (c) => {
  const env = getEnv(c);
  const list = await listProviders(env);
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
    const db = getDB(c);
    const { domainOrUrl } = c.req.valid("json") as { domainOrUrl: string };

    // ベースURLの正規化（末尾 /provider_info のみ除去）
    function canonicalize(u: string): string {
      let b = u.trim();
      if (!/^https?:\/\//i.test(b)) b = `https://${b}`;
      try {
        const url = new URL(b);
        url.hash = "";
        url.search = "";
        let p = url.pathname.replace(/\/+$/, "");
        if (p.endsWith("/provider_info")) {
          p = p.slice(0, -"/provider_info".length);
        }
        return `${url.origin}${p}`.replace(/\/$/, "");
      } catch {
        return u.replace(/\/$/, "");
      }
    }
    const baseUrl = canonicalize(domainOrUrl);
    // 既定FASPかどうか判定
    const defaultBase = env["FASP_DEFAULT_BASE_URL"] ?? "";
    const hostOf = (u: string) => {
      try {
        return new URL(canonicalize(u)).hostname.toLowerCase();
      } catch {
        return "";
      }
    };
    const isDefault = !!defaultBase &&
      (canonicalize(defaultBase) === baseUrl ||
        hostOf(defaultBase) === hostOf(baseUrl));

    // provider_info の取得
    let info: unknown;
    const url = `${baseUrl.replace(/\/$/, "")}/provider_info`;
    let lastErr: unknown = null;
    try {
      const res = await faspFetch(env, url, {
        verifyResponseSignature: false,
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        info = await res.json();
      }
    } catch (e) {
      lastErr = e;
    }
    // 最低限のフィールドのみ緩く検証（取得できない/不正でも pending レコードは作成）
    let name = baseUrl;
    let capsArr: Array<{ id: string; version: string }> = [];
    if (!lastErr && info) {
      const parsed = z.object({
        name: z.string().min(1),
        capabilities: z.array(
          z.object({ id: z.string().min(1), version: z.string().min(1) }),
        ).default([]),
      }).safeParse(info);
      if (parsed.success) {
        name = parsed.data.name;
        capsArr = parsed.data.capabilities;
      }
    }
    const capabilities = Object.fromEntries(
      capsArr.map((c) => [
        c.id,
        { version: c.version, enabled: isDefault ? true : false },
      ]),
    );

    const mongo = await db.getDatabase();
    const providersCol = mongo.collection("fasp_client_providers");
    const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
    // 既存のベースURL表記揺れを正規化して統合
    const variants = Array.from(
      new Set([
        baseUrl,
        `${baseUrl}/provider_info`,
      ].flatMap((u) => [u, `${u}/`])),
    );
    await providersCol.updateMany(
      { tenant_id: tenantId, baseUrl: { $in: variants } },
      { $set: { baseUrl, updatedAt: new Date() } },
    );

    // baseUrl で既存を検索して upsert（仮 serverId を付与）
    const provisionalServerId = `provisional:${crypto.randomUUID()}`;
    const faspId = crypto.randomUUID();
    const now = new Date();
    const res = await providersCol.findOneAndUpdate(
      { tenant_id: tenantId, baseUrl },
      {
        $setOnInsert: {
          faspId,
          serverId: provisionalServerId,
          createdAt: now,
          tenant_id: tenantId,
        },
        $set: {
          name,
          baseUrl,
          capabilities,
          status: isDefault ? "approved" : "pending",
          approvedAt: isDefault ? now : null,
          rejectedAt: null,
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    // 既定FASPなら secret を確保し capability の有効化通知を送る
    if (isDefault) {
      try {
        if (!res?.secret) {
          const secret = btoa(
            String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
          );
          await providersCol.updateOne({ tenant_id: tenantId, baseUrl }, {
            $set: { secret, updatedAt: new Date() },
          });
        }
      } catch { /* ignore */ }
      const base = baseUrl.replace(/\/$/, "");
      await Promise.all(
        Object.entries(capabilities).map(([id, info]) =>
          notifyCapabilityActivation(env, base, id, info.version, true)
        ),
      ).catch(() => {});
    }

    return c.json({
      ok: true,
      provider: {
        name: res?.name ?? name,
        baseUrl,
        serverId: res?.serverId ?? provisionalServerId,
        faspId: res?.faspId ?? faspId,
        status: res?.status ?? (isDefault ? "approved" : "pending"),
        capabilities: res?.capabilities ?? capabilities,
      },
    });
  },
);

// 管理用: プロバイダ詳細
app.get("/api/fasp/providers/:serverId", async (c) => {
  const env = getEnv(c);
  const db = getDB(c);
  const serverId = c.req.param("serverId");
  const mongo = await db.getDatabase();
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const d = await mongo.collection("fasp_client_providers").findOne({
    tenant_id: tenantId,
    serverId,
  });
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
  const db = getDB(c);
  const serverId = c.req.param("serverId");
  const mongo = await db.getDatabase();
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const res = await mongo.collection("fasp_client_providers").findOneAndUpdate(
    { tenant_id: tenantId, serverId },
    { $set: { status: "approved", approvedAt: new Date(), rejectedAt: null } },
    { returnDocument: "after" },
  );
  if (!res) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// 管理用: 却下
app.post("/api/fasp/providers/:serverId/reject", async (c) => {
  const env = getEnv(c);
  const db = getDB(c);
  const serverId = c.req.param("serverId");
  const mongo = await db.getDatabase();
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const res = await mongo.collection("fasp_client_providers").findOneAndUpdate(
    { tenant_id: tenantId, serverId },
    { $set: { status: "rejected", rejectedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!res) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// 管理用: プロバイダ削除
app.delete("/api/fasp/providers/:serverId", async (c) => {
  const env = getEnv(c);
  const db = getDB(c);
  const serverId = c.req.param("serverId");
  const mongo = await db.getDatabase();
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const res = await mongo.collection("fasp_client_providers").deleteOne({
    tenant_id: tenantId,
    serverId,
  });
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
    const db = getDB(c);
    const serverId = c.req.param("serverId");
    const { capabilities } = c.req.valid("json") as {
      capabilities: Record<string, { version: string; enabled: boolean }>;
    };
    const mongo = await db.getDatabase();
    const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
    const res = await mongo.collection("fasp_client_providers")
      .findOneAndUpdate(
        { tenant_id: tenantId, serverId },
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
  const db = getDB(c);
  const serverId = c.req.param("serverId");
  const mongo = await db.getDatabase();
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const rec = await mongo.collection("fasp_client_providers").findOne({
    tenant_id: tenantId,
    serverId,
  });
  if (!rec) return c.json({ error: "not found" }, 404);
  const baseUrl = (rec.baseUrl ?? "").replace(/\/$/, "");
  if (!baseUrl) return c.json({ error: "baseUrl missing" }, 400);
  try {
    const res = await faspFetch(env, `${baseUrl}/provider_info`, {
      verifyResponseSignature: false,
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: Object.fromEntries(res.headers),
    });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

// 管理用: FASP 設定の取得/更新（検索に使うFASP、共有設定）
app.get("/api/fasp/settings", async (c) => {
  const env = getEnv(c);
  const db = getDB(c);
  const mongo = await db.getDatabase();
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  // deno-lint-ignore no-explicit-any
  const _settingsFilter: any = { _id: "default", tenant_id: tenantId };
  const doc = await mongo.collection("fasp_client_settings").findOne(
    _settingsFilter,
  );
  return c.json({
    searchServerId: doc?.searchServerId ?? null,
    shareEnabled: doc?.shareEnabled ?? true,
    shareServerIds: doc?.shareServerIds ?? null,
  });
});

app.put("/api/fasp/settings", async (c) => {
  try {
    const env = getEnv(c);
    const db = getDB(c);
    const mongo = await db.getDatabase();
    const body = await c.req.json();
    const update: Record<string, unknown> = {};
    if ("searchServerId" in body) {
      update.searchServerId =
        typeof body.searchServerId === "string" && body.searchServerId
          ? String(body.searchServerId)
          : null;
    }
    if ("shareEnabled" in body) {
      update.shareEnabled = Boolean(body.shareEnabled);
    }
    if ("shareServerIds" in body) {
      if (Array.isArray(body.shareServerIds)) {
        update.shareServerIds = body.shareServerIds.map((s: unknown) =>
          String(s)
        );
      } else {
        update.shareServerIds = null;
      }
    }
    const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
    // deno-lint-ignore no-explicit-any
    const _settingsFilter: any = { _id: "default", tenant_id: tenantId };
    await mongo.collection("fasp_client_settings").updateOne(
      _settingsFilter,
      {
        $set: { ...update, updatedAt: new Date() },
        $setOnInsert: {
          _id: "default",
          tenant_id: tenantId,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});
