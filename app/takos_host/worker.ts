// Cloudflare Workers: パススルー型プロキシ
// - CF Assets は使わず、すべてのリクエストをオリジンへ転送します。
// - ルーティング（ポータル=takos host / テナント=takos）はオリジン側で Host ヘッダから判定します。

export interface Env {
  // 開発用: 強制テナントホスト（x-forwarded-host に適用）
  TENANT_HOST?: string;
  // OAuth: 必要に応じてヘッダでオリジンへ伝達
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

async function proxyToOrigin(
  env: Env,
  req: Request,
  extraHeaders?: Record<string, string>,
) {
  const u = new URL(req.url);
  const headers = new Headers(req.headers);
  // オリジン側は x-forwarded-host を優先してテナント判定
  headers.set("x-forwarded-host", env.TENANT_HOST?.trim() || u.host);
  headers.set("x-forwarded-proto", u.protocol.replace(":", ""));
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }

  const method = req.method.toUpperCase();
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    // Body は一度しか読めないため、ここで転送
    init.body = req.body ?? undefined;
  }

  // 同一 URL をそのままオリジンへ転送
  const outbound = new Request(req.url, init);
  return await fetch(outbound);
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
