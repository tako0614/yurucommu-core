import type { Context, Hono } from "hono";

const envMap = new WeakMap<Hono, Record<string, string>>();

export async function loadConfig(_options?: { envPath?: string }) {
  // Workers 環境では .env を読まず、空辞書を返す
  return {} as Record<string, string>;
}

export async function initEnv(app: Hono, env?: Record<string, string>) {
  const e = env ?? {};
  envMap.set(app, e);
  app.use("*", async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set("env", e);
    await next();
  });
}

export function getEnv(target: Hono | Context): Record<string, string> {
  if ("get" in target) {
    return (target as unknown as { get: (k: string) => unknown }).get("env") as
      | Record<string, string>
      | undefined ?? {};
  }
  return envMap.get(target as Hono) ?? {};
}

