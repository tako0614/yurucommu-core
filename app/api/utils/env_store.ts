import type { Hono } from "hono";
import type { Context } from "hono";

// Hono アプリごとに環境変数を保持する
const envMap = new WeakMap<Hono, Record<string, string>>();

// アプリに環境変数を紐付ける
export function initEnv(app: Hono, env: Record<string, string>) {
  envMap.set(app, env);
  app.use("*", async (c, next) => {
    // 型の都合上 any 経由で変数を保存する
    (c as unknown as { set: (k: string, v: unknown) => void }).set(
      "env",
      env,
    );
    await next();
  });
}

// 保持している環境変数を取得する
export function getEnv(target: Hono | Context): Record<string, string> {
  if ("get" in target) {
    return (target as unknown as { get: (k: string) => unknown }).get(
      "env",
    ) as Record<string, string> ?? {};
  }
  return envMap.get(target as Hono) ?? {};
}
