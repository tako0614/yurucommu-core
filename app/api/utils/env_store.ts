import type { Hono } from "hono";
import type { Context } from "hono";

// Hono アプリごとに環境変数を保持する
const envMap = new WeakMap<Hono, Record<string, string>>();

// アプリに環境変数を紐付ける
export function initEnv(app: Hono, env: Record<string, string>) {
  envMap.set(app, env);
  app.use("*", async (c, next) => {
    c.set("env", env);
    await next();
  });
}

// 保持している環境変数を取得する
export function getEnv(target: Hono | Context): Record<string, string> {
  if ("get" in target) {
    return target.get("env") as Record<string, string> || {};
  }
  return envMap.get(target as Hono) ?? {};
}
