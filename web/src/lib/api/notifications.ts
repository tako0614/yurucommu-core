import type { Notification } from "../../types/index.ts";
import { normalizeNotification } from "./normalize.ts";
import { apiDelete, apiFetch, apiPost, assertOk } from "./fetch.ts";

export async function fetchNotifications(options?: {
  limit?: number;
  type?: string;
  before?: string;
  archived?: boolean;
}): Promise<{
  notifications: Notification[];
  hasMore: boolean;
  nextCursor: string | null;
}> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", options.limit.toString());
  if (options?.type && options.type !== "all") params.set("type", options.type);
  if (options?.before) params.set("before", options.before);
  if (options?.archived) params.set("archived", "true");
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(`/api/notifications${query}`);
  const data = (await res.json()) as {
    notifications?: Notification[];
    has_more?: boolean;
    next_cursor?: string | null;
  };
  return {
    notifications: (data.notifications || []).map(normalizeNotification),
    hasMore: data.has_more ?? false,
    nextCursor: data.next_cursor ?? null,
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

export async function archiveNotifications(ids: string[]): Promise<void> {
  const res = await apiPost("/api/notifications/archive", { ids });
  await assertOk(res, "Failed to archive");
}

export async function unarchiveNotifications(ids: string[]): Promise<void> {
  const res = await apiDelete("/api/notifications/archive", { ids });
  await assertOk(res, "Failed to unarchive");
}

export async function archiveAllNotifications(): Promise<number> {
  const res = await apiPost("/api/notifications/archive/all", {});
  await assertOk(res, "Failed to archive all");
  const data = (await res.json()) as { archived_count?: number };
  return data.archived_count ?? 0;
}
