// Cloudflare Workers: パススルー型プロキシ
// - すべてのリクエストを ORIGIN_URL へ転送します（同一 URL への自己フェッチは行わない）
// - テナント判定は x-forwarded-host を用いてオリジン側で行う想定

export interface Env {
  // 開発用: 強制テナントホスト（x-forwarded-host に適用）
  TENANT_HOST?: string;
  // 既存 Deno ホストなど、プロキシ先のベース URL（例: https://api.example.com）
  ORIGIN_URL?: string;
  // OAuth クライアント情報（必要に応じてヘッダでオリジンへ伝達）
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

function buildOriginTarget(env: Env, req: Request): URL | null {
  const base = (env.ORIGIN_URL || "").trim().replace(/\/$/, "");
  if (!base) return null;
  const u = new URL(req.url);
  return new URL(base + u.pathname + u.search);
}

async function proxyToOrigin(
  env: Env,
  req: Request,
  extraHeaders?: Record<string, string>,
) {
  const originalUrl = new URL(req.url);
  const target = buildOriginTarget(env, req);
  if (!target) {
    return new Response(
      "ORIGIN_URL が未設定です。wrangler.toml の [vars] か .dev.vars で ORIGIN_URL を設定してください。",
      { status: 500 },
    );
  }

  const headers = new Headers(req.headers);
  // オリジン側は x-forwarded-host を優先してテナント判定
  headers.set("x-forwarded-host", env.TENANT_HOST?.trim() || originalUrl.host);
  headers.set("x-forwarded-proto", originalUrl.protocol.replace(":", ""));
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }

  const method = req.method.toUpperCase();
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    // Body は一度しか読めないため、ここで転送
    init.body = req.body ?? undefined;
  }

  try {
    const outbound = new Request(target.toString(), init);
    return await fetch(outbound);
  } catch (e) {
    // ネットワーク到達不可などの際に 522 ではなく 502 を返す
    const msg = (e as Error)?.message ?? String(e);
    return new Response(`Bad Gateway: ${msg}`.slice(0, 1024), { status: 502 });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    let extra: Record<string, string> | undefined;
    // Google OAuth の開始/コールバック時のみ、クライアント情報をヘッダで伝達可能にする
    if (
      pathname === "/auth/google/start" || pathname === "/auth/google/callback"
    ) {
      extra = {};
      if (env.GOOGLE_CLIENT_ID) {
        extra["x-google-client-id"] = env.GOOGLE_CLIENT_ID;
      }
      if (env.GOOGLE_CLIENT_SECRET) {
        extra["x-google-client-secret"] = env.GOOGLE_CLIENT_SECRET;
      }
    }
    return await proxyToOrigin(env, req, extra);
  },
};
