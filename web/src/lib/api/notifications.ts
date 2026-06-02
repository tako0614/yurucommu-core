import type { Notification } from "../../types/index.ts";
import { normalizeNotification } from "./normalize.ts";
import { apiFetch, apiPost, assertOk } from "./fetch.ts";

export async function fetchNotifications(options?: {
  limit?: number;
  type?: string;
}): Promise<Notification[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.type && options.type !== "all") params.set("type", options.type);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(`/api/notifications${query}`);
  const data = (await res.json()) as { notifications?: Notification[] };
  return (data.notifications || []).map(normalizeNotification);
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await apiFetch("/api/notifications/unread/count");
  const data = (await res.json()) as { count?: number };
  return data.count || 0;
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const res = await apiPost("/api/notifications/read", { ids });
  await assertOk(res, "Failed to mark as read");
}
