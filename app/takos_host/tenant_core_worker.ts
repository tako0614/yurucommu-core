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
  // Firebase 環境変数
  FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_STORAGE_BUCKET?: string;
  FIREBASE_MESSAGING_SENDER_ID?: string;
  FIREBASE_APP_ID?: string;
  FIREBASE_VAPID_KEY?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  // Google Ads 環境変数
  GOOGLE_ADS_CLIENT_ID?: string;
  GOOGLE_ADS_CLIENT_SECRET?: string;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  // ads.txt 内容
  ADS_TXT_CONTENT?: string;
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
  // API 系は SPA へフォールバックしない（明示的に 404 を返す）
  try {
    const p = new URL(req.url).pathname;
    if (p === "/api" || p.startsWith("/api/")) {
      return new Response("Not Found", { status: 404 });
    }
  } catch {
    // URL 解析失敗時は従来挙動にフォールバック
  }
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
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    // テナント単位・日次レート制限（takos host 側で管理）
    const DAY = Math.floor(Date.now() / 86_400_000); // UTC日単位
    async function getCount(name: string): Promise<number> {
      const row = await env.TAKOS_HOST_DB
        .prepare(
          "SELECT count FROM t_usage_counters WHERE tenant_host = ?1 AND name = ?2 AND day = ?3",
        )
        .bind(host, name, DAY)
        .first<{ count?: number }>();
      return Number(row?.count ?? 0);
    }
    async function incr(name: string, delta = 1): Promise<void> {
      const row = await env.TAKOS_HOST_DB
        .prepare(
          "SELECT count FROM t_usage_counters WHERE tenant_host = ?1 AND name = ?2 AND day = ?3",
        )
        .bind(host, name, DAY)
        .first<{ count?: number }>();
      if (row) {
        await env.TAKOS_HOST_DB
          .prepare(
            "UPDATE t_usage_counters SET count = count + ?4 WHERE tenant_host = ?1 AND name = ?2 AND day = ?3",
          )
          .bind(host, name, DAY, delta)
          .run();
      } else {
        await env.TAKOS_HOST_DB
          .prepare(
            "INSERT INTO t_usage_counters (tenant_host, name, day, count) VALUES (?1, ?2, ?3, ?4)",
          )
          .bind(host, name, DAY, delta)
          .run();
      }
    }
    async function enforceDailyLimit(name: string, limit: number): Promise<Response | null> {
      const used = await getCount(name);
      if (used + 1 > limit) {
        const headers = new Headers({
          "Content-Type": "application/json; charset=utf-8",
          "X-Daily-Limit": String(limit),
          "X-Daily-Remaining": "0",
        });
        return new Response(
          JSON.stringify({ error: "rate_limited", scope: name }),
          { status: 429, headers },
        );
      }
      await incr(name, 1);
      return null;
    }

    // ads.txt の処理
    if (pathname === "/ads.txt" && (req.method === "GET" || req.method === "HEAD")) {
      const adsTxtContent = env.ADS_TXT_CONTENT ?? "";
      return new Response(adsTxtContent, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600", // 1時間キャッシュ
        },
      });
    }

    // D1 初期化（開発時）+ 簡易移行（tenant_host 列）
    const _g = globalThis as unknown as { _tenant_d1_inited?: boolean };
    if (!_g._tenant_d1_inited) {
      try {
        const stmts = D1_TENANT_SCHEMA.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
        for (const sql of stmts) await env.TAKOS_HOST_DB.prepare(sql).run();
        // 既存テーブルに tenant_host 列がない場合に追加（NOT NULLは付与しない）
        const hasCol = async (table: string, col: string) => {
          const { results } = await env.TAKOS_HOST_DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
          return (results ?? []).some((r) => (r as unknown as { name: string }).name === col);
        };
        if (!(await hasCol("t_accounts", "tenant_host"))) {
          await env.TAKOS_HOST_DB.prepare("ALTER TABLE t_accounts ADD COLUMN tenant_host TEXT").run();
          await env.TAKOS_HOST_DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_t_accounts_tenant_username ON t_accounts(tenant_host, user_name)").run();
          await env.TAKOS_HOST_DB.prepare("CREATE INDEX IF NOT EXISTS idx_t_accounts_tenant_created ON t_accounts(tenant_host, created_at)").run();
        }
        if (!(await hasCol("t_sessions", "tenant_host"))) {
          await env.TAKOS_HOST_DB.prepare("ALTER TABLE t_sessions ADD COLUMN tenant_host TEXT").run();
          await env.TAKOS_HOST_DB.prepare("CREATE INDEX IF NOT EXISTS idx_t_sessions_tenant_session ON t_sessions(tenant_host, session_id)").run();
        }
      } catch (e) {
        console.warn("D1 tenant schema init warning:", (e as Error).message ?? e);
      }
      _g._tenant_d1_inited = true;
    }

    // R2 バインディングを公開
    mapR2BindingToGlobal(env);

    // まず、レート制限の対象となるいくつかのパスを事前にチェック（ホスト側で全テナント共通）
    // 仕様:
    // - DM送信: /api/dm (POST) -> 10,000/日
    // - フォロー/アンフォロー: /api/follow (POST/DELETE) -> 1,000/日
    // - 投稿作成: /api/posts (POST) -> 1,000/日
    // - inbox（フォロー以外）: /inbox, /users/:name/inbox (POST) -> 1,000/日
    const DM_LIMIT = 10_000;
    const FOLLOW_LIMIT = 1_000;
    const POST_LIMIT = 1_000;
    const INBOX_NON_FOLLOW_LIMIT = 1_000;

    if (method === "POST" && pathname === "/api/dm") {
      const r = await enforceDailyLimit("dm_send", DM_LIMIT);
      if (r) return r;
    }
    if ((method === "POST" || method === "DELETE") && pathname === "/api/follow") {
      const r = await enforceDailyLimit("follow", FOLLOW_LIMIT);
      if (r) return r;
    }
  if (method === "POST" && (pathname === "/api/posts" || /^\/users\/[^/]+\/outbox$/.test(pathname))) {
      const r = await enforceDailyLimit("post_create", POST_LIMIT);
      if (r) return r;
    }
    if (method === "POST" && (pathname === "/inbox" || /^\/users\/[^/]+\/inbox$/.test(pathname))) {
      try {
        // 本体を消費しないよう clone() で読む
        const clone = req.clone();
        const text = await clone.text();
        try {
          const body = JSON.parse(text) as { type?: string };
          const type = typeof body.type === "string" ? body.type : "";
          if (type.toLowerCase() !== "follow") {
            const r = await enforceDailyLimit("inbox_non_follow", INBOX_NON_FOLLOW_LIMIT);
            if (r) return r;
          }
        } catch {
          // 形式不正でも非フォローとして扱い、負荷を抑える
          const r = await enforceDailyLimit("inbox_non_follow", INBOX_NON_FOLLOW_LIMIT);
          if (r) return r;
        }
      } catch {
        // 読み取り失敗時はスキップ（安全側に倒すにはここで制限してもよい）
      }
    }

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
      // Firebase 環境変数
      FIREBASE_API_KEY: env.FIREBASE_API_KEY ?? "",
      FIREBASE_AUTH_DOMAIN: env.FIREBASE_AUTH_DOMAIN ?? "",
      FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID ?? "",
      FIREBASE_STORAGE_BUCKET: env.FIREBASE_STORAGE_BUCKET ?? "",
      FIREBASE_MESSAGING_SENDER_ID: env.FIREBASE_MESSAGING_SENDER_ID ?? "",
      FIREBASE_APP_ID: env.FIREBASE_APP_ID ?? "",
      FIREBASE_VAPID_KEY: env.FIREBASE_VAPID_KEY ?? "",
      FIREBASE_CLIENT_EMAIL: env.FIREBASE_CLIENT_EMAIL ?? "",
      FIREBASE_PRIVATE_KEY: env.FIREBASE_PRIVATE_KEY ?? "",
      // Google Ads 環境変数
      GOOGLE_ADS_CLIENT_ID: env.GOOGLE_ADS_CLIENT_ID ?? "",
      GOOGLE_ADS_CLIENT_SECRET: env.GOOGLE_ADS_CLIENT_SECRET ?? "",
      GOOGLE_ADS_DEVELOPER_TOKEN: env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
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
    // /api は Hono 未定義なら即 404（SPA へは落とさない）
    const p = new URL(req.url).pathname;
    if (p === "/api" || p.startsWith("/api/")) {
      return new Response("Not Found", { status: 404 });
    }

    // それ以外は静的アセットへフォールバック
    return assetFallback(env, req);
  },
};
