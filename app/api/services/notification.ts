import Notification from "../models/notification.ts";

/**
 * 通知を追加するユーティリティ関数
 */
export async function addNotification(
  title: string,
  message: string,
  type: string = "info",
) {
  const n = new Notification({ title, message, type });
  await n.save();
  return n;
}
