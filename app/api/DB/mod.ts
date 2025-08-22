import type { DB } from "../../shared/db.ts";
import {
  MongoDB,
  startInactiveSessionJob,
  startPendingInviteJob,
} from "./mongo.ts";

export { MongoDB, startInactiveSessionJob, startPendingInviteJob };

/** MongoDB 実装を生成する */
export function createDB(env: Record<string, string>): DB {
  return new MongoDB(env);
}
