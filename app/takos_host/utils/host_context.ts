import { dirname, fromFileUrl, join } from "@std/path";
import type { Context } from "hono";
import { loadConfig } from "@takos/config";
import {
  connectDatabase,
  createDB,
  createMongoDataStore,
  setStoreFactory,
} from "@takos_host/db";
import { getEnvPath } from "@takos/config";
import { createTakosApp } from "../../core/create_takos_app.ts";
import { bootstrapDefaultFasp } from "../../core/services/fasp_bootstrap.ts";
import { getSystemKey } from "../../core/services/system_actor.ts";
import { takosEnv } from "../takos_env.ts";
import { createConsumerApp } from "../consumer.ts";
import { createAuthApp } from "../auth.ts";
import oauthApp from "../oauth.ts";
import { createRootActivityPubApp } from "../root_activitypub.ts";
import { createServiceActorApp } from "../service_actor.ts";
import type { DataStore } from "../../core/db/types.ts";
import type { HostDataStore } from "../db/types.ts";
import Instance from "../models/instance.ts";
import FaspClient from "../models/fasp_client.ts";
import {
  FASP_PROVIDER_INFO_PATHS,
  FCM_KEYS,
  isTruthyFlag,
} from "./host_constants.ts";

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
  faspServerDisabled: boolean;
  defaultFaspBaseUrl: string;
  isDev: boolean;
}

export async function initHostContext(): Promise<HostContext> {
  const envPath = getEnvPath();
  const defaultEnvPath = join(dirname(fromFileUrl(import.meta.url)), "../.env");
  const hostEnv = await loadConfig({ envPath: envPath ?? defaultEnvPath });
  await connectDatabase(hostEnv);
  // ホスト環境では新抽象(Store)を注入
  setStoreFactory((e) => createMongoDataStore(e, { multiTenant: true }));

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
  const faspServerDisabled = isTruthyFlag(hostEnv["FASP_SERVER_DISABLED"]);
  const defaultFaspBaseUrl = (hostEnv["FASP_DEFAULT_BASE_URL"] ?? "").trim();

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
    faspServerDisabled,
    defaultFaspBaseUrl,
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
  if (isRootHost(host, rootDomain)) {
    return { ...baseEnv, ACTIVITYPUB_DOMAIN: rootDomain };
  }
  const inst = await Instance.findOne({ host }).lean();
  if (!inst || Array.isArray(inst)) return null;
  return { ...baseEnv, ...inst.env, ACTIVITYPUB_DOMAIN: host };
}

function canonicalizeFaspBaseUrl(u: string): string {
  let b = u.trim();
  if (!/^https?:\/\//i.test(b)) b = `https://${b}`;
  try {
    const url = new URL(b);
    url.hash = "";
    url.search = "";
    let p = url.pathname.replace(/\/+$/, "");
    if (p.endsWith("/provider_info")) {
      p = p.slice(0, -"/provider_info".length);
    }
    if (p === "/") p = "";
    return `${url.origin}${p}`.replace(/\/$/, "");
  } catch {
    return u.replace(/\/$/, "");
  }
}

async function seedDefaultFasp(
  appEnv: Record<string, string>,
  host: string,
  defaultFaspBaseUrl: string,
  tenantDb: DataStore,
) {
  if (!defaultFaspBaseUrl) return;
  try {
    const normalized = canonicalizeFaspBaseUrl(defaultFaspBaseUrl);
    // deno-lint-ignore no-explicit-any
    const mongo = await tenantDb.raw?.() as any;
    const fasps = mongo.collection("fasp_client_providers");
    const tenantId = appEnv["ACTIVITYPUB_DOMAIN"] ?? "";
    const exists = await fasps.findOne({
      tenant_id: tenantId,
      baseUrl: normalized,
    });
    const secret = (exists?.secret as string | undefined) ??
      btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    if (!exists) {
      await fasps.insertOne({
        name: normalized,
        baseUrl: normalized,
        serverId: `default:${crypto.randomUUID()}`,
        status: "approved",
        capabilities: {},
        secret,
        tenant_id: tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } else if (!exists.secret) {
      await fasps.updateOne({ _id: exists._id, tenant_id: tenantId }, {
        $set: { secret, updatedAt: new Date() },
      });
    }
    await FaspClient.updateOne({ tenant: host }, {
      $set: { tenant: host, secret },
    }, { upsert: true }).catch(() => {});
    await bootstrapDefaultFasp({
      ...appEnv,
      FASP_DEFAULT_BASE_URL: defaultFaspBaseUrl,
    }, host).catch(() => {});
  } catch { /* ignore */ }
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
    await db.tenant.ensure(host, host);
    // テナント環境用のシステム鍵を用意
    const tenantDb = createDB(appEnv);
    await getSystemKey(tenantDb, host).catch(() => {});
    await seedDefaultFasp(appEnv, host, ctx.defaultFaspBaseUrl, tenantDb);
    const app = await createTakosApp(appEnv, tenantDb);
    apps.set(host, app);
    return app;
  })();
  appInitPromises.set(host, p);
  const result = await p.finally(() => appInitPromises.delete(host));
  return result;
}

export { FASP_PROVIDER_INFO_PATHS };
