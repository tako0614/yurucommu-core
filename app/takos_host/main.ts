import { Hono } from "hono";
import { loadConfig } from "../shared/config.ts";
import { createTakosApp } from "../api/server.ts";
import { connectDatabase } from "../shared/db.ts";
import { ensureTenant } from "../api/services/tenant.ts";
import { createDB } from "../api/DB/mod.ts";
import Instance from "./models/instance.ts";
import { createConsumerApp } from "./consumer.ts";
import { createAuthApp } from "./auth.ts";
import oauthApp from "./oauth.ts";
import { serveStatic } from "hono/deno";
import type { Context } from "hono";
import { createRootActivityPubApp } from "./root_activitypub.ts";
import { createServiceActorApp } from "./service_actor.ts";
import { logger } from "hono/logger";
import { takosEnv } from "./takos_env.ts";
import { dirname, fromFileUrl, join } from "@std/path";
import { getEnvPath } from "../shared/args.ts";

const FCM_KEYS = [
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_SENDER_ID",
  "FIREBASE_APP_ID",
  "FIREBASE_VAPID_KEY",
];

async function loadTextFile(
  path: string | URL,
  label: string,
): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    console.error(`${label} ${path} を読み込めませんでした`);
    return "";
  }
}
// コマンドライン引数から .env のパスを取得
const envPath = getEnvPath();
const defaultEnvPath = join(dirname(fromFileUrl(import.meta.url)), ".env");
const hostEnv = await loadConfig({ envPath: envPath ?? defaultEnvPath });

hostEnv["DB_MODE"] = "host";
await connectDatabase(hostEnv);

const apps = new Map<string, Hono>();
const rootDomain =
  (hostEnv["ROOT_DOMAIN"] ?? hostEnv["ACTIVITYPUB_DOMAIN"] ?? "")
    .toLowerCase();
const rootActivityPubApp = rootDomain
  ? createRootActivityPubApp({ ...takosEnv, ACTIVITYPUB_DOMAIN: rootDomain })
  : null;
const serviceActorApp = rootDomain
  ? createServiceActorApp({ ...takosEnv, ACTIVITYPUB_DOMAIN: rootDomain })
  : null;
const freeLimit = Number(hostEnv["FREE_PLAN_LIMIT"] ?? "1");
const reservedSubdomains = (hostEnv["RESERVED_SUBDOMAINS"] ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s.length > 0);
const termsPath = hostEnv["TERMS_FILE"];
const termsText = termsPath ? await loadTextFile(termsPath, "TERMS_FILE") : "";
const notFoundHtml = await loadTextFile(
  new URL("./404.html", import.meta.url),
  "404.html",
);
const consumerApp = createConsumerApp(
  (host) => {
    apps.delete(host);
  },
  { rootDomain, freeLimit, reservedSubdomains },
);
const authApp = createAuthApp({ rootDomain, termsRequired: !!termsText });
const isDev = Deno.env.get("DEV") === "1";
// takos_host の FASP 提供機能の有効/無効とデフォルトの FASP サーバー
const faspServerDisabled =
  (hostEnv["FASP_SERVER_DISABLED"] ?? "").toLowerCase() in {
    "1": true,
    "true": true,
    "yes": true,
  };
const defaultFaspBaseUrl = (hostEnv["FASP_DEFAULT_BASE_URL"] ?? "").trim();

/**
 * ホスト名部分のみを取り出すユーティリティ
 */
function parseHost(value: string | undefined): string {
  return value?.split(":")[0].toLowerCase() ?? "";
}

/**
 * リバースプロキシ環境下で実際のホストを取得する
 */
function getRealHost(c: Context): string {
  const forwarded = c.req.header("x-forwarded-host");
  const hostHeader = c.req.header("host");
  let host = forwarded?.split(",")[0].trim() || hostHeader;
  if (!host) {
    try {
      host = new URL(c.req.url).host;
    } catch (_e) {
      // ignore
    }
  }
  if (!host) {
    console.warn("Host header missing:", { forwarded, hostHeader });
    return "localhost";
  }
  return parseHost(host);
}

/**
 * 開発環境でフロントエンドをプロキシするミドルウェア
 */
const proxy =
  (prefix: string) => async (c: Context, next: () => Promise<void>) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      await next();
      return;
    }
    const path = c.req.path.replace(new RegExp(`^${prefix}`), "");
    const url = `http://localhost:1421${path}`;
    const res = await fetch(url);
    const body = await res.arrayBuffer();
    return new Response(body, { status: res.status, headers: res.headers });
  };

/**
 * サブドメインに対応する環境変数を取得する
 */
async function getEnvForHost(
  host: string,
): Promise<Record<string, string> | null> {
  host = parseHost(host);
  const baseEnv: Record<string, string> = {
    ...takosEnv,
  };
  for (const k of FCM_KEYS) {
    if (hostEnv[k]) baseEnv[k] = hostEnv[k];
  }
  if (rootDomain && host === rootDomain) {
    return { ...baseEnv, ACTIVITYPUB_DOMAIN: rootDomain };
  }
  const inst = await Instance.findOne({ host }).lean();
  if (!inst || Array.isArray(inst)) return null;
  return { ...baseEnv, ...inst.env, ACTIVITYPUB_DOMAIN: host };
}

/**
 * サブドメイン用のアプリを動的に生成する
 */
