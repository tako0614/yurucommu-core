import { createDB } from "../DB/mod.ts";
import type { DB } from "../../shared/db.ts";
import { sendNotification as sendFcm } from "./fcm.ts";

/**
 * 通知を追加するユーティリティ関数
 */
export async function addNotification(
  title: string,
  message: string,
  type: string = "info",
  env: Record<string, string>,
  dbInst?: DB,
) {
  const db = dbInst ?? createDB(env);
  await db.createNotification(title, message, type);
  await sendFcm(title, message, env, db);
  return true;
}
