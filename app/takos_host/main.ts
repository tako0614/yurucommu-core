import { Hono } from "hono";
import { load } from "jsr:@std/dotenv";
import { createTakosApp } from "../api/server.ts";
import { connectDatabase } from "../api/db.ts";
import { ensureTenant } from "../api/services/tenant.ts";
import Instance from "./models/instance.ts";
import { createConsumerApp } from "./consumer.ts";
import { createAuthApp } from "./auth.ts";
import oauthApp from "./oauth.ts";
import { serveStatic } from "hono/deno";
import type { Context } from "hono";
const env = await load();
await connectDatabase(env);

const apps = new Map<string, Hono>();
const rootDomain = (env["ROOT_DOMAIN"] ?? "").toLowerCase();
const freeLimit = Number(env["FREE_PLAN_LIMIT"] ?? "1");
const consumerApp = createConsumerApp(
  (host) => {
    apps.delete(host);
  },
  { rootDomain, freeLimit },
);
const authApp = createAuthApp({ rootDomain });
const isDev = Deno.env.get("DEV") === "1";

function parseHost(value: string | undefined): string {
  return value?.split(":")[0].toLowerCase() ?? "";
}

function getRealHost(c: Context): string {
  const forwarded = c.req.header("x-forwarded-host");
  const host = forwarded?.split(",")[0].trim() || c.req.header("host");
  return parseHost(host);
}

function proxy(prefix: string) {
  return async (c: Context, next: () => Promise<void>) => {
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
}

async function getEnvForHost(
  host: string,
): Promise<Record<string, string> | null> {
  host = parseHost(host);
  if (rootDomain && host === rootDomain) {
    return { ...env, ACTIVITYPUB_DOMAIN: rootDomain };
  }
  const inst = await Instance.findOne({ host }).lean();
  if (!inst) return null;
  return { ...env, ...inst.env, ACTIVITYPUB_DOMAIN: host };
}

async function getAppForHost(host: string): Promise<Hono | null> {
  host = parseHost(host);
  let app = apps.get(host);
  if (app) return app;
  const hostEnv = await getEnvForHost(host);
  if (!hostEnv) return null;
  await ensureTenant(host, host);
  app = await createTakosApp(hostEnv);
  apps.set(host, app);
  return app;
}

const root = new Hono();

root.route("/auth", authApp);
root.route("/oauth", oauthApp);
root.route("/user", consumerApp);

if (isDev) {
  root.use("/auth/*", proxy("/auth"));
  root.use("/user/*", proxy("/user"));
  if (rootDomain) {
    root.use(async (c, next) => {
      const host = getRealHost(c);
      if (host === rootDomain) {
        return await proxy("")(c, next);
      }
      await next();
    });
  }
} else {
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
  const app = await getAppForHost(host);
  console.log(`Request for host: ${host}, app: ${app ? "found" : "not found"}`);
  if (!app) return c.text("not found", 404);
  return app.fetch(c.req.raw);
});

Deno.serve({ port: 8001 }, root.fetch);