async function getAppForHost(host: string): Promise<Hono | null> {
  host = parseHost(host);
  let app = apps.get(host);
  if (app) return app;
  const appEnv = await getEnvForHost(host);
  if (!appEnv) return null;
  const db = createDB(hostEnv);
  await ensureTenant(db, host, host);
  // 既定の FASP サーバーをテナントDBへ種まき（存在しない場合のみ）
  if (defaultFaspBaseUrl) {
    try {
      let b = defaultFaspBaseUrl;
      if (!/^https?:\/\//i.test(b)) b = `https://${b}`;
      const normalized = b.replace(/\/$/, "");
      const tenantDb = createDB(appEnv);
      const mongo = await tenantDb.getDatabase();
      const fasps = mongo.collection("fasps");
      const exists = await fasps.findOne({ baseUrl: normalized });
      if (!exists) {
        await fasps.insertOne({
          name: normalized,
          baseUrl: normalized,
          serverId: `default:${crypto.randomUUID()}`,
          status: "approved",
          capabilities: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    } catch (_e) {
      // ignore seeding errors
    }
  }
  app = await createTakosApp(appEnv);
  apps.set(host, app);
  return app;
}

const root = new Hono();

root.route("/auth", authApp);
root.route("/oauth", oauthApp);
root.route("/user", consumerApp);
// FASP provider_info をホストドメインで提供（無効化されていなければ）
if (!faspServerDisabled) {
  for (
    const path of [
      "/provider_info",
      "/.well-known/fasp/provider_info",
      "/fasp/provider_info",
    ]
  ) {
    root.get(path, (c) => {
      const host = getRealHost(c);
      if (rootDomain && host !== rootDomain) {
        return c.text("not found", 404);
      }
      const name = hostEnv["SERVER_NAME"] || rootDomain || "takos";
      const body = {
        name,
        capabilities: [
          { id: "data_sharing", version: "v0" },
        ],
      };
      return c.json(body);
    });
  }
}
if (termsText) {
  root.get("/terms", () =>
    new Response(termsText, {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    }));
}

if (isDev) {
  root.use("/auth/*", proxy("/auth"));
  root.use("/user/*", proxy("/user"));
  if (rootDomain && (rootActivityPubApp || serviceActorApp)) {
    const proxyRoot = proxy("");
    root.use(async (c, next) => {
      const host = getRealHost(c);
      if (host === rootDomain) {
        if (
          serviceActorApp &&
          /^(\/actor|\/inbox|\/outbox)(\/|$)?/.test(c.req.path)
        ) {
          const resSvc = await serviceActorApp.fetch(c.req.raw);
          if (resSvc.status !== 404) return resSvc;
        }
        if (rootActivityPubApp) {
          const res = await rootActivityPubApp.fetch(c.req.raw);
          if (res.status !== 404) return res;
        }
        return await proxyRoot(c, next);
      }
      await next();
    });
  }
} else {
  // Service Actor / ActivityPub ルートを先に確認（ルートドメイン宛のみ）
  if (rootDomain && (rootActivityPubApp || serviceActorApp)) {
    root.use(async (c, next) => {
      const host = getRealHost(c);
      if (host === rootDomain) {
        if (
          serviceActorApp &&
          /^(\/actor|\/inbox|\/outbox)(\/|$)?/.test(c.req.path)
        ) {
          const resSvc = await serviceActorApp.fetch(c.req.raw);
          if (resSvc.status !== 404) return resSvc;
        }
        if (rootActivityPubApp) {
          const res = await rootActivityPubApp.fetch(c.req.raw);
          if (res.status !== 404) return res;
        }
      }
      await next();
    });
  }

  root.use(
    "/auth/*",
    serveStatic({
      root: "./client/dist",
      rewriteRequestPath: (path) => path.replace(/^\/auth/, ""),
    }),
  );
  root.use(
    "/user/*",
    serveStatic({
      root: "./client/dist",
      rewriteRequestPath: (path) => path.replace(/^\/user/, ""),
    }),
  );
}

if (!isDev && rootDomain) {
  root.use(async (c, next) => {
    const host = getRealHost(c);
    if (host === rootDomain) {
      await serveStatic({ root: "./client/dist" })(c, next);
    } else {
      await next();
    }
  });
}

root.all("/*", async (c) => {
  const host = getRealHost(c);
  if (rootDomain && host === rootDomain && rootActivityPubApp) {
    return rootActivityPubApp.fetch(c.req.raw);
  }
  const app = await getAppForHost(host);
  if (!app) {
    if (!isDev && notFoundHtml) {
      return new Response(notFoundHtml, {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return c.text("not found", 404);
  }
  return app.fetch(c.req.raw);
});

root.use(logger());
const hostname = hostEnv["SERVER_HOST"];
// サーバーのポート番号 (未指定時は 80)
const port = Number(hostEnv["SERVER_PORT"] ?? "80");
const cert = hostEnv["SERVER_CERT"]?.replace(/\\n/g, "\n");
const key = hostEnv["SERVER_KEY"]?.replace(/\\n/g, "\n");

if (cert && key) {
  try {
    Deno.serve({ hostname, port, cert, key }, root.fetch);
  } catch (e) {
    console.error("SSL証明書の設定に失敗しました:", e);
    Deno.serve({ hostname, port }, root.fetch);
  }
} else {
  Deno.serve({ hostname, port }, root.fetch);
}
