import { type Context, Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getEnv } from "@takos/config";
import { getDB } from "../db/mod.ts";
import { getDomain } from "../utils/activitypub.ts";
import { getSystemKey } from "../services/system_actor.ts";
import { faspFetch, notifyCapabilityActivation } from "../services/fasp.ts";
import authRequired from "../utils/auth.ts";
import { requireSignedJson } from "../utils/require_signed_json.ts";
import { normalizeBaseUrl } from "../utils/url.ts";

// FASP 関連の最小実装（docs/FASP.md のプロトタイプに準拠）
const app = new Hono();
const auth = (c: Context, next: () => Promise<void>) =>
  authRequired(getDB(c))(c, next);

// 管理系は通常の /api 配下に集約（要ログイン）
app.use("/api/fasp/*", auth);

// 以前の実装に戻す（provider_info の自己提供は行わない）

// POST /fasp/registration
// FASP からの登録要求を受理し、takos 側情報を返す
app.post("/fasp/registration", async (c) => {
  const domain = getDomain(c);
  const db = getDB(c);
  const signed = await requireSignedJson<{
    name?: string;
    baseUrl?: string;
    serverId?: string;
    publicKey?: string;
  }>(c);
  if (!signed.ok) {
    return c.json({ error: "署名/ダイジェスト検証に失敗しました" }, 401);
  }
  const { name = "", baseUrl = "", serverId = "", publicKey = "" } =
    signed.body ?? {};
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl || !serverId || !publicKey) {
    return c.json({ error: "必須フィールドが不足しています" }, 400);
  }

  const faspId = crypto.randomUUID();

  // FASP 登録情報は必ず保存する
  await db.faspProviders.registrationUpsert({
    name,
    baseUrl: normalizedBaseUrl,
    serverId,
    publicKey,
    faspId,
  });

  // 署名検証済みのため、登録と同時に承認状態へ更新
  await db.faspProviders.updateByBaseUrl(normalizedBaseUrl, {
    status: "approved",
    approvedAt: new Date(),
    rejectedAt: null,
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
  const db = getDB(c);
  const signed = await requireSignedJson<
    z.infer<typeof eventSubscriptionSchema>
  >(c);
  if (!signed.ok) {
    return c.json({ error: "署名/ダイジェスト検証に失敗しました" }, 401);
  }
  const parsed = eventSubscriptionSchema.safeParse(signed.body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です" }, 422);
  }
  const payload = parsed.data;
  const id = crypto.randomUUID();
  await db.faspProviders.insertEventSubscription(id, payload);
  return c.json({ subscription: { id } }, 201);
});

// data_sharing v0.1: event_subscriptions の削除
app.delete("/fasp/data_sharing/v0/event_subscriptions/:id", async (c) => {
  const db = getDB(c);
  const id = c.req.param("id");
  await db.faspProviders.deleteEventSubscription(id);
  return c.body(null, 204);
});

// data_sharing v0.1: backfill の作成
app.post("/fasp/data_sharing/v0/backfill_requests", async (c) => {
  const db = getDB(c);
  const signed = await requireSignedJson<
    z.infer<typeof backfillRequestSchema>
  >(c);
  if (!signed.ok) {
    return c.json({ error: "署名/ダイジェスト検証に失敗しました" }, 401);
  }
  const parsed = backfillRequestSchema.safeParse(signed.body);
  if (!parsed.success) {
    return c.json({ error: "入力が不正です" }, 422);
  }
  const payload = parsed.data;
  const id = crypto.randomUUID();
  await db.faspProviders.createBackfill(id, payload);
  return c.json({ backfillRequest: { id } }, 201);
});

// data_sharing v0.1: backfill 継続通知
app.post(
  "/fasp/data_sharing/v0/backfill_requests/:id/continuation",
  async (c) => {
    const db = getDB(c);
    const id = c.req.param("id");
    const signed = await requireSignedJson<unknown>(c);
    if (!signed.ok) {
      return c.json({
        error: "署名/ダイジェスト検証に失敗しました",
      }, 401);
    }
    await db.faspProviders.continueBackfill(id);
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
    const normalized = normalizeBaseUrl(faspBaseUrl);
    if (!normalized) return c.json({ error: "faspBaseUrl が不正です" }, 400);
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
    const url = `${normalized}/data_sharing/v0/announcements`;
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
  const db = getDB(c);
  const list = await db.faspProviders.listProviders() as Array<
    Record<string, unknown>
  >;
  const result = list.map((d: Record<string, unknown>) => ({
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
    const domain = getDomain(c);
    const { domainOrUrl } = c.req.valid("json") as { domainOrUrl: string };

    const baseUrl = normalizeBaseUrl(domainOrUrl);
    if (!baseUrl) return c.json({ error: "不正な URL です" }, 400);
    // 既定FASPかどうか判定
    const defaultBase = env["FASP_DEFAULT_BASE_URL"] ?? "";
    const hostOf = (u: string) => {
      try {
        const h = normalizeBaseUrl(u);
        return h ? new URL(h).hostname.toLowerCase() : "";
      } catch {
        return "";
      }
    };
    const isDefault = !!defaultBase &&
      (normalizeBaseUrl(defaultBase) === baseUrl ||
        hostOf(defaultBase) === hostOf(baseUrl));

    // provider_info の取得
    let info: unknown;
    const url = `${baseUrl}/provider_info`;
    let lastErr: unknown = null;
    try {
      const res = await faspFetch(db, env, domain, url, {
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

    // 既存のベースURL表記揺れを正規化して統合
    const variants = Array.from(
      new Set([
        baseUrl,
        `${baseUrl}/provider_info`,
      ].flatMap((u) => [u, `${u}/`])),
    );
    // variants に該当する既存レコードを列挙して baseUrl を統合
    try {
      const existing = await db.faspProviders.list({
        baseUrl: { $in: variants },
      }) as Array<Record<string, unknown>>;
      await Promise.all(
        (existing ?? []).map(async (ex: Record<string, unknown>) => {
          const exBase = (ex["baseUrl"] ?? "") as string;
          if (exBase) {
            await db.faspProviders.updateByBaseUrl(exBase, {
              baseUrl,
              updatedAt: new Date(),
            });
          }
        }),
      );
    } catch {
      // ignore errors from listing/updating variants
    }

    // baseUrl で既存を検索して upsert（仮 serverId を付与）
    const provisionalServerId = `provisional:${crypto.randomUUID()}`;
    const faspId = crypto.randomUUID();
    const now = new Date();
    await db.faspProviders.upsertByBaseUrl(
      baseUrl,
      {
        name,
        baseUrl,
        capabilities,
        status: isDefault ? "approved" : "pending",
        approvedAt: isDefault ? now : null,
        rejectedAt: null,
        updatedAt: now,
      },
      {
        faspId,
        serverId: provisionalServerId,
        createdAt: now,
      },
    );
    const res = await db.faspProviders.findOne({ baseUrl }) as
      | Record<string, unknown>
      | null;

    // 既定FASPなら secret を確保し capability の有効化通知を送る
    if (isDefault) {
      try {
        const existingSecret = res
          ? (res as Record<string, unknown>)["secret"]
          : undefined;
        if (!existingSecret) {
          const secret = btoa(
            String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
          );
          await db.faspProviders.updateByBaseUrl(baseUrl, {
            secret,
            updatedAt: new Date(),
          });
        }
      } catch { /* ignore */ }
      const base = baseUrl;
      await Promise.all(
        Object.entries(capabilities).map(([id, info]) =>
          notifyCapabilityActivation(
            db,
            env,
            domain,
            base,
            id,
            (info as unknown as { version: string }).version,
            true,
          )
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
  const db = getDB(c);
  const serverId = c.req.param("serverId");
  const d = await db.faspProviders.findOne({ serverId }) as
    | Record<string, unknown>
    | null;
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
  const db = getDB(c);
  const serverId = c.req.param("serverId");
  const provider = await db.faspProviders.findOne({ serverId }) as
    | Record<string, unknown>
    | null;
  if (!provider) return c.json({ error: "not found" }, 404);
  const baseUrl = (provider["baseUrl"] ?? "") as string;
  if (!baseUrl) return c.json({ error: "baseUrl missing" }, 400);
  await db.faspProviders.updateByBaseUrl(baseUrl, {
    status: "approved",
    approvedAt: new Date(),
    rejectedAt: null,
  });
  return c.json({ ok: true });
});

// 管理用: 却下
app.post("/api/fasp/providers/:serverId/reject", async (c) => {
  const db = getDB(c);
  const serverId = c.req.param("serverId");
  const provider = await db.faspProviders.findOne({ serverId }) as
    | Record<string, unknown>
    | null;
  if (!provider) return c.json({ error: "not found" }, 404);
  const baseUrl = (provider["baseUrl"] ?? "") as string;
  if (!baseUrl) return c.json({ error: "baseUrl missing" }, 400);
  await db.faspProviders.updateByBaseUrl(baseUrl, {
    status: "rejected",
    rejectedAt: new Date(),
  });
  return c.json({ ok: true });
});

// 管理用: プロバイダ削除
app.delete("/api/fasp/providers/:serverId", async (c) => {
  const db = getDB(c);
  const serverId = c.req.param("serverId");
  const res = await db.faspProviders.deleteOne({ serverId });
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
        z.string(),
        z.object({ version: z.string(), enabled: z.boolean() }),
      ),
    }),
  ),
  async (c) => {
    const env = getEnv(c);
    const db = getDB(c);
    const domain = getDomain(c);
    const serverId = c.req.param("serverId");
    const { capabilities } = c.req.valid("json") as {
      capabilities: Record<string, { version: string; enabled: boolean }>;
    };
    const provider = await db.faspProviders.findOne({ serverId }) as
      | Record<string, unknown>
      | null;
    if (!provider) return c.json({ error: "not found" }, 404);
    const baseUrl = normalizeBaseUrl((provider["baseUrl"] ?? "") as string) ??
      "";
    await db.faspProviders.updateByBaseUrl(baseUrl, {
      capabilities,
      updatedAt: new Date(),
    });
    if (baseUrl) {
      // FASP に有効化/無効化を通知
      await Promise.all(
        Object.entries(capabilities).map(([id, info]) =>
          notifyCapabilityActivation(
            db,
            env,
            domain,
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
  const domain = getDomain(c);
  const serverId = c.req.param("serverId");
  const rec = await db.faspProviders.findOne({ serverId }) as
    | Record<string, unknown>
    | null;
  if (!rec) return c.json({ error: "not found" }, 404);
  const baseUrl = normalizeBaseUrl((rec["baseUrl"] ?? "") as string);
  if (!baseUrl) return c.json({ error: "baseUrl missing" }, 400);
  try {
    const res = await faspFetch(db, env, domain, `${baseUrl}/provider_info`, {
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
  const db = getDB(c);
  const doc = await db.faspProviders.getSettings();
  return c.json({
    searchServerId: doc?.searchServerId ?? null,
    shareEnabled: doc?.shareEnabled ?? true,
    shareServerIds: doc?.shareServerIds ?? null,
  });
});

app.put("/api/fasp/settings", async (c) => {
  try {
    const db = getDB(c);
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
    await db.faspProviders.upsertByBaseUrl("default", {
      ...update,
      updatedAt: new Date(),
    }, {
      _id: "default",
      createdAt: new Date(),
    } as Record<string, unknown>);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});
