export interface NotificationData {
  _id?: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: Date;
}

import Notification from "../models/notification.ts";

export async function listNotifications(
  env: Record<string, string>,
): Promise<NotificationData[]> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return await Notification.find({ tenant_id: tenantId })
    .sort({ createdAt: -1 })
    .lean<NotificationData[]>();
}

export async function createNotification(
  env: Record<string, string>,
  title: string,
  message: string,
  type: string,
): Promise<NotificationData> {
  const doc = new Notification({ title, message, type });
  (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals = {
    env,
  };
  await doc.save();
  return doc.toObject() as NotificationData;
}

export async function markNotificationRead(
  env: Record<string, string>,
  id: string,
): Promise<boolean> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const res = await Notification.findOneAndUpdate(
    { _id: id, tenant_id: tenantId },
    { read: true },
  );
  return !!res;
}

export async function deleteNotification(
  env: Record<string, string>,
  id: string,
): Promise<boolean> {
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const res = await Notification.findOneAndDelete({
    _id: id,
    tenant_id: tenantId,
  });
  return !!res;
}
