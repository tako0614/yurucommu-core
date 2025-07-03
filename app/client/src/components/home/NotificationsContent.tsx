import { Component, For, createResource } from "solid-js";
import type { Notification } from "./types.ts";

const fetchNotifications = async (): Promise<Notification[]> => {
  const res = await fetch("/api/notifications");
  return res.json();
};

const NotificationsContent: Component = () => {
  const [notifications, { mutate, refetch }] = createResource(fetchNotifications);

  const clearAll = async () => {
    const list = notifications();
    if (!list) return;
    await Promise.all(
      list.map((n) =>
        fetch(`/api/notifications/${n.id}`, { method: "DELETE" })
      ),
    );
    mutate([]);
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
    <div class="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div class="text-center space-y-2">
        <h2 class="text-3xl font-bold text-gray-100">通知センター</h2>
        <p class="text-gray-400 max-w-2xl mx-auto">
          システムからの重要な通知やアップデート情報を確認できます
        </p>
      </div>

      <div class="bg-gradient-to-br from-[#1a1a1a] to-[#161616] rounded-2xl shadow-xl border border-gray-800/50 overflow-hidden">
        <div class="p-6 border-b border-gray-800/50">
          <div class="flex items-center justify-between">
            <h3 class="text-xl font-semibold text-gray-100">最近の通知</h3>
            <button
              type="button"
              class="text-teal-400 hover:text-teal-300 text-sm font-medium transition-colors duration-200"
              onClick={clearAll}
            >
              すべてをクリア
            </button>
          </div>
        </div>

        <div class="divide-y divide-gray-800/50">
          <For each={notifications()} fallback={<div class="p-6 text-center text-gray-400">通知はありません</div>}>
            {(n) => {
              const c = color(n.type);
              return (
                <div class={`p-6 hover:bg-gray-800/20 transition-colors duration-200 border-l-4 ${c.border}`}> 
                  <div class="flex items-start space-x-4">
                    <div class={`w-10 h-10 ${c.bg} rounded-full flex items-center justify-center flex-shrink-0`}>
                      <svg class={`w-5 h-5 ${c.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {c.icon}
                      </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between mb-2">
                        <h4 class="text-lg font-semibold text-gray-100">{n.title}</h4>
                        <span class="text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full">
                          {new Date(n.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p class="text-gray-300 text-sm leading-relaxed">{n.message}</p>
                    </div>
                  </div>
                </div>
              );
            }}
          </For>
        </div>

        <div class="p-6 border-t border-gray-800/50">
          <button
            type="button"
            class="w-full py-3 px-4 text-sm font-medium text-gray-400 hover:text-gray-200 bg-transparent hover:bg-gray-800/30 border border-gray-600/30 hover:border-gray-500/50 rounded-xl transition-all duration-200"
            onClick={() => refetch()}
          >
            すべての通知を表示
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationsContent;
