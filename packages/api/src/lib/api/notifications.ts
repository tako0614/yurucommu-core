import type {
  Notification,
  NotificationPusherInput,
  NotificationPusherProduct,
  NotificationPusherRegistration,
} from "../../types/index.ts";
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
  await assertOk(res, "Failed to load notifications");
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

export async function registerNotificationPusher(input: {
  product: NotificationPusherProduct;
  scope?: string;
  pusher: NotificationPusherInput;
}): Promise<NotificationPusherRegistration> {
  const res = await apiPost("/api/notifications/pushers", input);
  await assertOk(res, "Failed to register notification pusher");
  const data = (await res.json()) as {
    pusher: NotificationPusherRegistration;
  };
  return data.pusher;
}

export async function unregisterNotificationPusher(input: {
  product: NotificationPusherProduct;
  scope?: string;
  app_id: string;
  pushkey: string;
}): Promise<void> {
  const res = await apiDelete("/api/notifications/pushers", input);
  await assertOk(res, "Failed to unregister notification pusher");
}

export interface NotificationPusherPublicConfig {
  readonly enabled: boolean;
  readonly gateway_url: string | null;
  readonly web_push_public_key: string | null;
}

/** Non-secret runtime configuration used by browser/PWA clients. */
export async function fetchNotificationPusherPublicConfig(): Promise<NotificationPusherPublicConfig> {
  const res = await apiFetch("/api/notifications/pushers/config");
  await assertOk(res, "Failed to load notification pusher configuration");
  const value = (await res.json()) as Partial<NotificationPusherPublicConfig>;
  const gatewayUrl =
    typeof value.gateway_url === "string" ? value.gateway_url : null;
  const publicKey =
    typeof value.web_push_public_key === "string"
      ? value.web_push_public_key
      : null;
  return {
    enabled: Boolean(gatewayUrl && publicKey),
    gateway_url: gatewayUrl,
    web_push_public_key: publicKey,
  };
}
