import { Component, createResource, createSignal, For, Show } from "solid-js";
import type { Notification } from "./types.ts";

const fetchNotifications = async (): Promise<Notification[]> => {
  try {
    const res = await fetch("/api/notifications");
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
      const res = await fetch(`/api/notifications/${id}/read`, {
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
      const res = await fetch(`/api/notifications/${id}`, { method: "DELETE" });
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
          fetch(`/api/notifications/${n.id}`, { method: "DELETE" })
        ),
      );
      mutate([]);
    } catch (error) {
      console.error("Failed to clear all notifications:", error);
    }
  };

  const color = (type: string) => {
    switch (type) {
      case "success":
        return {
          border: "border-green-500",
          bg: "bg-green-500/20",
          icon: (
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 13l4 4L19 7"
            />
          ),
          text: "text-green-400",
        };
      case "warning":
        return {
          border: "border-amber-500",
          bg: "bg-amber-500/20",
          icon: (
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          ),
          text: "text-amber-400",
        };
      case "error":
        return {
          border: "border-rose-500",
          bg: "bg-rose-500/20",
          icon: (
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          ),
          text: "text-rose-400",
        };
      default:
        return {
          border: "border-teal-500",
          bg: "bg-teal-500/20",
          icon: (
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          ),
          text: "text-teal-400",
        };
    }
  };

  return (
    <div class="max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div class="text-center space-y-2">
        <h2 class="text-3xl font-bold text-gray-100">通知センター</h2>
        <p class="text-gray-400 max-w-xl mx-auto">
          システムからの重要な通知やアップデート情報を確認できます
        </p>
      </div>

      <div class="bg-gradient-to-br from-[#1a1a1a] to-[#161616] rounded-2xl shadow-xl border border-gray-800/50 overflow-hidden">
        <div class="p-6 border-b border-gray-800/50">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <h3 class="text-xl font-semibold text-gray-100">最近の通知</h3>
              <Show when={notifications.loading}>
                <div class="animate-spin rounded-full h-4 w-4 border-2 border-teal-400 border-t-transparent">
                </div>
              </Show>
            </div>
            <div class="flex items-center space-x-3">
              <button
                type="button"
                class="text-gray-400 hover:text-gray-200 text-sm font-medium transition-colors duration-200 flex items-center space-x-2"
                onClick={() => refetch()}
                disabled={notifications.loading}
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span>更新</span>
              </button>
              <Show when={notifications() && notifications()!.length > 0}>
                <button
                  type="button"
                  class="text-rose-400 hover:text-rose-300 text-sm font-medium transition-colors duration-200"
                  onClick={clearAll}
                >
                  すべてをクリア
                </button>
              </Show>
            </div>
          </div>
        </div>

        <Show when={notifications.error}>
          <div class="p-6 bg-rose-500/10 border-l-4 border-rose-500">
            <div class="flex items-center space-x-3">
              <svg
                class="w-5 h-5 text-rose-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <h4 class="text-rose-400 font-medium">エラーが発生しました</h4>
                <p class="text-rose-300 text-sm">
                  通知の読み込みに失敗しました。再度お試しください。
                </p>
              </div>
            </div>
          </div>
        </Show>

        <div class="divide-y divide-gray-800/50">
          <Show
            when={notifications() && notifications()!.length > 0}
            fallback={
              <div class="p-8 text-center">
                <svg
                  class="w-16 h-16 text-gray-600 mx-auto mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1"
                    d="M15 17h5l-5 5v-5zM11 19H6a2 2 0 01-2-2V7a2 2 0 012-2h5m5 0v6h6m-6-6L16 9l-5-5z"
                  />
                </svg>
                <p class="text-gray-400 text-lg">通知はありません</p>
                <p class="text-gray-500 text-sm mt-2">
                  新しい通知が届くとここに表示されます
                </p>
              </div>
            }
          >
            <For each={notifications()}>
              {(n) => {
                const c = color(n.type);
                const isDeleting = deletingIds().has(n.id);
                return (
                  <div
                    class={`group relative transition-all duration-300 ${
                      isDeleting
                        ? "opacity-50 scale-95"
                        : "hover:bg-gray-800/20"
                    } ${!n.read ? "bg-teal-500/5" : ""}`}
                  >
                    <div
                      class={`p-6 border-l-4 ${c.border} ${
                        !n.read ? "border-l-teal-400" : ""
                      }`}
                    >
                      <div class="flex items-start space-x-4">
                        <div
                          class={`w-10 h-10 ${c.bg} rounded-full flex items-center justify-center flex-shrink-0 relative`}
                        >
                          <svg
                            class={`w-5 h-5 ${c.text}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            {c.icon}
                          </svg>
                          <Show when={!n.read}>
                            <div class="absolute -top-1 -right-1 w-3 h-3 bg-teal-400 rounded-full">
                            </div>
                          </Show>
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center justify-between mb-2">
                            <h4
                              class={`text-lg font-semibold ${
                                !n.read ? "text-gray-50" : "text-gray-100"
                              }`}
                            >
                              {n.title}
                            </h4>
                            <div class="flex items-center space-x-2">
                              <span class="text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full">
                                {new Date(n.createdAt).toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <p
                            class={`text-sm leading-relaxed ${
                              !n.read ? "text-gray-200" : "text-gray-300"
                            }`}
                          >
                            {n.message}
                          </p>
                          <div class="flex items-center justify-between mt-3">
                            <Show when={!n.read}>
                              <button
                                type="button"
                                class="text-teal-400 hover:text-teal-300 text-xs font-medium transition-colors duration-200"
                                onClick={() => markAsRead(n.id)}
                              >
                                既読にする
                              </button>
                            </Show>
                            <div class="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                              <button
                                type="button"
                                class="text-rose-400 hover:text-rose-300 text-xs font-medium transition-colors duration-200 disabled:opacity-50"
                                onClick={() => deleteNotification(n.id)}
                                disabled={isDeleting}
                              >
                                <Show when={isDeleting} fallback="削除">
                                  削除中...
                                </Show>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>

        <div class="p-6 border-t border-gray-800/50">
          <div class="flex items-center justify-between">
            <div class="text-xs text-gray-500">
              未読:{" "}
              {notifications()?.filter((n) => !n.read).length || 0}件 / 合計:
              {" "}
              {notifications()?.length || 0}件
            </div>
            <button
              type="button"
              class="py-2 px-4 text-sm font-medium text-gray-400 hover:text-gray-200 bg-transparent hover:bg-gray-800/30 border border-gray-600/30 hover:border-gray-500/50 rounded-xl transition-all duration-200"
              onClick={() => refetch()}
              disabled={notifications.loading}
            >
              <Show when={notifications.loading} fallback="最新の通知を取得">
                読み込み中...
              </Show>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationsContent;
