import { Component, createResource, createSignal, For, Show } from "solid-js";
import type { Notification } from "./types.ts";
import { apiFetch } from "../../utils/config.ts";
import { Button, Card, EmptyState, Spinner } from "../ui";

const fetchNotifications = async (): Promise<Notification[]> => {
  try {
    const res = await apiFetch("/api/notifications");
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    return res.json();
  } catch (error) {
    console.error("Failed to fetch notifications:", error);
    throw error;
  }
};

const NotificationsContent: Component = () => {
  const [notifications, { mutate, refetch }] = createResource(
    fetchNotifications,
  );
  const [deletingIds, setDeletingIds] = createSignal<Set<string>>(new Set());

  const markAsRead = async (id: string) => {
    try {
      const res = await apiFetch(`/api/notifications/${id}/read`, {
        method: "PATCH",
      });
      if (!res.ok) throw new Error("Failed to mark as read");

      mutate((prev) =>
        prev?.map((n) => n.id === id ? { ...n, read: true } : n) || []
      );
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const deleteNotification = async (id: string) => {
    const currentDeleting = deletingIds();
    setDeletingIds(new Set([...currentDeleting, id]));

    try {
      const res = await apiFetch(`/api/notifications/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete notification");

      mutate((prev) => prev?.filter((n) => n.id !== id) || []);
    } catch (error) {
      console.error("Failed to delete notification:", error);
    } finally {
      const newDeleting = new Set(deletingIds());
      newDeleting.delete(id);
      setDeletingIds(newDeleting);
    }
  };

  const clearAll = async () => {
    const list = notifications();
    if (!list || list.length === 0) return;

    try {
      await Promise.all(
        list.map((n) =>
          apiFetch(`/api/notifications/${n.id}`, { method: "DELETE" })
        ),
      );
      mutate([]);
    } catch (error) {
      console.error("Failed to clear all notifications:", error);
    }
  };

  // 種別に応じた控えめなアイコン（色味は抑えめに）
  const iconPath = (type: string) => {
    switch (type) {
      case "success":
        return <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />;
      case "warning":
        return (
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M12 19a7 7 0 100-14 7 7 0 000 14z" />
        );
      case "error":
        return <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />;
      default:
        return (
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        );
    }
  };

  return (
    <div class="max-w-3xl mx-auto space-y-4">
      <Card
        title="最近の通知"
        actions={
          <div class="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={notifications.loading}
              aria-label="通知を更新"
            >
              {notifications.loading ? (
                <Spinner class="mr-2" size={16} />
              ) : (
                <svg class="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              更新
            </Button>
            <Show when={notifications() && notifications()!.length > 0}>
              <Button variant="danger" size="sm" onClick={clearAll}>
                すべて削除
              </Button>
            </Show>
          </div>
        }
      >
        <Show when={notifications.error}>
          <div class="mb-3 text-sm text-rose-400">
            通知の読み込みに失敗しました。再度お試しください。
          </div>
        </Show>

        <Show
          when={notifications() && notifications()!.length > 0}
          fallback={
            <EmptyState
              title="通知はありません"
              description="新しい通知が届くとここに表示されます"
            />
          }
        >
          <div class="divide-y divide-gray-800/60">
            <For each={notifications()}>
              {(n) => {
                const isDeleting = deletingIds().has(n.id);
                return (
                  <div class="py-4 flex items-start gap-3">
                    <div class="w-8 h-8 rounded-full bg-[#2a2a2a] flex items-center justify-center flex-shrink-0">
                      <svg class="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {iconPath(n.type)}
                      </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <h4 class="text-base font-semibold text-gray-100 truncate">{n.title}</h4>
                          <p class="text-sm text-gray-400 mt-1 leading-relaxed">{n.message}</p>
                        </div>
                        <span class="text-xs text-gray-500 whitespace-nowrap">{new Date(n.createdAt).toLocaleString()}</span>
                      </div>
                      <div class="mt-2 flex items-center gap-2">
                        <Show when={!n.read}>
                          <Button variant="secondary" size="sm" onClick={() => markAsRead(n.id)}>
                            既読にする
                          </Button>
                        </Show>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteNotification(n.id)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? "削除中..." : "削除"}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>

        <div class="mt-4 text-xs text-gray-500">
          未読: {notifications()?.filter((n) => !n.read).length || 0}件 / 合計: {notifications()?.length || 0}件
        </div>
      </Card>
    </div>
  );
};

export default NotificationsContent;
