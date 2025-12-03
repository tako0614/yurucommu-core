import { For, Show, createResource, createSignal } from "solid-js";
import {
  ApiError,
  addBlockedInstance,
  listBlockedInstances,
  removeBlockedInstance,
  type BlockedInstancesResponse,
} from "../lib/api-client";

/**
 * Federation Policy Manager
 * Manages blocked_instances for ActivityPub federation.
 * Future: May include allowlist management when API is available.
 */
export default function FederationPolicyManager() {
  const [input, setInput] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  const [forbidden, setForbidden] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const fetcher = async (): Promise<BlockedInstancesResponse | null> => {
    try {
      setForbidden(false);
      setError("");
      return await listBlockedInstances();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        return null;
      }
      setError(err instanceof Error ? err.message : "取得に失敗しました");
      return null;
    }
  };

  const [blocklist, { mutate, refetch }] = createResource<BlockedInstancesResponse | null>(fetcher);

  const sortedEntries = () => {
    const entries = blocklist()?.blocked_instances ?? [];
    return [...entries].sort((a, b) => a.domain.localeCompare(b.domain));
  };

  const handleAdd = async (e: Event) => {
    e.preventDefault();
    const domain = input().trim();
    if (!domain) {
      setError("ドメインを入力してください");
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await addBlockedInstance(domain);
      mutate(res);
      setMessage("ブロックリストに追加しました。");
      setInput("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        setError("管理者のみ操作できます。");
      } else {
        setError(err instanceof Error ? err.message : "追加に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (domain: string) => {
    if (!confirm(`"${domain}" のブロックを解除しますか？`)) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await removeBlockedInstance(domain);
      mutate(res);
      setMessage(
        res.still_blocked
          ? `${domain} は環境変数によって引き続きブロックされています。`
          : "ブロックを解除しました。",
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
        setError("管理者のみ操作できます。");
      } else {
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  };

  const refreshList = async () => {
    setMessage("");
    setError("");
    await refetch();
  };

  const sourceLabel = () => {
    const source = blocklist()?.source;
    if (!source) return "";
    return source === "stored" ? "stored config" : "runtime config";
  };

  return (
    <section class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 class="text-lg font-semibold">Federation Policy</h2>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            ActivityPub フェデレーションのブロックリストを管理します。変更はすぐに連合ルーティングへ反映されます。
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Show when={sourceLabel()}>
            <span class="px-2 py-1 text-xs rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">
              {sourceLabel()}
            </span>
          </Show>
          <button
            type="button"
            class="px-2 py-1 text-xs rounded-full border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
            onClick={() => void refreshList()}
            disabled={blocklist.loading}
          >
            再読込
          </button>
        </div>
      </div>

      <Show when={forbidden()}>
        <div class="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 text-sm text-yellow-800 dark:text-yellow-200">
          このセクションは管理者のみが利用できます。
        </div>
      </Show>

      <Show when={!forbidden()}>
        {/* Blocked Instances Section */}
        <div class="mb-4">
          <h3 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            ブロックリスト
          </h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
            ブロックしたインスタンスからのアクティビティは拒否されます。
          </p>
        </div>

        <form class="flex flex-col md:flex-row gap-2 mb-3" onSubmit={(e) => void handleAdd(e)}>
          <input
            class="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 bg-gray-50 dark:bg-neutral-900"
            placeholder="spam.example などのドメイン"
            value={input()}
            onInput={(e) => setInput((e.target as HTMLInputElement).value)}
            disabled={busy()}
          />
          <button
            type="submit"
            class="px-4 py-2 rounded-full bg-gray-900 text-white disabled:opacity-60"
            disabled={busy()}
          >
            {busy() ? "処理中…" : "追加"}
          </button>
        </form>

        <Show when={message()}>
          <div class="mb-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
            {message()}
          </div>
        </Show>
        <Show when={error()}>
          <div class="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
            {error()}
          </div>
        </Show>

        <div class="border border-gray-200 dark:border-gray-700 rounded-lg">
          <Show
            when={!blocklist.loading}
            fallback={
              <div class="p-6 text-center text-sm text-gray-600 dark:text-gray-400">
                読み込み中...
              </div>
            }
          >
            <Show
              when={sortedEntries().length}
              fallback={
                <div class="p-6 text-center text-sm text-gray-600 dark:text-gray-400">
                  現在ブロックしているインスタンスはありません。
                </div>
              }
            >
              <ul class="divide-y divide-gray-200 dark:divide-gray-700">
                <For each={sortedEntries()}>
                  {(entry) => (
                    <li class="flex items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <div class="font-mono text-sm break-all">{entry.domain}</div>
                        <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
                          <span class="px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                            {entry.source === "env"
                              ? "ENV (読み取り専用)"
                              : entry.source === "config+env"
                                ? "Config + ENV"
                                : "Config"}
                          </span>
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <Show when={entry.env && !entry.config}>
                          <span class="text-xs text-gray-500 dark:text-gray-400">
                            環境変数で固定
                          </span>
                        </Show>
                        <Show when={entry.config}>
                          <button
                            type="button"
                            class="text-sm text-red-600 dark:text-red-400 hover:underline disabled:opacity-60"
                            onClick={() => void handleRemove(entry.domain)}
                            disabled={busy()}
                          >
                            削除
                          </button>
                        </Show>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </Show>
    </section>
  );
}
