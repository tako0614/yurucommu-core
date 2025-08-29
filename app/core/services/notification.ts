import type { DataStore } from "../db/types.ts";
import { sendNotification as sendFcm } from "./fcm.ts";

/**
 * 通知を追加するユーティリティ関数
 */
export async function addNotification(
  db: DataStore,
  owner: string,
  title: string,
  message: string,
  type: string = "info",
  env: Record<string, string>,
): Promise<boolean> {
  await db.notifications.create(owner, title, message, type);
  await sendFcm(db, title, message, env);
  return true;
}
