import { load } from "@std/dotenv";
import { z } from "zod";
import type { Context, Hono } from "hono";

const cachedEnv = new Map<string | undefined, Record<string, string>>();
const envMap = new WeakMap<Hono, Record<string, string>>();

export async function loadConfig(options?: { envPath?: string }) {
  const key = options?.envPath;
  const cached = cachedEnv.get(key);
  if (cached) return cached;
  const env = await load(options);
  validateEnv(env);
  cachedEnv.set(key, env);
  return env;
}

function validateEnv(env: Record<string, string>) {
  const schema = z.object({
    MONGO_URI: z.string().min(1),
  });
  schema.parse(env);
}

export async function initEnv(app: Hono, env?: Record<string, string>) {
  const e = env ?? await loadConfig();
  envMap.set(app, e);
  app.use("*", async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set("env", e);
    await next();
  });
}

export function getEnv(target: Hono | Context): Record<string, string> {
  if ("get" in target) {
    return (target as unknown as { get: (k: string) => unknown }).get(
      "env",
    ) as Record<string, string> ?? {};
  }
  return envMap.get(target as Hono) ?? {};
}
