/**
 * Server-side entry point for the app.
 *
 * This file implements the TakosApp interface using the Workers fetch pattern.
 */

import { Hono } from "hono";
import type { TakosApp, AppEnv } from "@takos/app-sdk/server";
import { json, error } from "@takos/app-sdk/server";

const router = new Hono<{ Bindings: AppEnv }>();

// Health check endpoint
router.get("/health", (c) => c.text("ok"));

// Example API endpoint
router.get("/api/example", async (c) => {
  const { env } = c;

  if (!env.auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json({
    message: "Hello from handler!",
    user: env.auth.handle,
  });
});

// Example counter endpoints using app storage
router.get("/api/counter", async (c) => {
  const { env } = c;

  if (!env.auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const count = await env.storage.get<number>("count") ?? 0;
  return c.json({ count });
});

router.post("/api/counter/increment", async (c) => {
  const { env } = c;

  if (!env.auth) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const count = (await env.storage.get<number>("count") ?? 0) + 1;
  await env.storage.set("count", count);
  return c.json({ count });
});

const app: TakosApp = {
  fetch: router.fetch,
};

export default app;
