import { Hono } from "hono";
import { load } from "jsr:@std/dotenv";
import { createTakosApp } from "../api/server.ts";

const env = await load();
const apps = new Map<string, Hono>();

async function getAppForHost(host: string): Promise<Hono> {
  let app = apps.get(host);
  if (!app) {
    app = await createTakosApp(env);
    apps.set(host, app);
  }
  return app;
}

Deno.serve(async (req) => {
  const host = req.headers.get("host") ?? "localhost";
  const app = await getAppForHost(host);
  return app.fetch(req);
});
