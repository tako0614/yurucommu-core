import type { DB } from "../../shared/db.ts";
import { MongoDBLocal } from "./local.ts";
import { MongoDBHost } from "../../takos_host/db.ts";

export { MongoDBHost, MongoDBLocal };

/** 環境変数に応じて適切な DB 実装を返す */
export function createDB(env: Record<string, string>): DB {
  const mode = env["DB_MODE"] === "host" ? "host" : "local";
  return mode === "host" ? new MongoDBHost(env) : new MongoDBLocal(env);
}
