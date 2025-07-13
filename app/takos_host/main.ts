import { Hono } from "hono";
import { load } from "jsr:@std/dotenv";
import { createTakosApp } from "../api/server.ts";
import { connectDatabase } from "../api/db.ts";
import Instance from "./models/instance.ts";
import { createAdminApp } from "./admin.ts";
import { authApp } from "./auth.ts";
import { serveStatic } from "hono/deno";
import type { Context } from "hono";
import type { Context } from "hono";

const env = await load();
await connectDatabase(env);

const apps = new Map<string, Hono>();
const adminApp = createAdminApp((host) => {
  apps.delete(host);
});
const rootDomain = env["ROOT_DOMAIN"] ?? "";
const isDev = Deno.env.get("DEV") === "1";

function proxy(prefix: string) {
  return async (c: Context) => {
    const path = c.req.path.replace(new RegExp(`^${prefix}`), "");
    const url = `http://localhost:1421${path}`;
    const res = await fetch(url, {
      method: c.req.method,
      headers: c.req.headers,
      body: c.req.raw.body,
    });
    return new Response(res.body, { status: res.status, headers: res.headers });
  };
}

async function getEnvForHost(
  host: string,
): Promise<Record<string, string> | null> {
  const inst = await Instance.findOne({ host }).lean();
  if (!inst) return null;
  return { ...env, ...inst.env, ACTIVITYPUB_DOMAIN: host };
}

async function getAppForHost(host: string): Promise<Hono | null> {
  let app = apps.get(host);
  if (app) return app;
  const hostEnv = await getEnvForHost(host);
  if (!hostEnv) return null;
  app = await createTakosApp(hostEnv);
  apps.set(host, app);
  return app;
}

const root = new Hono();

if (isDev) {
  root.use("/auth/*", proxy("/auth"));
  root.use("/admin/*", proxy("/admin"));
} else {
  root.use(
    "/auth/*",
    serveStatic({
      root: "./client/dist",
      rewriteRequestPath: (path) => path.replace(/^\/auth/, ""),
    }),
  );
  root.use(
    "/admin/*",
    serveStatic({
      root: "./client/dist",
      rewriteRequestPath: (path) => path.replace(/^\/admin/, ""),
    }),
  );
}

root.route("/auth", authApp);
root.route("/admin", adminApp);

root.all("/*", async (c) => {
  const host = c.req.header("host") ?? "";
  if (rootDomain && host === rootDomain) {
    return authApp.fetch(c.req.raw);
  }
  const app = await getAppForHost(host);
  if (!app) return c.text("not found", 404);
  return app.fetch(c.req.raw);
});

Deno.serve({ port: 8001 }, root.fetch);
