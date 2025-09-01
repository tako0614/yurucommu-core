// Cloudflare Workers: takos host API (D1 + R2)
// - こ�Eワーカーは /auth/* と /user/* の最封EAPI を直接提供（サーバ用依存を回避�E�E
// - DB は D1、ストレージは R2。メール送信は未実裁E��検証コード�E発行�Eみ�E�E

import { Hono } from "hono";
import { setStoreFactory } from "../core/db/mod.ts";
import { type D1Database } from "./db/d1_store.ts";
import { createPrismaHostDataStore } from "./db/prisma_store.ts";
import { D1_SCHEMA } from "./db/d1/schema.ts";

// 最小�E Assets バインチE��ング

export interface Env {
  // D1 バインチE��ング
  TAKOS_HOST_DB: D1Database;
  // R2 バインチE��ング名！Env[R2_BUCKET] めEglobalThis へマップ！E
  // 忁E��化: Workers 上では D1 と R2 を忁E��とする
  OBJECT_STORAGE_PROVIDER: string; // "r2" を推奨
  R2_BUCKET: string; // 侁E "TAKOS_R2"
  // Host 設宁E
  ACTIVITYPUB_DOMAIN?: string;
  FREE_PLAN_LIMIT?: string;
  RESERVED_SUBDOMAINS?: string; // comma separated
  // チE��ント�Eオリジン�E�Eeno サーバ）へ委譲するための転送�E
  // ORIGIN_URL は廁E���E��E処琁E�� Workers で実行！E
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Wrangler Assets バインチE��ング�E��Eータルの静的配信に使用�E�E
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

// 静的アセチE��配信は廁E���E�Eorkers 側では行わなぁE��E

// ORIGIN_URL プロキシは廁E���E��E処琁E�� Workers 冁E��完結させる�E�E

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // 忁E��チェチE��: D1 と R2 のバインチE��ングを忁E��化
    if (!env.TAKOS_HOST_DB) {
      return new Response("TAKOS_HOST_DB binding is required", { status: 500 });
    }
    if (!env.OBJECT_STORAGE_PROVIDER) {
      return new Response("OBJECT_STORAGE_PROVIDER env is required", {
        status: 500,
      });
    }
    if (!env.R2_BUCKET) {
      return new Response("R2_BUCKET env is required", { status: 500 });
    }
    // 開発晁E D1 スキーマを�E��E等に�E�適用
    const _g = globalThis as unknown as { _takos_d1_inited?: boolean };
    if (!_g._takos_d1_inited) {
      try {
        const stmts = D1_SCHEMA.split(/;\s*(?:\n|$)/).map((s) => s.trim())
          .filter(Boolean);
        for (const sql of stmts) {
          await env.TAKOS_HOST_DB.prepare(sql).run();
        }
      } catch (e) {
        // 失敗しても�Eに進む�E�本番は migrations を推奨�E�E
        console.warn("D1 schema init warning:", (e as Error).message ?? e);
      }
      _g._takos_d1_inited = true;
    }
    // R2 バインチE��ングめEglobalThis に公開！EreateObjectStorage が参照�E�E
    mapR2BindingToGlobal(env);

