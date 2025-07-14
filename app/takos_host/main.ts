import { Hono } from "hono";
import { load } from "jsr:@std/dotenv";
import { createTakosApp } from "../api/server.ts";
import { connectDatabase } from "../api/db.ts";
import Instance from "./models/instance.ts";
import { createAdminApp } from "./admin.ts";
import { authApp } from "./auth.ts";
import { serveStatic } from "hono/deno";
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
  root.use("/user/*", proxy("/admin"));
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
    const host = c.req.header("host") ?? "";
    if (host === rootDomain) {
      await serveStatic({ root: "./client/dist" })(c, next);
    } else {
      await next();
    }
  });
}

root.route("/auth", authApp);
root.route("/admin", adminApp);
root.route("/user", adminApp);

root.all("/*", async (c) => {
  const host = c.req.header("host") ?? "";
  if (rootDomain && host === rootDomain) {
    if (isDev && c.req.method === "GET") {
      const res = await fetch(`http://localhost:1421${c.req.path}`);
      const body = await res.arrayBuffer();
      return new Response(body, { status: res.status, headers: res.headers });
    }
    return serveStatic({ root: "./client/dist" })(c, () => Promise.resolve());
  }
  const app = await getAppForHost(host);
  if (!app) return c.text("not found", 404);
  return app.fetch(c.req.raw);
});

Deno.serve({ port: 8001 }, root.fetch);
