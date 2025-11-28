import { For, Show, createResource, createSignal } from "solid-js";
import Avatar from "../components/Avatar";
import { searchUsers, followUser } from "../lib/api";

export default function UserSearch() {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<any[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [hint, setHint] = createSignal<string | null>(null);

  const [recent] = createResource(async () => []); // placeholder for future suggestions

  const runSearch = async () => {
    const raw = query().trim();
    const normalized = raw.startsWith("@") ? raw.slice(1) : raw;
    if (!normalized) {
      setResults([]);
      setHint("ユーザーIDまたは @handle を入力してください。");
      return;
    }
    setSearching(true);
    setHint(null);
    try {
      const list = await searchUsers(normalized).catch(() => []);
      setResults(Array.isArray(list) ? list : []);
      if (!list || (Array.isArray(list) && list.length === 0)) {
        setHint("一致するユーザーが見つかりませんでした。");
      }
    } finally {
      setSearching(false);
    }
  };

  const requestFollow = async (userId: string) => {
    setBusyId(userId);
    setHint(null);
    try {
      await followUser(userId);
      setHint("フォローリクエストを送信しました。");
    } catch (error: any) {
      setHint(error?.message || "フォローリクエストの送信に失敗しました。");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div class="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <header class="flex items-center gap-3">
        <h1 class="text-2xl font-bold">ユーザー検索</h1>
        <span class="text-sm text-muted">フォローする相手を見つけましょう</span>
        <a class="ml-auto text-sm text-blue-600 hover:underline" href="/connections">
          フォロー管理へ
        </a>
      </header>

      <div class="bg-white dark:bg-neutral-900 border hairline rounded-2xl p-4 space-y-3">
        <div class="flex items-center gap-2">
          <input
            class="flex-1 rounded-full border hairline px-4 py-2 bg-gray-50 dark:bg-neutral-900"
            placeholder="ユーザーIDまたは @handle を入力"
            value={query()}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if ((e as KeyboardEvent).key === "Enter") void runSearch();
            }}
          />
          <button
            type="button"
            class="px-4 py-2 rounded-full bg-blue-600 text-white disabled:opacity-60"
            onClick={() => void runSearch()}
            disabled={searching()}
          >
            {searching() ? "検索中…" : "検索"}
          </button>
        </div>
        <Show when={hint()}>
          <div class="text-sm text-muted">{hint()}</div>
        </Show>
        <Show when={searching()}>
          <div class="text-sm text-muted">検索中です…</div>
        </Show>
        <Show when={(results() || []).length > 0}>
          <div class="divide-y hairline rounded-xl border hairline overflow-hidden">
            <For each={results()}>
              {(user: any) => (
                <div class="flex items-center gap-3 px-3 py-3">
                  <Avatar
                    src={user.avatar_url || ""}
                    alt={user.display_name || user.id}
                    class="w-10 h-10 rounded-full"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold truncate">
                      {user.display_name || user.id}
                    </div>
                    <div class="text-xs text-muted truncate">@{user.id}</div>
                  </div>
                  <a
                    class="text-xs px-3 py-1 rounded-full border hairline hover:bg-gray-50"
                    href={`/@${encodeURIComponent(user.id)}`}
                  >
                    プロフィール
                  </a>
                  <button
                    class="text-xs px-3 py-1 rounded-full bg-gray-900 text-white disabled:opacity-60"
                    disabled={busyId() === user.id}
                    onClick={() => requestFollow(user.id)}
                  >
                    {busyId() === user.id ? "送信中…" : "フォロー"}
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={!searching() && results().length === 0 && !hint()}>
          <div class="text-sm text-muted">
            まだ検索していません。キーワードを入力して検索を開始してください。
          </div>
        </Show>
      </div>

      <Show when={(recent() || []).length > 0}>
        <section class="bg-white dark:bg-neutral-900 border hairline rounded-2xl p-4">
          <h2 class="font-semibold mb-3">最近の検索</h2>
          <p class="text-sm text-muted">近日公開予定</p>
        </section>
      </Show>
    </div>
  );
}