  // Prisma(D1) チE�EタストアめEHost 用に差し込む
    const requestHost = new URL(req.url).host.toLowerCase();
    // ポ�Eタル判定�E ACTIVITYPUB_DOMAIN のみを基準にする�E�未設定なら�Eータル無し！E
    const portalDomain = env.ACTIVITYPUB_DOMAIN?.toLowerCase() ?? null;
    const isPortalHost = !!portalDomain &&
      (requestHost === portalDomain || requestHost === `www.${portalDomain}`);
    // チE��ント�Eスト�Eすべてオリジン�E�Eakos�E�へ委譲
    if (!isPortalHost) {
      return fetch(req);
    }
    // 既存�E rootDomain は DB チE��ンチEID に用ぁE���E�互換のため requestHost フォールバックを維持E��E
    const rootDomain = (env.ACTIVITYPUB_DOMAIN ?? requestHost).toLowerCase();
    const freeLimit = Number(env.FREE_PLAN_LIMIT ?? "1");
    const reserved = (env.RESERVED_SUBDOMAINS ?? "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

    // 環墁E��数を忁E��値として直接渡す！Ears にフォールバックしなぁE��E
    setStoreFactory(() =>
      createPrismaHostDataStore(
        {
          OBJECT_STORAGE_PROVIDER: env.OBJECT_STORAGE_PROVIDER,
          R2_BUCKET: env.R2_BUCKET,
          ACTIVITYPUB_DOMAIN: rootDomain,
        },
        { d1: env.TAKOS_HOST_DB, tenantId: rootDomain, multiTenant: true },
      )
    );

    // ヘルパ�E
    const SESSION_COOKIE = "hostSessionId";
    const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
    const db = () =>
      (globalThis as unknown as { _db: ReturnType<typeof createPrismaHostDataStore> })
        ._db;
    // グローバル DB インスタンスめEenv の値を使って作�E
    (globalThis as unknown as { _db?: ReturnType<typeof createPrismaHostDataStore> })
      ._db ??= createPrismaHostDataStore(
        {
          OBJECT_STORAGE_PROVIDER: env.OBJECT_STORAGE_PROVIDER,
          R2_BUCKET: env.R2_BUCKET,
          ACTIVITYPUB_DOMAIN: rootDomain,
        },
        { d1: env.TAKOS_HOST_DB, tenantId: rootDomain, multiTenant: true },
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

    // Hono アプリ構築（最小！E
    const app = new Hono({ strict: false });
    const onlyPortal = async (_c: unknown, next: () => Promise<void>) => {
      if (!isPortalHost) return new Response("Not Found", { status: 404 });
      return await next();
    };

    // Assets 経由でクライアンチESPA)を返すためのユーチE��リチE��
    function urlWithPath(req: Request, toPath: string) {
      const u = new URL(req.url);
      u.pathname = toPath;
      u.search = "";
      u.hash = "";
      return new Request(u.toString(), req);
    }
    async function serveClient(env: Env, req: Request): Promise<Response> {
      if (!env.ASSETS) return new Response("Not Found", { status: 404 });
      // まず要求パスのまま静的配信を試ぁE
      let r = await env.ASSETS.fetch(req);
      if (r.status !== 404) return r;
      // SPA フォールバック�E�Endex.html�E�E
      r = await env.ASSETS.fetch(urlWithPath(req, "/"));
      return r.status !== 404 ? r : new Response("Not Found", { status: 404 });
    }

    // ---- OAuth (Workers 実裁E ----
    const CODE_TTL = 10 * 60 * 1000;
    const TOKEN_TTL = 24 * 60 * 60 * 1000;

  app.get("/oauth/authorize", onlyPortal, async (c) => {
      const clientId = c.req.query("client_id");
      const redirectUri = c.req.query("redirect_uri");
      const state = c.req.query("state") ?? "";
      if (!clientId || !redirectUri) return jsonRes({ error: "invalid_request" }, 400);
  // db().oauth.find は clientSecret しか返してなぁE��め、redirect_uri 検証を簡略匁E
      // 本番では redirect_uri も保持し検証する忁E��あり！Ereate で保存済み�E�E
      const ok = !!(await env.TAKOS_HOST_DB.prepare(
        "SELECT redirect_uri FROM oauth_clients WHERE client_id = ?1"
      ).bind(clientId).first<{ redirect_uri?: string }>());
      if (!ok) return jsonRes({ error: "invalid_client" }, 400);
      const cookies = toCookieMap(c.req.header("cookie") ?? null);
      const sid = cookies[SESSION_COOKIE];
      if (!sid) {
        // 続き先を Cookie に保存して /auth へ
        const secure = c.req.url.startsWith("https://");
        const expires = new Date(Date.now() + 10 * 60 * 1000);
        const nextUrl = new URL(c.req.url).toString();
        const headers = new Headers({
          Location: "/auth",
          "set-cookie": setCookieHeader("oauth_next", nextUrl, secure, expires),
        });
        return new Response(null, { status: 302, headers });
      }
      const sess = await db().hostSessions.findById(sid);
      if (!sess || sess.expiresAt <= new Date()) {
        const secure = c.req.url.startsWith("https://");
        const expires = new Date(Date.now() + 10 * 60 * 1000);
        const nextUrl = new URL(c.req.url).toString();
        const headers = new Headers({
          Location: "/auth",
          "set-cookie": setCookieHeader("oauth_next", nextUrl, secure, expires),
        });
        return new Response(null, { status: 302, headers });
      }
      const code = crypto.randomUUID();
      const exp = Date.now() + CODE_TTL;
      await env.TAKOS_HOST_DB.prepare(
        "INSERT INTO oauth_codes (code, client_id, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
      ).bind(code, clientId, sess.user, exp, Date.now()).run();
      const u = new URL(redirectUri);
      u.searchParams.set("code", code);
      if (state) u.searchParams.set("state", state);
      return c.redirect(u.toString());
    });

    app.post("/oauth/token", onlyPortal, async (c) => {
      const body = await c.req.formData();
      const grantType = body.get("grant_type");
      const code = body.get("code");
      const clientId = body.get("client_id");
      const clientSecret = body.get("client_secret");
      const redirectUri = body.get("redirect_uri");
      if (
        grantType !== "authorization_code" ||
        typeof code !== "string" ||
        typeof clientId !== "string" ||
        typeof clientSecret !== "string" ||
        typeof redirectUri !== "string"
      ) return jsonRes({ error: "invalid_request" }, 400);
      const row = await env.TAKOS_HOST_DB.prepare(
        "SELECT client_secret, redirect_uri FROM oauth_clients WHERE client_id = ?1"
      ).bind(clientId).first<{ client_secret?: string; redirect_uri?: string }>();
      if (!row || row.client_secret !== clientSecret || row.redirect_uri !== redirectUri) {
        return jsonRes({ error: "invalid_client" }, 400);
      }
      const codeRow = await env.TAKOS_HOST_DB.prepare(
        "SELECT user_id, expires_at FROM oauth_codes WHERE code = ?1 AND client_id = ?2"
      ).bind(code, clientId).first<{ user_id?: string; expires_at?: number }>();
      if (!codeRow || (Number(codeRow.expires_at ?? 0) <= Date.now())) {
        return jsonRes({ error: "invalid_grant" }, 400);
      }
      await env.TAKOS_HOST_DB.prepare("DELETE FROM oauth_codes WHERE code = ?1").bind(code).run();
      const token = crypto.randomUUID();
      const exp = Date.now() + TOKEN_TTL;
      await env.TAKOS_HOST_DB.prepare(
        "INSERT INTO oauth_tokens (token, client_id, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
      ).bind(token, clientId, String(codeRow.user_id ?? ""), exp, Date.now()).run();
      return jsonRes({ access_token: token, token_type: "Bearer", expires_in: Math.floor(TOKEN_TTL / 1000) });
    });

    app.post("/oauth/verify", onlyPortal, async (c) => {
      const { token } = await c.req.json().catch(() => ({} as Record<string, unknown>));
      if (typeof token !== "string") return jsonRes({ active: false }, 400);
      const row = await env.TAKOS_HOST_DB.prepare(
        "SELECT user_id, expires_at FROM oauth_tokens WHERE token = ?1"
      ).bind(token).first<{ user_id?: string; expires_at?: number }>();
      if (!row || (Number(row.expires_at ?? 0) <= Date.now())) {
        return jsonRes({ active: false }, 401);
      }
      return jsonRes({ active: true, user: { id: String(row.user_id ?? "") } });
    });

    // SPA エントリ + 主要フロントルート（�Eータルのみ�E�E
    app.use("/user", onlyPortal);
    app.use("/auth", onlyPortal);
    app.use("/signup", onlyPortal);
    app.use("/verify", onlyPortal);
    app.use("/terms", onlyPortal);
    app.use("/robots.txt", onlyPortal);
    app.get("/user", (c) => serveClient(env, c.req.raw));
    app.get("/auth", (c) => serveClient(env, c.req.raw));
    app.get("/signup", (c) => serveClient(env, c.req.raw));
    app.get("/verify", (c) => serveClient(env, c.req.raw));
    app.get("/terms", (c) => serveClient(env, c.req.raw));
    // robots.txt の静的配信は行わなぁE��別配信レイヤで処琁E��E

    // /auth/*, /user/* の GET は、API パスを除外した上で静的アセチE��へリライチE
    app.use("/auth/*", onlyPortal);
    app.get("/auth/*", async (c, next) => {
      // API GET: /auth/status は通す
      if (c.req.path === "/auth/status") return await next();
      // OAuth の開姁Eコールバックは SPA 配信をバイパス�E�サーバ�Eで処琁E��E
      if (/\/auth\/.+\/(start|callback)\/?$/.test(c.req.path)) {
        return await next();
      }
      return await serveClient(env, c.req.raw);
    });
    app.use("/user/*", onlyPortal);
    app.get("/user/*", async (c, next) => {
      // API GET 一覧は通す
      if (/^\/user\/(instances|oauth|domains)(\/|$)/.test(c.req.path)) {
        return await next();
      }
      return await serveClient(env, c.req.raw);
    });

    // ---- /auth ----
    // Google OAuth: 環墁E��数からクライアント情報を取征E
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

      // state を短朁ECookie に保存！E0 刁E��E
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
      // ト�Eクン交揁E
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
      // ユーザー惁E��
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

      // ユーザー作�E/取征E
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

      // セチE��ョン発行＋Cookie 設定、state Cookie を無効匁E
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
          emailVerified: true, // メール送信なしで即時有効化！Eorkers 環墁E���E�E
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
        emailVerified: true, // 簡略匁E
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

    // 認証ミドルウェア�E�簡易！E
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
      (_c) => jsonRes({ success: true }),
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

    // それ以外�E 404 ↁESPA フォールバック
    const res = await app.fetch(req, env);
    if (isPortalHost && res.status === 404) {
      return await serveClient(env, req);
    }
    // SPA フォールバックを行わなぁE
    return res;
  },
};
