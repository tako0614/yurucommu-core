// Cloudflare Workers: takos host API (D1 + R2)
// - このワーカーは /auth/* と /user/* の最小 API を直接提供（サーバ用依存を回避）
// - DB は D1、ストレージは R2。メール送信は未実装（検証コードは発行のみ）

import { Hono } from "hono";
import { setStoreFactory } from "../core/db/mod.ts";
import { createD1DataStore, type D1Database } from "./db/d1_store.ts";
import { D1_SCHEMA } from "./db/d1/schema.ts";

// 最小の Assets バインディング
interface AssetsBinding {
  fetch(req: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetsBinding;
  // D1 バインディング
  TAKOS_HOST_DB: D1Database;
  // R2 バインディング名（env[R2_BUCKET] を globalThis へマップ）
  OBJECT_STORAGE_PROVIDER?: string; // "r2" を推奨
  R2_BUCKET?: string; // 例: "TAKOS_R2"

  // Host 設定
  ACTIVITYPUB_DOMAIN?: string;
  FREE_PLAN_LIMIT?: string;
  RESERVED_SUBDOMAINS?: string; // comma separated
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

async function serveFromAssets(env: Env, req: Request, rewriteTo?: string) {
  const url = new URL(req.url);
  if (rewriteTo) url.pathname = rewriteTo;
  let target = url;
  // 1st fetch
  let res = await env.ASSETS.fetch(new Request(target.toString(), req));
  // Follow simple 3xx from assets (e.g., directory redirects)
  const seen = new Set<string>();
  while (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) break;
    const next = new URL(loc, target);
    const key = next.toString();
    if (seen.has(key)) break;
    seen.add(key);
    target = next;
    res = await env.ASSETS.fetch(new Request(target.toString(), req));
  }
  const headers = new Headers(res.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-worker-assets-path", target.pathname || "/");
  headers.set("x-worker-route", "assets");
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // 開発時: D1 スキーマを（冪等に）適用
    if (!(globalThis as any)._takos_d1_inited) {
      try {
        const stmts = D1_SCHEMA.split(/;\s*(?:\n|$)/).map((s) => s.trim())
          .filter(Boolean);
        for (const sql of stmts) {
          await env.TAKOS_HOST_DB.prepare(sql).run();
        }
      } catch (e) {
        // 失敗しても先に進む（本番は migrations を推奨）
        console.warn("D1 schema init warning:", (e as Error).message ?? e);
      }
      (globalThis as any)._takos_d1_inited = true;
    }
    // R2 バインディングを globalThis に公開（createObjectStorage が参照）
    mapR2BindingToGlobal(env);

    // D1 データストアを Host 用に差し込む
    const rootDomain = (env.ACTIVITYPUB_DOMAIN ?? "").toLowerCase();
    const freeLimit = Number(env.FREE_PLAN_LIMIT ?? "1");
    const reserved = (env.RESERVED_SUBDOMAINS ?? "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

    setStoreFactory((vars) =>
      createD1DataStore(
        {
          OBJECT_STORAGE_PROVIDER: env.OBJECT_STORAGE_PROVIDER ??
            vars["OBJECT_STORAGE_PROVIDER"] ?? "r2",
          R2_BUCKET: env.R2_BUCKET ?? vars["R2_BUCKET"] ?? "TAKOS_R2",
          ACTIVITYPUB_DOMAIN: vars["ACTIVITYPUB_DOMAIN"] ?? rootDomain,
        },
        env.TAKOS_HOST_DB,
        { tenantId: rootDomain, multiTenant: true },
      )
    );

    // ヘルパー
    const SESSION_COOKIE = "hostSessionId";
    const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
    const db = () =>
      (globalThis as unknown as { _db: ReturnType<typeof createD1DataStore> })
        ._db;
    (globalThis as unknown as { _db?: ReturnType<typeof createD1DataStore> })
      ._db ??= createD1DataStore(
        {
          OBJECT_STORAGE_PROVIDER: env.OBJECT_STORAGE_PROVIDER ?? "r2",
          R2_BUCKET: env.R2_BUCKET ?? "TAKOS_R2",
          ACTIVITYPUB_DOMAIN: rootDomain,
        },
        env.TAKOS_HOST_DB,
        { tenantId: rootDomain, multiTenant: true },
      );

    function toCookieMap(c: string | null): Record<string, string> {
      const out: Record<string, string> = {};
      if (!c) return out;
      for (const part of c.split(";")) {
        const [k, v] = part.split("=");
        if (k && v) out[k.trim()] = decodeURIComponent(v);
      }
      return out;
    }
    function setCookieHeader(
      name: string,
      value: string,
      secure: boolean,
      expires: Date,
    ) {
      const attrs = [
        `${name}=${encodeURIComponent(value)}`,
        `Path=/`,
        `SameSite=Lax`,
        `Expires=${expires.toUTCString()}`,
      ];
      if (secure) attrs.push("Secure");
      attrs.push("HttpOnly");
      return attrs.join("; ");
    }
    async function sha256Hex(text: string) {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest)).map((b) =>
        b.toString(16).padStart(2, "0")
      ).join("");
    }
    function jsonRes(body: unknown, status = 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }

    // Hono アプリ構築（最小）
    const app = new Hono({ strict: false });

    // SPA エントリ + 主要フロントルート
    app.get("/user", (c) => serveFromAssets(env, c.req.raw, "/index.html"));
    app.get("/auth", (c) => serveFromAssets(env, c.req.raw, "/index.html"));
    app.get("/signup", (c) => serveFromAssets(env, c.req.raw, "/index.html"));
    app.get("/verify", (c) => serveFromAssets(env, c.req.raw, "/index.html"));
    app.get("/terms", (c) => serveFromAssets(env, c.req.raw, "/index.html"));
    app.get(
      "/robots.txt",
      (c) => serveFromAssets(env, c.req.raw, "/robots.txt"),
    );

    // /auth/*, /user/* の GET は、API パスを除外した上で静的アセットへリライト
    app.get("/auth/*", async (c, next) => {
      // API GET: /auth/status は通す
      if (c.req.path === "/auth/status") return await next();
      // OAuth の開始/コールバックは SPA 配信をバイパス（サーバーで処理）
      if (/\/auth\/.+\/(start|callback)\/?$/.test(c.req.path)) {
        return await next();
      }
      const p = c.req.path.replace(/^\/auth/, "");
      return serveFromAssets(env, c.req.raw, p || "/index.html");
    });
    app.get("/user/*", async (c, next) => {
      // API GET 一覧は通す
      if (/^\/user\/(instances|oauth|domains)(\/|$)/.test(c.req.path)) {
        return await next();
      }
      const p = c.req.path.replace(/^\/user/, "");
      return serveFromAssets(env, c.req.raw, p || "/index.html");
    });

    // ---- /auth ----
    // Google OAuth: 環境変数からクライアント情報を取得
    function getGoogleEnv() {
      const clientId = env.GOOGLE_CLIENT_ID ?? "";
      const clientSecret = env.GOOGLE_CLIENT_SECRET ?? "";
      return { clientId, clientSecret };
    }
    function buildGoogleRedirect(req: Request): string {
      const u = new URL(req.url);
      u.pathname = "/auth/google/callback";
      u.search = "";
      u.hash = "";
      return u.toString();
    }

    app.get("/auth/google/start", (c) => {
      const { clientId } = getGoogleEnv();
      if (!clientId) return jsonRes({ error: "google_not_configured" }, 500);
      const redirectUri = buildGoogleRedirect(c.req.raw);
      const state = crypto.randomUUID();
      const scopes = ["openid", "email", "profile"].join(" ");
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", scopes);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("access_type", "online");
      authUrl.searchParams.set("include_granted_scopes", "true");

      // state を短期 Cookie に保存（10 分）
      const secure = c.req.url.startsWith("https://");
      const expires = new Date(Date.now() + 10 * 60 * 1000);
      const headers = new Headers({
        Location: authUrl.toString(),
        "set-cookie": setCookieHeader("g_state", state, secure, expires),
      });
      return new Response(null, { status: 302, headers });
    });

    app.get("/auth/google/callback", async (c) => {
      const { clientId, clientSecret } = getGoogleEnv();
      if (!clientId || !clientSecret) {
        return jsonRes({ error: "google_not_configured" }, 500);
      }
      const url = new URL(c.req.url);
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const cookies = toCookieMap(c.req.header("cookie") ?? null);
      if (
        !code || !state || !cookies["g_state"] || cookies["g_state"] !== state
      ) {
        return jsonRes({ error: "invalid_state" }, 400);
      }
      const redirectUri = buildGoogleRedirect(c.req.raw);
      // トークン交換
      const body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!tokenRes.ok) return jsonRes({ error: "token_exchange_failed" }, 400);
      const tokenJson = await tokenRes.json() as { access_token?: string };
      const accessToken = tokenJson.access_token ?? "";
      if (!accessToken) return jsonRes({ error: "no_access_token" }, 400);
      // ユーザー情報
      const userinfoRes = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (!userinfoRes.ok) return jsonRes({ error: "userinfo_failed" }, 400);
      const profile = await userinfoRes.json() as { email?: string };
      const email = profile.email ?? "";
      if (!email) return jsonRes({ error: "no_email" }, 400);

      // ユーザー作成/取得
      const baseName = email.split("@")[0].replace(/[^a-zA-Z0-9_\-\.]/g, "");
      async function ensureUserName(): Promise<string> {
        let candidate = baseName ||
          `user_${Math.random().toString(36).slice(2, 8)}`;
        let n = 0;
        while (true) {
          const exists = await db().hostUsers.findByUserNameOrEmail(
            candidate,
            email,
          );
          if (!exists || exists.email === email) return candidate;
          n++;
          candidate = `${baseName}_${n}`;
        }
      }
      const exists = await db().hostUsers.findByUserNameOrEmail(email, email);
      let userId: string;
      if (exists) {
        await db().hostUsers.update(exists._id, {
          emailVerified: true,
          verifyCode: null,
          verifyCodeExpires: null,
        });
        userId = exists._id;
      } else {
        const userName = await ensureUserName();
        const created = await db().hostUsers.create({
          userName,
          email,
          hashedPassword: "-",
          salt: "-",
          verifyCode: "",
          verifyCodeExpires: new Date(),
          emailVerified: true,
        });
        userId = created._id;
      }

      // セッション発行＋Cookie 設定、state Cookie を無効化
      const sid = crypto.randomUUID();
      const expires = new Date(Date.now() + SESSION_LIFETIME_MS);
      await db().hostSessions.create({
        sessionId: sid,
        user: userId,
        expiresAt: expires,
      });
      const secure = c.req.url.startsWith("https://");
      const headers = new Headers();
      headers.append(
        "set-cookie",
        setCookieHeader(SESSION_COOKIE, sid, secure, expires),
      );
      headers.append(
        "set-cookie",
        setCookieHeader("g_state", "", secure, new Date(0)),
      );
      headers.set("Location", "/user");
      return new Response(null, { status: 302, headers });
    });
    app.post("/auth/register", async (c) => {
      const { userName, email, password } = await c.req.json().catch(
        () => ({} as Record<string, unknown>),
      );
      if (
        typeof userName !== "string" || typeof email !== "string" ||
        typeof password !== "string"
      ) {
        return jsonRes({ error: "invalid" }, 400);
      }
      const exists = await db().hostUsers.findByUserNameOrEmail(
        userName,
        email,
      );
      if (exists && exists.emailVerified) {
        return jsonRes({ error: "exists" }, 400);
      }
      const salt = crypto.randomUUID();
      const hashedPassword = await sha256Hex(password + salt);
      if (exists && !exists.emailVerified) {
        await db().hostUsers.update(exists._id, {
          userName,
          email,
          salt,
          hashedPassword,
          emailVerified: true, // メール送信なしで即時有効化（Workers 環境用）
          verifyCode: null,
          verifyCodeExpires: null,
        });
        return jsonRes({ success: true });
      }
      await db().hostUsers.create({
        userName,
        email,
        hashedPassword,
        salt,
        verifyCode: "",
        verifyCodeExpires: new Date(),
        emailVerified: true, // 簡略化
      });
      return jsonRes({ success: true });
    });

