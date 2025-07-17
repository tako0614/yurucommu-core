import Notification from "../models/notification.ts";

/**
 * 通知を追加するユーティリティ関数
 */
export async function addNotification(
  title: string,
  message: string,
  type: string = "info",
  env: Record<string, string> = {},
) {
  const n = new Notification({ title, message, type });
  (n as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await n.save();
  return n;
}
