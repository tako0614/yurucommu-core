import type { DB } from "../../shared/db.ts";
import type { DataStore } from "../../shared/db_port.ts";
import { LegacyDBAdapter } from "./legacy_adapter.ts";

/**
 * DB ファクトリー関数の型
 * 環境変数を受け取り、DB 実装を返す
 */
export type DBFactory = (env: Record<string, string>) => DB;

// 実行時にホスト側から差し込まれるファクトリー
let factory: DBFactory | undefined;
let storeFactory: ((env: Record<string, string>) => DataStore) | undefined;

/**
 * DB ファクトリーを登録します（ホスト側で実装を注入）。
 */
export function setDBFactory(f: DBFactory) {
  factory = f;
}

/** 新しい DataStore ファクトリーを登録（推奨） */
export function setStoreFactory(f: (env: Record<string, string>) => DataStore) {
  storeFactory = f;
}

/**
 * 登録済みのファクトリーを用いて DB 実装を生成します。
 * 未登録の場合はエラーにします（takos 本体は DB 非依存のため）。
 */
export function createDB(env: Record<string, string>): DB {
  if (storeFactory) return new LegacyDBAdapter(storeFactory(env));
  if (factory) return factory(env);
  throw new Error(
    "DBFactory が未設定です。ホスト側で setStoreFactory(...) または setDBFactory(...) を呼び出してください。",
  );
}

export { };