    app.post("/auth/login", async (c) => {
      const { userName, password } = await c.req.json().catch(
        () => ({} as Record<string, unknown>),
      );
      if (typeof userName !== "string" || typeof password !== "string") {
        return jsonRes({ error: "invalid" }, 400);
      }
      const user = await db().hostUsers.findByUserName(userName);
      if (!user || !user.emailVerified) {
        return jsonRes({ error: "invalid" }, 401);
      }
      const ok =
        (await sha256Hex(password + user.salt)) === user.hashedPassword;
      if (!ok) return jsonRes({ error: "invalid" }, 401);
      const sid = crypto.randomUUID();
      const expires = new Date(Date.now() + SESSION_LIFETIME_MS);
      await db().hostSessions.create({
        sessionId: sid,
        user: user._id,
        expiresAt: expires,
      });
      const secure = c.req.url.startsWith("https://");
      const headers = new Headers({
        "set-cookie": setCookieHeader(SESSION_COOKIE, sid, secure, expires),
      });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers,
      });
    });

    app.get("/auth/status", async (c) => {
      const cookies = toCookieMap(c.req.header("cookie") ?? null);
      const sid = cookies[SESSION_COOKIE];
      const body = { login: false, rootDomain, termsRequired: false } as Record<
        string,
        unknown
      >;
      if (!sid) return jsonRes(body);
      const sess = await db().hostSessions.findById(sid);
      if (!sess || sess.expiresAt <= new Date()) return jsonRes(body);
      const newExp = new Date(Date.now() + SESSION_LIFETIME_MS);
      await db().hostSessions.update(sid, { expiresAt: newExp });
      const secure = c.req.url.startsWith("https://");
      const headers = new Headers({
        "set-cookie": setCookieHeader(SESSION_COOKIE, sid, secure, newExp),
      });
      return new Response(
        JSON.stringify({
          login: true,
          user: sess.user,
          rootDomain,
          termsRequired: false,
        }),
        { headers },
      );
    });

    app.delete("/auth/logout", async (c) => {
      const cookies = toCookieMap(c.req.header("cookie") ?? null);
      const sid = cookies[SESSION_COOKIE];
      if (sid) await db().hostSessions.delete(sid);
      return jsonRes({ success: true });
    });

    // 認証ミドルウェア（簡易）
    app.use("/user/*", async (c, next) => {
      const cookies = toCookieMap(c.req.header("cookie") ?? null);
      const sid = cookies[SESSION_COOKIE];
      if (!sid) return jsonRes({ error: "unauthorized" }, 401);
      const sess = await db().hostSessions.findById(sid);
      if (!sess || sess.expiresAt <= new Date()) {
        return jsonRes({ error: "unauthorized" }, 401);
      }
      (c as unknown as { userId: string }).userId = sess.user;
      await next();
    });

    // ---- /user ----
    app.get("/user/instances", async (c) => {
      const userId = (c as unknown as { userId: string }).userId;
      const list = await db().host.listInstances(userId);
      return jsonRes(list);
    });

    app.post("/user/instances", async (c) => {
      const userId = (c as unknown as { userId: string }).userId;
      const { host: rawHost, password } = await c.req.json().catch(
        () => ({} as Record<string, unknown>),
      );
      if (typeof rawHost !== "string") {
        return jsonRes({ error: "invalid" }, 400);
      }
      const over = (await db().host.countInstances(userId)) >= freeLimit;
      if (over) return jsonRes({ error: "limit" }, 400);
      const lower = rawHost.toLowerCase();
      let fullHost = lower;
      const isReserved = (s: string) => reserved.includes(s);
      if (rootDomain) {
        if (lower.includes(".")) {
          if (!lower.endsWith(`.${rootDomain}`) || lower === rootDomain) {
            return jsonRes({ error: "domain" }, 400);
          }
          const sub = lower.slice(0, -rootDomain.length - 1);
          if (isReserved(sub)) return jsonRes({ error: "reserved" }, 400);
        } else {
          if (isReserved(lower)) return jsonRes({ error: "reserved" }, 400);
          fullHost = `${lower}.${rootDomain}`;
        }
      } else if (isReserved(lower)) return jsonRes({ error: "reserved" }, 400);
      if (await db().host.findInstanceByHost(fullHost)) {
        return jsonRes({ error: "already exists" }, 400);
      }
      const envVars: Record<string, string> = {};
      if (rootDomain) {
        envVars.OAUTH_HOST = rootDomain;
        const redirect = `https://${fullHost}`;
        const clientId = redirect;
        const found = await db().oauth.find(clientId);
        const clientSecret = found?.clientSecret ?? crypto.randomUUID();
        if (!found) {
          await db().oauth.create({
            clientId,
            clientSecret,
            redirectUri: redirect,
          });
        }
        envVars.OAUTH_CLIENT_ID = clientId;
        envVars.OAUTH_CLIENT_SECRET = clientSecret;
      }
      if (typeof password === "string" && password) {
        const salt = crypto.randomUUID();
        envVars.hashedPassword = await sha256Hex(password + salt);
        envVars.salt = salt;
      }
      await db().host.createInstance({
        host: fullHost,
        owner: userId,
        env: envVars,
      });
      await db().tenant.ensure(fullHost);
      return jsonRes({ success: true, host: fullHost });
    });

    app.delete("/user/instances/:host", async (c) => {
      const userId = (c as unknown as { userId: string }).userId;
      const host = c.req.param("host").toLowerCase();
      await db().host.deleteInstance(host, userId);
      return jsonRes({ success: true });
    });

    app.get("/user/instances/:host", async (c) => {
      const userId = (c as unknown as { userId: string }).userId;
      const host = c.req.param("host").toLowerCase();
      const inst = await db().host.findInstanceByHostAndOwner(host, userId);
      if (!inst) return jsonRes({ error: "not found" }, 404);
      return jsonRes({ host: inst.host });
    });

    app.put("/user/instances/:host/password", async (c) => {
      const userId = (c as unknown as { userId: string }).userId;
      const host = c.req.param("host").toLowerCase();
      const { password } = await c.req.json().catch(
        () => ({} as Record<string, unknown>),
      );
      const inst = await db().host.findInstanceByHostAndOwner(host, userId);
      if (!inst) return jsonRes({ error: "not found" }, 404);
      const newEnv = { ...(inst.env ?? {}) } as Record<string, string>;
      if (typeof password === "string" && password) {
        const salt = crypto.randomUUID();
        newEnv.hashedPassword = await sha256Hex(password + salt);
        newEnv.salt = salt;
      } else {
        delete newEnv.hashedPassword;
        delete newEnv.salt;
      }
      await db().host.updateInstanceEnv(inst._id, newEnv);
      return jsonRes({ success: true });
    });

    app.post(
      "/user/instances/:host/restart",
      async (_c) => jsonRes({ success: true }),
    );

    // OAuth clients
    app.get(
      "/user/oauth/clients",
      async () => jsonRes(await db().oauth.list()),
    );
    app.post("/user/oauth/clients", async (c) => {
      const { clientId, clientSecret, redirectUri } = await c.req.json().catch(
        () => ({} as Record<string, unknown>),
      );
      if (
        typeof clientId !== "string" || typeof clientSecret !== "string" ||
        typeof redirectUri !== "string"
      ) return jsonRes({ error: "invalid" }, 400);
      if (await db().oauth.find(clientId)) {
        return jsonRes({ error: "exists" }, 400);
      }
      await db().oauth.create({ clientId, clientSecret, redirectUri });
      return jsonRes({ success: true });
    });

    // Domains
    app.get("/user/domains", async (c) => {
      const userId = (c as unknown as { userId: string }).userId;
      return jsonRes(await db().domains.list(userId));
    });
    app.post("/user/domains", async (c) => {
      const userId = (c as unknown as { userId: string }).userId;
      const { domain } = await c.req.json().catch(
        () => ({} as Record<string, unknown>),
      );
      if (typeof domain !== "string") return jsonRes({ error: "invalid" }, 400);
      if (await db().domains.find(domain)) {
        return jsonRes({ error: "exists" }, 400);
      }
      const token = crypto.randomUUID();
      await db().domains.create(domain, userId, token);
      return jsonRes({ success: true, token });
    });
    app.post("/user/domains/:domain/verify", async (c) => {
      const userId = (c as unknown as { userId: string }).userId;
      const domain = c.req.param("domain");
      const doc = await db().domains.find(domain, userId);
      if (!doc) return jsonRes({ error: "not found" }, 404);
      try {
        const res = await fetch(
          `http://${domain}/.well-known/takos-host-verification.txt`,
        );
        if (
          res.ok &&
          (await res.text()).trim() === (doc as { token: string }).token
        ) {
          await db().domains.verify((doc as { _id: string })._id);
          return jsonRes({ success: true });
        }
      } catch { /* ignore */ }
      return jsonRes({ error: "verify" }, 400);
    });

    // それ以外は 404 → SPA フォールバック
    const res = await app.fetch(req, env);
    if (res.status !== 404) return res;
    if (req.method === "GET") {
      return await serveFromAssets(env, req, "/index.html");
    }
    return res;
  },
};
