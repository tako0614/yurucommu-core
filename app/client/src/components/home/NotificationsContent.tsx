import {
  Component,
  createEffect,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";
import type { Notification } from "./types.ts";
import { apiFetch } from "../../utils/config.ts";
import { navigate } from "../../utils/router.ts";
import { Button, Card, EmptyState, Spinner } from "../ui/index.ts";
import { useAtom } from "solid-jotai";
import { selectedAppState } from "../../states/app.ts";
import { selectedRoomState } from "../../states/chat.ts";
import { activeAccount } from "../../states/account.ts";
import { addMessageHandler, removeMessageHandler } from "../../utils/ws.ts";

const NotificationsContent: Component = () => {
  const [, setApp] = useAtom(selectedAppState);
  const [, setRoom] = useAtom(selectedRoomState);
  const [account] = useAtom(activeAccount);
  const [notifications, { mutate, refetch }] = createResource(
    async () => {
      const acc = account();
      if (!acc) return [] as Notification[];
                                try {
        const res = await apiFetch(
          `/api/notifications?owner=${encodeURIComponent(acc.id)}`,
        );
        if (!res.ok) throw new Error("failed to load notifications");
        return await res.json();
      } catch (e) {
        console.error("Failed to fetch notifications:", e);
        return [] as Notification[];
      }
    },
  );
  const [deletingIds, setDeletingIds] = createSignal<Set<string>>(new Set());
  // アカウント変更時に再取得
  createEffect(() => {
    account();
    void refetch();
  });
  // ページ表示中の定期ポーリングは廃止。WSハンドラで即時 refetch() を呼ぶ。
  // WS通知を受信したら即時再取得
  createEffect(() => {
    const handler = (msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "notification"
      ) {
        void refetch();
      }
    };
    addMessageHandler(handler);
    return () => removeMessageHandler(handler);
  });
  // 簡易クリーンアップ（Solidでは自動で破棄されるが明示）
  addEventListener("beforeunload", () => {
    // no-op: polling removed
  });

  const markAsRead = async (id: string) => {
    try {
      const res = await apiFetch(`/api/notifications/${id}/read`, {
        method: "PUT",
      });
      if (!res.ok) throw new Error("Failed to mark as read");

      mutate((prev) =>
        prev?.map((n: { id: string; }) => n.id === id ? { ...n, read: true } : n) || []
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

      mutate((prev) => prev?.filter((n: { id: string; }) => n.id !== id) || []);
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
        // deno-lint-ignore no-explicit-any
        list.map((n: { id: any; }) =>
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
        return (
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5 13l4 4L19 7"
          />
        );
      case "warning":
        return (
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01M12 19a7 7 0 100-14 7 7 0 000 14z"
          />
        );
      case "error":
        return (
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        );
      case "group-invite":
        return (
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 4v16m8-8H4"
          />
        );
      default:
        return (
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
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
              {notifications.loading ? <Spinner class="mr-2" size={16} /> : (
                <svg
                  class="w-4 h-4 mr-2"
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
                // chat-invite または group-invite の場合は message をJSONとしてパースして操作ボタンを出す
                let invite:
                  | { kind?: string; roomId?: string; sender?: string }
                  | null = null;
                let gInvite:
                  | {
                    kind?: string;
                    groupName?: string;
                    groupId?: string;
                    displayName?: string;
                    inviter?: string;
                  }
                  | null = null;
                if (n.type === "chat-invite") {
                  try {
                    const obj = JSON.parse(n.message);
                    if (obj && obj.kind === "chat-invite") invite = obj;
                  } catch { /* ignore */ }
                } else if (n.type === "group-invite") {
                  try {
                    const obj = JSON.parse(n.message);
                    if (obj && obj.kind === "group-invite") gInvite = obj;
                  } catch { /* ignore */ }
                }

                return (
                  <div class="py-4 flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-[#2a2a2a] flex items-center justify-center flex-shrink-0">
                      <svg
                        class="w-4 h-4 text-gray-300"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        {iconPath(n.type)}
                      </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between gap-3">
                          <div class="min-w-0 flex flex-col justify-center">
                          <h4 class="text-base font-semibold text-gray-100 truncate">
                            {n.title}
                          </h4>
                          <p class="text-sm text-gray-400 mt-1 leading-relaxed">
                            {invite
                              ? `${
                                invite.sender ?? "不明"
                              } からの会話招待です。参加しますか？`
                              : n.message}
                          </p>
                        </div>
                        <span class="text-xs text-gray-500 whitespace-nowrap">
                          {new Date(n.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div class="mt-2 flex items-center gap-2">
                        <Show when={invite}>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={async () => {
                              const rid = invite?.roomId;
                              if (!rid) return;
                              // チャットへ遷移し、Chat 側のリスナーに参加処理を委譲
                              setApp("chat");
                              setRoom(rid);
                              globalThis.dispatchEvent(
                                new CustomEvent("app:accept-invite", {
                                  detail: {
                                    roomId: rid,
                                    sender: invite?.sender,
                                  },
                                }),
                              );
                              // 通知は削除
                              await deleteNotification(n.id);
                            }}
                          >
                            参加する
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteNotification(n.id)}
                            disabled={isDeleting}
                          >
                            後で
                          </Button>
                        </Show>
                          <Show when={gInvite}>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={async () => {
                                // グループページへ移動
                                const gid = gInvite?.groupId;
                                const gname = gInvite?.groupName;
                                if (gid && gname) {
                                  // navigate to group page (client route may vary)
                                  try {
                                    // attempt local join via API if available
                                    const localName = encodeURIComponent(gname);
                                    const res = await apiFetch(`/api/groups/${localName}/join`, {
                                      method: "POST",
                                      headers: { "content-type": "application/json" },
                                      body: JSON.stringify({}),
                                    }).catch(() => null);
                                    // if API succeeded or not available, navigate to group actor page
                                    globalThis.dispatchEvent(new CustomEvent("app:toast", { detail: { type: res && res.ok ? "success" : "info", title: "グループ", description: res && res.ok ? "参加しました" : "グループページへ移動します" } }));
                                  } catch {
                                    /* ignore */
                                  }
                                  // open group page in-app — best effort: use location as fallback
                                  try {
                                    navigate(`/groups/${gname}`);
                                  } catch {
                                    // use globalThis.location in environments where window isn't available
                                    try {
                                      (globalThis as unknown as { location?: Location }).location!.href = gid;
                                    } catch {
                                      /* ignore */
                                    }
                                  }
                                  await deleteNotification(n.id);
                                }
                              }}
                            >
                              グループへ移動
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteNotification(n.id)}
                              disabled={isDeleting}
                            >
                              後で
                            </Button>
                          </Show>
                        <Show when={!n.read && !invite}>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => markAsRead(n.id)}
                          >
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
          未読: {notifications()?.filter((n: Notification) => !n.read).length || 0}件 / 合計:
          {" "}
          {notifications()?.length || 0}件
        </div>
      </Card>
    </div>
  );
};

export default NotificationsContent;
