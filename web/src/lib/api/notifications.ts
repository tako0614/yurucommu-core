import type { Notification } from "../../types/index.ts";
import { normalizeNotification } from "./normalize.ts";
import { apiFetch, apiPost, assertOk } from "./fetch.ts";

export async function fetchNotifications(options?: {
  limit?: number;
  type?: string;
  before?: string;
}): Promise<{ notifications: Notification[]; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.type && options.type !== "all") params.set("type", options.type);
  if (options?.before) params.set("before", options.before);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(`/api/notifications${query}`);
  const data = (await res.json()) as {
    notifications?: Notification[];
    has_more?: boolean;
  };
  return {
    notifications: (data.notifications || []).map(normalizeNotification),
    hasMore: data.has_more ?? false,
  };
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
