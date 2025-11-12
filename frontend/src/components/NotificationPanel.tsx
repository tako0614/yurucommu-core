import { createSignal, For, onMount, Show } from "solid-js";
import {
  acceptFriendRequest,
  listNotifications,
  markNotificationRead,
  rejectFriendRequest,
} from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function NotificationPanel(props: Props) {
  const [items, setItems] = createSignal<any[]>([]);

  const load = async () => {
    try {
      const list = await listNotifications();
      const mapped = (list as any[]).map((n: any) => ({
        ...n,
        time: new Date(n.created_at).toLocaleString(),
      }));
      setItems(mapped);
    } catch {}
  };

  onMount(load);

  return (
    <Show when={props.open}>
      {/* Overlay */}
      <div class="fixed inset-0 z-50" role="dialog" aria-modal="true">
        <button
          class="absolute inset-0 bg-black/20"
          aria-label="閉じる"
          onClick={props.onClose}
        />
        {/* Panel */}
        <div class="absolute right-0 top-0 h-full w-full md:w-[360px] bg-white dark:bg-neutral-900 border-l hairline shadow-xl flex flex-col">
          <div class="h-14 flex items-center justify-between px-4 border-b hairline">
            <div class="text-[16px] font-semibold">通知</div>
            <button
              class="text-sm text-gray-500 hover:text-gray-800"
              onClick={props.onClose}
            >
              閉じる
            </button>
          </div>
          <div class="flex-1 overflow-y-auto divide-y hairline">
            <Show
              when={items().length > 0}
              fallback={
                <div class="p-4 text-sm text-muted">通知はありません</div>
              }
            >
              <For each={items()}>
                {(n) => (
                  <div class="p-4 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800">
                    <div class="text-gray-900 dark:text-white">
                      {n.message || n.type}
                    </div>
                    <div class="text-xs text-gray-500 mt-1">{n.time}</div>
                    <Show when={n.type === "friend_request"}>
                      <div class="mt-2 flex items-center gap-2">
                        <button
                          class="px-3 py-1.5 rounded-full bg-black text-white hover:opacity-90"
                          onClick={async () => {
                            try {
                              await acceptFriendRequest(n.actor_id);
                              await markNotificationRead(n.id);
                              setItems((prev) =>
                                (prev || []).filter((x: any) => x.id !== n.id)
                              );
                            } catch {}
                          }}
                        >
                          承認
                        </button>
                        <button
                          class="px-3 py-1.5 rounded-full border hairline hover:bg-gray-50 dark:hover:bg-neutral-800"
                          onClick={async () => {
                            try {
                              await rejectFriendRequest(n.actor_id);
                              await markNotificationRead(n.id);
                              setItems((prev) =>
                                (prev || []).filter((x: any) => x.id !== n.id)
                              );
                            } catch {}
                          }}
                        >
                          拒否
                        </button>
                      </div>
                    </Show>
                    <Show when={n.type !== "friend_request"}>
                      <button
                        class="mt-2 text-xs text-blue-600 hover:underline"
                        onClick={() =>
                          markNotificationRead(n.id).then(load).catch(() => {})}
                      >
                        既読にする
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
