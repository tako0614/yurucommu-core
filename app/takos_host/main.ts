import { Hono } from "hono";
import { load } from "jsr:@std/dotenv";
import { createTakosApp } from "../api/server.ts";
import { connectDatabase } from "../api/db.ts";
import Instance from "./models/instance.ts";
import { createAdminApp } from "./admin.ts";
import { authApp } from "./auth.ts";
import { serveDir } from "jsr:@std/http/file_server";

const env = await load();
await connectDatabase(env);

const apps = new Map<string, Hono>();
const adminApp = createAdminApp((host) => {
  apps.delete(host);
});
const rootDomain = env["ROOT_DOMAIN"] ?? "";

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

root.use("/auth/*", async (c, next) => {
  const res = await serveDir(c.req.raw, {
    fsRoot: "./app/takos_host/client/dist",
    urlRoot: "/auth",
  });
  if (res.status !== 404) return res;
  await next();
});

root.use("/admin/*", async (c, next) => {
  const res = await serveDir(c.req.raw, {
    fsRoot: "./app/takos_host/client/dist",
    urlRoot: "/admin",
  });
  if (res.status !== 404) return res;
  await next();
});
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

Deno.serve(root.fetch);
