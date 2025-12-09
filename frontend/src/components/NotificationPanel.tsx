import { createEffect, createSignal, For, onMount, Show } from "../lib/solid-compat";
import {
  acceptFollowRequest,
  listNotifications,
  markNotificationRead,
  rejectFollowRequest,
} from "../lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function NotificationPanel(props: Props) {
  const [items, setItems] = createSignal<any[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let closeButtonRef: HTMLButtonElement | undefined;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listNotifications();
      const mapped = (list as any[]).map((n: any) => ({
        ...n,
        time: new Date(n.created_at).toLocaleString(),
      }));
      setItems(mapped);
    } catch (err: any) {
      setError(err?.message || "通知を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  };

  onMount(load);
  createEffect(() => {
    if (props.open) {
      void load();
    }
  });

  createEffect(() => {
    if (!props.open) return;
    const body = typeof document !== "undefined" ? document.body : null;
    const previousOverflow = body?.style.overflow || "";
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeydown);
    if (body) body.style.overflow = "hidden";
    queueMicrotask(() => closeButtonRef?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeydown);
      if (body) body.style.overflow = previousOverflow;
    };
  });

  return (
    <Show when={props.open}>
      {/* Overlay */}
      <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
        <button
          className="absolute inset-0 bg-black/20"
          aria-label="閉じる"
          onClick={props.onClose}
        />
        {/* Panel */}
        <div className="absolute right-0 top-0 h-full w-full md:w-[360px] bg-white dark:bg-neutral-900 border-l hairline shadow-xl flex flex-col">
          <div className="h-14 flex items-center justify-between px-4 border-b hairline">
            <div className="text-[16px] font-semibold">通知</div>
            <button
              ref={(el) => {
                closeButtonRef = el ?? undefined;
              }}
              className="text-sm text-gray-500 hover:text-gray-800"
              onClick={props.onClose}
            >
              閉じる
            </button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y hairline">
            <Show when={loading()}>
              <div className="p-4 text-sm text-muted">読み込み中…</div>
            </Show>
            <Show when={error()}>
              <div className="p-4 text-sm text-red-500 flex items-center justify-between gap-2">
                <span>{error()}</span>
                <button
                  className="text-xs px-2 py-1 rounded border hairline"
                  onClick={() => load()}
                >
                  再読み込み
                </button>
              </div>
            </Show>
            <Show
              when={!loading() && !error() && items().length > 0}
              fallback={
                <div className="p-4 text-sm text-muted">通知はありません</div>
              }
            >
              <For each={items()}>
                {(n) => (
                  <div className="p-4 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800">
                    <div className="text-gray-900 dark:text-white">
                      {n.message || n.type}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{n.time}</div>
                    <Show when={n.type === "follow_request"}>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          className="px-3 py-1.5 rounded-full bg-black text-white hover:opacity-90"
                          onClick={async () => {
                            try {
                              await acceptFollowRequest(n.actor_id);
                              await markNotificationRead(n.id);
                              setItems((prev) =>
                                (prev || []).filter((x: any) => x.id !== n.id)
                              );
                            } catch (err: any) {
                              setError(err?.message || "処理に失敗しました");
                            }
                          }}
                        >
                          承認
                        </button>
                        <button
                          className="px-3 py-1.5 rounded-full border hairline hover:bg-gray-50 dark:hover:bg-neutral-800"
                          onClick={async () => {
                            try {
                              await rejectFollowRequest(n.actor_id);
                              await markNotificationRead(n.id);
                              setItems((prev) =>
                                (prev || []).filter((x: any) => x.id !== n.id)
                              );
                            } catch (err: any) {
                              setError(err?.message || "処理に失敗しました");
                            }
                          }}
                        >
                          拒否
                        </button>
                      </div>
                    </Show>
                    <Show when={n.type !== "follow_request"}>
                      <button
                        className="mt-2 text-xs text-blue-600 hover:underline"
                        onClick={() =>
                          markNotificationRead(n.id).then(load).catch((err: any) => setError(err?.message || "更新に失敗しました"))}
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
