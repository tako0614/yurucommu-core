// Cloudflare Worker: takos tenant 配信用 (Assets + Origin プロキシ)
// - テナント用フロント (app/client/dist) を Workers Assets から配信
// - 動的リクエストは既存 Deno オリジン (ORIGIN_URL) へプロキシ
// - 同一の D1/R2 バインディングを持たせられるが、本Workerでは未使用

export interface Env {
  // 静的アセット (wrangler [assets])
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  // 既存DenoサーバーのURL (例: https://api.takos.jp または http://localhost:8787)
  ORIGIN_URL: string;
  // x-forwarded-host を固定したい開発用途
  TENANT_HOST?: string;

  // 共有DB/R2 (必要に応じて利用) ※同じDB利用のためのバインドを保持
  // deno-lint-ignore no-explicit-any
  TAKOS_HOST_DB?: any;
  OBJECT_STORAGE_PROVIDER?: string;
  R2_BUCKET?: string;
}

function buildOriginRequest(req: Request, originBase: string, overridePath?: string) {
  const u = new URL(req.url);
  const target = new URL(originBase);
  target.pathname = overridePath ?? u.pathname;
  target.search = u.search;

  const headers = new Headers(req.headers);
  headers.set("x-forwarded-host", u.host);
  headers.set("x-forwarded-proto", u.protocol.replace(":", ""));
  return new Request(target.toString(), {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    redirect: "manual",
  });
}

function shouldProxyToOrigin(method: string, path: string): boolean {
  if (method !== "GET" && method !== "HEAD") return true;
  // API 系や ActivityPub / OAuth / WebSocket などは常にオリジンへ
  if (path === "/api" || path.startsWith("/api/")) return true;
  if (path.startsWith("/.well-known")) return true;
  if (path === "/actor" || path.startsWith("/inbox") || path.startsWith("/outbox")) return true;
  if (path.startsWith("/oauth")) return true;
  if (path === "/ws" || path.startsWith("/ws/")) return true;
  return false;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!env.ORIGIN_URL) {
      return new Response("ORIGIN_URL is not configured", { status: 500 });
    }
    const url = new URL(req.url);
    const path = url.pathname;

    // 開発用: 任意に x-forwarded-host を固定
    if (env.TENANT_HOST) {
      const r = buildOriginRequest(req, env.ORIGIN_URL);
      r.headers.set("x-forwarded-host", env.TENANT_HOST);
      return fetch(r);
    }

    // 動的パスは常にオリジンへ
    if (shouldProxyToOrigin(req.method, path)) {
      return fetch(buildOriginRequest(req, env.ORIGIN_URL));
    }

    // まずはアセットをそのまま探す
    const assetRes = await env.ASSETS.fetch(req);
    if (assetRes.status !== 404) return assetRes;

    // SPA フォールバック: index.html を返す
    if (req.method === "GET" || req.method === "HEAD") {
      const u = new URL(req.url);
      u.pathname = "/index.html";
      const indexRes = await env.ASSETS.fetch(new Request(u.toString(), req));
      if (indexRes.status !== 404) return indexRes;
    }

    // それでも無ければオリジンへ最後の望みで転送
    return fetch(buildOriginRequest(req, env.ORIGIN_URL));
  },
};

