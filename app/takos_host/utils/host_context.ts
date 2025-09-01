import { dirname, fromFileUrl, join } from "@std/path";
import type { Context } from "hono";
import { loadConfig } from "@takos/config";
import {
  createDB,
  createPrismaHostDataStore,
  setStoreFactory,
} from "@takos_host/db";
import { getEnvPath } from "@takos/config";
import { createTakosApp } from "../../core/create_takos_app.ts";
import { getSystemKey } from "../../core/services/system_actor.ts";
import { takosEnv } from "../takos_env.ts";
import { createConsumerApp } from "../consumer.ts";
import { createAuthApp } from "../auth.ts";
import oauthApp from "../oauth.ts";
import { createRootActivityPubApp } from "../root_activitypub.ts";
import { createServiceActorApp } from "../service_actor.ts";
import type { HostDataStore } from "../db/types.ts";
import { FCM_KEYS } from "./host_constants.ts";

// Light-weight text file loader (returns empty string on failure)
async function loadTextFile(
  path: string | URL,
  label: string,
): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    console.error(
      `${label} ${path} を読み込めませんでした`,
      e instanceof Error ? e.message : e,
    );
    return "";
  }
}

export interface HostContext {
  hostEnv: Record<string, string>;
  rootDomain: string;
  freeLimit: number;
  reservedSubdomains: string[];
  termsText: string;
  notFoundHtml: string;
  authApp: ReturnType<typeof createAuthApp>;
  consumerApp: ReturnType<typeof createConsumerApp>;
  oauthApp: typeof oauthApp;
  rootActivityPubApp: ReturnType<typeof createRootActivityPubApp> | null;
  serviceActorApp: ReturnType<typeof createServiceActorApp> | null;
  isDev: boolean;
}

export async function initHostContext(): Promise<HostContext> {
  const envPath = getEnvPath();
  const defaultEnvPath = join(dirname(fromFileUrl(import.meta.url)), "../.env");
  const hostEnv = await loadConfig({ envPath: envPath ?? defaultEnvPath });
  // ホストは Prisma（libsql/D1）を常用
  setStoreFactory((e) =>
    createPrismaHostDataStore(e, { tenantId: e["ACTIVITYPUB_DOMAIN"], multiTenant: true })
  );

  const rootDomain = (hostEnv["ACTIVITYPUB_DOMAIN"] ?? "").toLowerCase();
  if (rootDomain) {
    const db = createDB(hostEnv);
    await getSystemKey(db, rootDomain);
  }
  const rootActivityPubApp = rootDomain
    ? createRootActivityPubApp({ ...takosEnv, ACTIVITYPUB_DOMAIN: rootDomain })
    : null;
  const serviceActorApp = rootDomain
    ? createServiceActorApp({ ...takosEnv, ACTIVITYPUB_DOMAIN: rootDomain })
    : null;
  const freeLimit = Number(hostEnv["FREE_PLAN_LIMIT"] ?? "1");
  const reservedSubdomains = (hostEnv["RESERVED_SUBDOMAINS"] ?? "").split(",")
    .map((s) => s.trim().toLowerCase()).filter(Boolean);
  const termsPath = hostEnv["TERMS_FILE"];
  const termsText = termsPath
    ? await loadTextFile(termsPath, "TERMS_FILE")
    : "";
  const notFoundHtml = await loadTextFile(
    new URL("../404.html", import.meta.url),
    "404.html",
  );
  const consumerApp = createConsumerApp((host) => apps.delete(host), {
    rootDomain,
    freeLimit,
    reservedSubdomains,
  });
  const authApp = createAuthApp({ rootDomain, termsRequired: !!termsText });
  const isDev = Deno.env.get("DEV") === "1";

  return {
    hostEnv,
    rootDomain,
    freeLimit,
    reservedSubdomains,
    termsText,
    notFoundHtml,
    authApp,
    consumerApp,
    oauthApp,
    rootActivityPubApp,
    serviceActorApp,
    isDev,
  };
}

// ---- Host / tenant app resolution ----
const apps = new Map<string, import("hono").Hono>();
const appInitPromises = new Map<string, Promise<import("hono").Hono | null>>();

export const parseHost = (value: string | undefined): string =>
  value?.split(":")[0].toLowerCase() ?? "";
export const isRootHost = (h: string, rootDomain?: string) =>
  !!rootDomain && h === rootDomain;

/**
 * 開発時（DEV=1）に ACTIVITYPUB_DOMAIN が未設定の場合、
 * localhost/127.0.0.1（および明示的な SERVER_HOST）をポータル扱いにする。
 */
function isDevPortalHost(
  host: string,
  rootDomain: string,
  hostEnv: Record<string, string>,
): boolean {
  // 本番や rootDomain が設定済みなら通常判定
  if (rootDomain) return host === rootDomain;
  const isDev = Deno.env.get("DEV") === "1";
  if (!isDev) return false;
  const candidates = new Set<string>(["localhost", "127.0.0.1"]);
  const serverHost = (hostEnv["SERVER_HOST"] ?? "").trim().toLowerCase();
  if (
    serverHost && serverHost !== "0.0.0.0" && serverHost !== "::" &&
    serverHost !== "::1"
  ) {
    candidates.add(serverHost);
  }
  return candidates.has(host);
}

export function getRealHost(c: Context): string {
  const forwarded = c.req.header("x-forwarded-host");
  const hostHeader = c.req.header("host");
  let host = forwarded?.split(",")[0].trim() || hostHeader;
  if (!host) {
    try {
      host = new URL(c.req.url).host;
    } catch { /* ignore */ }
  }
  if (!host) {
    console.warn("Host header missing:", { forwarded, hostHeader });
    return "localhost";
  }
  return parseHost(host);
}

async function getEnvForHost(
  host: string,
  rootDomain: string,
  hostEnv: Record<string, string>,
): Promise<Record<string, string> | null> {
  host = parseHost(host);
  const baseEnv: Record<string, string> = { ...takosEnv };
  for (const k of FCM_KEYS) if (hostEnv[k]) baseEnv[k] = hostEnv[k] as string;
  // ルート（ポータル）ドメインは takos アプリを作らない
  // - 本番: host === rootDomain のとき
  // - 開発: rootDomain 未設定 + localhost/127.0.0.1（または SERVER_HOST）
  if (isDevPortalHost(host, rootDomain, hostEnv)) {
    return null;
  }
  const db = createDB(hostEnv) as HostDataStore;
  const inst = await db.host.findInstanceByHost(host);
  if (!inst) return null;
  return { ...baseEnv, ...(inst.env ?? {}), ACTIVITYPUB_DOMAIN: host };
}

export async function getAppForHost(
  host: string,
  ctx: HostContext,
): Promise<import("hono").Hono | null> {
  host = parseHost(host);
  const existing = apps.get(host);
  if (existing) return existing;
  const inflight = appInitPromises.get(host);
  if (inflight) return await inflight;
  const p = (async () => {
    const appEnv = await getEnvForHost(host, ctx.rootDomain, ctx.hostEnv);
    if (!appEnv) return null;
    const db = createDB(ctx.hostEnv) as HostDataStore;
    await db.tenant.ensure(host);
    // テナント環境用のシステム鍵を用意
    const tenantDb = createDB(appEnv) as HostDataStore;
    await getSystemKey(tenantDb, host).catch(() => {});
    const app = await createTakosApp(appEnv, tenantDb);
    apps.set(host, app);
    return app;
  })();
  appInitPromises.set(host, p);
  const result = await p.finally(() => appInitPromises.delete(host));
  return result;
}
