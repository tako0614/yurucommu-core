// Cloudflare Worker: takos tenant API (run core in Workers)
// - D1 を tenant 用に使用（最小: accounts/sessions）
// - R2 はファイル保管（OBJECT_STORAGE_PROVIDER=r2 推奨）
// - 静的アセットは [assets] で配信

import { Hono as _Hono } from "hono";
import { setStoreFactory } from "../core/db/mod.ts";
import { createTakosApp } from "../core/create_takos_app.ts";
import type { D1Database } from "./db/d1_tenant_store.ts";
import { createD1TenantDataStore } from "./db/d1_tenant_store.ts";
import { D1_TENANT_SCHEMA } from "./db/d1_tenant_schema.ts";

export interface Env {
  // D1 バインディング
  TAKOS_HOST_DB: D1Database;
  // R2 バインディング名（env[R2_BUCKET] を globalThis へマップ）
  OBJECT_STORAGE_PROVIDER?: string; // "r2"
  R2_BUCKET?: string; // e.g. "takos_host_r2"
  // 静的アセット (wrangler [assets])
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
}

function mapR2BindingToGlobal(env: Env) {
  if ((env.OBJECT_STORAGE_PROVIDER ?? "").toLowerCase() !== "r2") return;
  const bucketName = env.R2_BUCKET?.trim();
  if (!bucketName) return;
  const binding = (env as unknown as Record<string, unknown>)[bucketName];
  if (binding) {
    (globalThis as unknown as Record<string, unknown>)[bucketName] = binding;
  }
}

async function assetFallback(env: Env, req: Request): Promise<Response> {
  if (!env.ASSETS) return new Response("Not Found", { status: 404 });
  const res = await env.ASSETS.fetch(req);
  if (res.status !== 404) return res;
  if (req.method === "GET" || req.method === "HEAD") {
    const u = new URL(req.url);
    u.pathname = "/index.html";
    const r = await env.ASSETS.fetch(new Request(u.toString(), req));
    if (r.status !== 404) return r;
  }
  return res;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const host = url.host.toLowerCase();

    // D1 初期化（開発時）
    const _g = globalThis as unknown as { _tenant_d1_inited?: boolean };
    if (!_g._tenant_d1_inited) {
      try {
        const stmts = D1_TENANT_SCHEMA.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
        for (const sql of stmts) await env.TAKOS_HOST_DB.prepare(sql).run();
      } catch (e) {
        console.warn("D1 tenant schema init warning:", (e as Error).message ?? e);
      }
      _g._tenant_d1_inited = true;
    }

    // R2 バインディングを公開
    mapR2BindingToGlobal(env);

    // DataStore を D1 で差し込み
    // 併せて: インスタンスごとの環境変数（OAuthなど）を D1 から取得して注入
    let instEnv: Record<string, string> = {};
    try {
      const row = await env.TAKOS_HOST_DB
        .prepare("SELECT env_json FROM instances WHERE host = ?1")
        .bind(host)
        .first<{ env_json?: string }>();
      if (row?.env_json) {
        try {
          const parsed = JSON.parse(String(row.env_json));
          if (parsed && typeof parsed === "object") instEnv = parsed as Record<string, string>;
        } catch { /* ignore JSON parse error */ }
      }
    } catch {
      // 読み取り失敗時は無視（最低限で動作継続）
    }

    const coreEnv = {
      OBJECT_STORAGE_PROVIDER: env.OBJECT_STORAGE_PROVIDER ?? "r2",
      R2_BUCKET: env.R2_BUCKET ?? "",
      // まずインスタンス環境を取り込み（OAUTH_HOST/CLIENT_ID/SECRET 等）
      ...instEnv,
      // ACTIVITYPUB_DOMAIN は常に実リクエストのホストを優先
      ACTIVITYPUB_DOMAIN: host,
    } as Record<string, string>;
    setStoreFactory(() => createD1TenantDataStore(coreEnv, env.TAKOS_HOST_DB));

    // core app を構築
    const app = await createTakosApp(coreEnv, createD1TenantDataStore(coreEnv, env.TAKOS_HOST_DB));

    // まず Hono に処理を委譲
    const res = await app.fetch(req);
    if (res.status !== 404) return res;

    // 404 は静的へフォールバック（SPA 含む）
    return assetFallback(env, req);
  },
};
