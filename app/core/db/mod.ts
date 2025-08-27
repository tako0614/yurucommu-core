import type { Context } from "npm:hono";
import type { DataStore } from "./types.ts";

/**
 * DataStore ファクトリー関数の型
 * 環境変数を受け取り、DataStore を返す
 */
export type StoreFactory = (env: Record<string, string>) => DataStore;

// 実行時にホスト側から差し込まれるファクトリー
let storeFactory: StoreFactory | undefined;

/**
 * DataStore ファクトリーを登録します（ホスト側で実装を注入）。
 */
export function setStoreFactory(f: StoreFactory) {
  storeFactory = f;
}

/**
 * 登録済みのファクトリーを用いて DataStore を生成します。
 * 未登録の場合はエラーにします（takos 本体は DB 非依存のため）。
 */
// deno-lint-ignore no-explicit-any
export function createDB(env: Record<string, string>): any {
  if (storeFactory) return storeFactory(env);
  throw new Error(
    "StoreFactory が未設定です。ホスト側で setStoreFactory(...) を呼び出してください。",
  );
}

// deno-lint-ignore no-explicit-any
export function getDB(c: Context): any {
  return c.get("db") as DataStore;
}
