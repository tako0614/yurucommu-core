import type { DB } from "../../shared/db.ts";
import { MongoDB, startPendingInviteJob } from "./mongo.ts";

export { MongoDB, startPendingInviteJob };

/** MongoDB 実装を生成する */
export function createDB(env: Record<string, string>): DB {
  return new MongoDB(env);
}
