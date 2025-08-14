import type { DB } from "../../shared/db.ts";
import {
  MongoDB,
  startInactiveSessionJob,
  startKeyPackageCleanupJob,
  startPendingInviteJob,
} from "./mongo.ts";

export {
  MongoDB,
  startInactiveSessionJob,
  startKeyPackageCleanupJob,
  startPendingInviteJob,
};

/** MongoDB 実装を生成する */
export function createDB(env: Record<string, string>): DB {
  return new MongoDB(env);
}
