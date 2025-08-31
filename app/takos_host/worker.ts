// Cloudflare Workers エントリポイント（最小構成）
// - 静的ファイルは Workers Assets（binding: ASSETS）から配信
// - 動的 API は既存の Deno ホストへプロキシ（環境変数 ORIGIN_URL）
// - 既存のサーバー実装や Mongo 依存には触れず、エッジ層のみ提供

// Deno でも型解決できる最小形の Assets バインディング型
interface AssetsBinding {
  fetch(req: Request): Promise<Response>;
}

export interface Env {
  // wrangler.toml の [assets] で設定するバインディング
  ASSETS: AssetsBinding;
  // 動的 API のプロキシ先（例: https://your-deno-host.example）
  ORIGIN_URL?: string;
  // 開発用: 強制テナントホスト（x-forwarded-host に適用）
  TENANT_HOST?: string;
  // ルート（ホスト）ドメイン。未設定時はリクエストの Host を既定にする
  ACTIVITYPUB_DOMAIN?: string;
}

function stripPrefix(path: string, prefix: string): string {
  return path.replace(new RegExp(`^${prefix}`), "") || "/";
}

function withPath(url: URL, newPath: string): URL {
  const u = new URL(url);
  u.pathname = newPath;
  return u;
}

async function serveFromAssets(env: Env, req: Request, rewriteTo?: string) {
  if (!env.ASSETS) {
    return new Response("ASSETS binding not found", { status: 500 });
  }
  const url = new URL(req.url);
  const assetUrl = rewriteTo ? withPath(url, rewriteTo) : url;
  const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), req));
  return res;
}

function requireOrigin(env: Env): string | null {
  const origin = env.ORIGIN_URL?.replace(/\/$/, "") ?? null;
  return origin;
}

// ルート（ポータル）ドメインの決定ロジック
// - 優先: 環境変数 ACTIVITYPUB_DOMAIN（明示的なホストドメイン）
// - 次点: ORIGIN_URL のホスト名（オリジンのドメインをルートとして扱う）
// - それ以外: 判定不能（null）
function getRootDomain(env: Env): string | null {
  const explicit = env.ACTIVITYPUB_DOMAIN?.trim();
  if (explicit) return explicit.toLowerCase();
  const origin = env.ORIGIN_URL?.trim();
  if (origin) {
    try {
      return new URL(origin).hostname.toLowerCase();
    } catch {
      // ignore
    }
  }
  return null;
}

// Host 情報の解析（hostname, sub, label, portal 判定）
function parseHostInfo(env: Env, req: Request) {
  const u = new URL(req.url);
  const hostname = u.hostname.toLowerCase();
  const base = getRootDomain(env);
  const inZone = base ? (hostname === base || hostname.endsWith(`.${base}`)) : true;
  const sub = base && hostname.endsWith(`.${base}`)
    ? hostname.slice(0, -(base.length + 1))
    : "";
  const [label] = sub ? sub.split(".") : [""];
  const isPortal = !!base && (hostname === base || hostname === `www.${base}`);
  return { hostname, base, label, sub, inZone, isPortal } as const;
}

async function proxyToOrigin(
  env: Env,
  req: Request,
  rewrite?: (path: string) => string,
) {
  const origin = requireOrigin(env);
  if (!origin) {
    return new Response("ORIGIN_URL is not configured", { status: 500 });
  }
  const u = new URL(req.url);
  const path = rewrite ? rewrite(u.pathname) : u.pathname;
  const target = new URL(origin + path + u.search);
  const headers = new Headers(req.headers);
  // テナント解決用（サーバー側は x-forwarded-host を優先）
  headers.set("x-forwarded-host", env.TENANT_HOST?.trim() || u.host);
  headers.set("x-forwarded-proto", u.protocol.replace(":", ""));
  const method = req.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers,
  };
  if (method !== "GET" && method !== "HEAD") {
    // Body は一度しか読めないため、ここで転送
    init.body = req.body ?? undefined;
  }
  const outbound = new Request(target.toString(), init);
  return await fetch(outbound);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method.toUpperCase();
    const requestHost = url.host.toLowerCase();
    const rootDomain = getRootDomain(env);
    const info = parseHostInfo(env, req);
    const isPortalHost2 = info.isPortal;
    if (info.base && !info.inZone) {
      return new Response("Forbidden", { status: 403 });
    }
    // ルートドメインが判定できない場合は、誤ってポータル扱いしない（= テナント扱いに倒す）
    const isPortalHost = !!rootDomain && (requestHost === rootDomain || requestHost === `www.${rootDomain}`);
    
    // テナントドメインの動的メソッドは無条件でオリジンへ
    if (method !== "GET" && method !== "HEAD" && !isPortalHost2) {
      return await proxyToOrigin(env, req);
    }

    // 非 GET/HEAD はすべてオリジンへ（動的 API）
    if (method !== "GET" && method !== "HEAD") {
      if (pathname.startsWith("/user/")) {
        return await proxyToOrigin(env, req, (p) => stripPrefix(p, "/user"));
      }
      return await proxyToOrigin(env, req);
    }

    // /user（エントリ） → index.html
    // テナントドメイン（ポータル以外）は常にオリジン優先で配信
    if (!isPortalHost2) {
      const originRes = await proxyToOrigin(env, req);
      return originRes;
    }

    if (pathname === "/user" || pathname === "/user/") {
      return await serveFromAssets(env, req, "/index.html");
    }
    // GET /user/*: まず静的（/user を剥がす）→ 404 ならオリジンへ
    if (pathname.startsWith("/user/")) {
      const rewritten = stripPrefix(pathname, "/user");
      const staticRes = await serveFromAssets(env, req, rewritten);
      if (staticRes.status !== 404) return staticRes;
      return await proxyToOrigin(env, req, (p) => stripPrefix(p, "/user"));
    }

    // /auth（エントリ） → index.html
    if (pathname === "/auth" || pathname === "/auth/") {
      return await serveFromAssets(env, req, "/index.html");
    }
    // GET /auth/*: OAuth の開始（*/start）はオリジンへプロキシしてリダイレクトやセットクッキーを処理させる
    // それ以外はまず静的（/auth を剥がす）→ 404 ならオリジンへ
    if (pathname.startsWith("/auth/")) {
      // 例: /auth/google/start や /auth/oidc/start などはオリジンで処理
      if (/\/(start|callback)\/?$/.test(pathname)) {
        return await proxyToOrigin(env, req);
      }
      const rewritten = stripPrefix(pathname, "/auth");
      const staticRes = await serveFromAssets(env, req, rewritten);
      if (staticRes.status !== 404) return staticRes;
      return await proxyToOrigin(env, req);
    }

    // ホストの代表エンドポイントはオリジン優先
    if (
      pathname.startsWith("/oauth") ||
      pathname === "/actor" ||
      pathname === "/inbox" ||
      pathname === "/outbox" ||
      pathname.startsWith("/.well-known/")
    ) {
      return await proxyToOrigin(env, req);
    }

    // それ以外の GET/HEAD:
    // 1) まず静的アセット
    const res = await serveFromAssets(env, req);
    if (res.status !== 404) return res;
    // 2) 次にオリジン（AP/テナント動的）
    const originRes = await proxyToOrigin(env, req);
    if (originRes.status !== 404) return originRes;
    // 3) 最後に SPA フォールバック（index.html）
    return await serveFromAssets(env, req, "/index.html");
  },
};
