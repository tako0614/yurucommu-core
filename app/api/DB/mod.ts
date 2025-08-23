import type { DB } from "../../shared/db.ts";
import { MongoDB } from "./mongo.ts";

export { MongoDB };

/** MongoDB 実装を生成する */
export function createDB(env: Record<string, string>): DB {
  return new MongoDB(env);
}
