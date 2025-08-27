import { createDB } from "../db/mod.ts";
import type { DB } from "@takos/db";
import { sendNotification as sendFcm } from "./fcm.ts";

/**
 * 通知を追加するユーティリティ関数
 */
export async function addNotification(
  owner: string,
  title: string,
  message: string,
  type: string = "info",
  env: Record<string, string>,
  dbInst?: DB,
) {
  const db = dbInst ?? createDB(env);
  await db.createNotification(owner, title, message, type);
  await sendFcm(title, message, env, db);
  return true;
}
