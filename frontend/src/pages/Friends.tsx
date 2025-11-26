import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import Avatar from "../components/Avatar";
import {
  acceptFriendRequest,
  listMyFriendRequests,
  listMyFriends,
  rejectFriendRequest,
  searchUsers,
  sendFriendRequest,
} from "../lib/api";

export default function Friends() {
  const [friends, { refetch: refetchFriends }] = createResource(async () =>
    (await listMyFriends().catch(() => [])) as any[],
  );
  const [incoming, { refetch: refetchIncoming }] = createResource(async () =>
    (await listMyFriendRequests("incoming").catch(() => [])) as any[],
  );
  const [outgoing, { refetch: refetchOutgoing }] = createResource(async () =>
    (await listMyFriendRequests("outgoing").catch(() => [])) as any[],
  );

  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<any[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [actionUser, setActionUser] = createSignal<string | null>(null);
  const [message, setMessage] = createSignal<string | null>(null);

  const friendCount = createMemo(() => (friends() || []).length);
  const incomingCount = createMemo(() => (incoming() || []).length);
  const outgoingCount = createMemo(() => (outgoing() || []).length);

  const handleSearch = async () => {
    const raw = query().trim();
    const normalized = raw.startsWith("@") ? raw.slice(1) : raw;
    if (!normalized) {
      setResults([]);
      setMessage(null);
      return;
    }
    setSearching(true);
    try {
      const list = await searchUsers(normalized).catch(() => []);
      setResults(Array.isArray(list) ? list : []);
      if (!list || (Array.isArray(list) && list.length === 0)) {
        setMessage("一致するユーザーが見つかりませんでした。");
      } else {
        setMessage(null);
      }
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async (userId: string) => {
    setActionUser(userId);
    setMessage(null);
    try {
      await sendFriendRequest(userId);
      await refetchOutgoing();
      setMessage("フレンドリクエストを送信しました。");
    } catch (error: any) {
      setMessage(error?.message || "フレンドリクエストの送信に失敗しました。");
    } finally {
      setActionUser(null);
    }
  };

  const handleAccept = async (userId: string) => {
    setActionUser(userId);
    try {
      await acceptFriendRequest(userId);
      await Promise.all([refetchIncoming(), refetchFriends()]);
    } catch (error: any) {
      setMessage(error?.message || "承認に失敗しました。");
    } finally {
      setActionUser(null);
    }
  };

  const handleReject = async (userId: string) => {
    setActionUser(userId);
    try {
      await rejectFriendRequest(userId);
      await Promise.all([refetchIncoming(), refetchFriends(), refetchOutgoing()]);
    } catch (error: any) {
      setMessage(error?.message || "拒否に失敗しました。");
    } finally {
      setActionUser(null);
    }
  };

  return (
    <div class="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-bold">フレンド</h1>
        <span class="text-sm text-muted">つながりを管理</span>
        <a
          class="ml-auto text-sm text-blue-600 hover:underline"
          href="/communities"
        >
          コミュニティを見る
        </a>
      </div>

      <section class="bg-white dark:bg-neutral-900 border hairline rounded-2xl p-4 space-y-4">
        <div class="flex items-center gap-2">
          <input
            class="flex-1 rounded-full border hairline px-4 py-2 bg-gray-50 dark:bg-neutral-900"
            placeholder="ユーザーIDで検索 (@を含めてもOK)"
            value={query()}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if ((e as KeyboardEvent).key === "Enter") void handleSearch();
            }}
          />
          <button
            type="button"
            class="px-4 py-2 rounded-full bg-blue-600 text-white disabled:opacity-60"
            onClick={() => void handleSearch()}
            disabled={searching()}
          >
            {searching() ? "検索中…" : "検索"}
          </button>
          <a
            class="text-sm text-blue-600 hover:underline"
            href="/users"
          >
            詳細検索
          </a>
        </div>
        <Show when={message()}>
          <div class="text-sm text-muted">{message()}</div>
        </Show>
        <Show when={(results() || []).length > 0}>
          <div class="divide-y hairline rounded-xl border hairline overflow-hidden">
            <For each={results()}>
              {(user: any) => (
                <div class="flex items-center gap-3 px-4 py-3 bg-white dark:bg-neutral-900">
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
                    class="text-sm text-blue-600 hover:underline"
                    href={`/@${encodeURIComponent(user.id)}`}
                  >
                    プロフィール
                  </a>
                  <button
                    class="px-3 py-2 rounded-full bg-gray-900 text-white text-sm disabled:opacity-60"
                    disabled={actionUser() === user.id}
                    onClick={() => handleSendRequest(user.id)}
                  >
                    {actionUser() === user.id ? "送信中…" : "フレンド申請"}
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      <section class="grid md:grid-cols-2 gap-4">
        <div class="bg-white dark:bg-neutral-900 border hairline rounded-2xl p-4 space-y-3">
          <div class="flex items-center gap-2">
            <h2 class="font-semibold">受信リクエスト</h2>
            <span class="text-xs rounded-full bg-gray-100 px-2 py-1">
              {incomingCount()}件
            </span>
          </div>
          <Show
            when={!incoming.loading}
            fallback={<div class="text-sm text-muted">読み込み中…</div>}
          >
            <Show
              when={(incoming() || []).length > 0}
              fallback={<div class="text-sm text-muted">リクエストはありません</div>}
            >
              <div class="divide-y hairline rounded-xl border hairline overflow-hidden">
                <For each={incoming()}>
                  {(edge: any) => {
                    const user = edge.requester;
                    return (
                      <div class="flex items-center gap-3 px-3 py-3">
                        <Avatar
                          src={user?.avatar_url || ""}
                          alt={user?.display_name || user?.id}
                          class="w-9 h-9 rounded-full"
                        />
                        <div class="flex-1 min-w-0">
                          <div class="font-medium truncate">
                            {user?.display_name || user?.id}
                          </div>
                          <div class="text-xs text-muted truncate">
                            @{user?.id}
                          </div>
                        </div>
                        <div class="flex items-center gap-2">
                          <button
                            class="px-3 py-1.5 rounded-full bg-gray-900 text-white text-sm disabled:opacity-60"
                            disabled={actionUser() === user?.id}
                            onClick={() => user?.id && handleAccept(user.id)}
                          >
                            {actionUser() === user?.id ? "処理中…" : "承認"}
                          </button>
                          <button
                            class="px-3 py-1.5 rounded-full border hairline text-sm disabled:opacity-60"
                            disabled={actionUser() === user?.id}
                            onClick={() => user?.id && handleReject(user.id)}
                          >
                            拒否
                          </button>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>

        <div class="bg-white dark:bg-neutral-900 border hairline rounded-2xl p-4 space-y-3">
          <div class="flex items-center gap-2">
            <h2 class="font-semibold">送信済みリクエスト</h2>
            <span class="text-xs rounded-full bg-gray-100 px-2 py-1">
              {outgoingCount()}件
            </span>
          </div>
          <Show
            when={!outgoing.loading}
            fallback={<div class="text-sm text-muted">読み込み中…</div>}
          >
            <Show
              when={(outgoing() || []).length > 0}
              fallback={
                <div class="text-sm text-muted">
                  送信済みのリクエストはありません
                </div>
              }
            >
              <div class="divide-y hairline rounded-xl border hairline overflow-hidden">
                <For each={outgoing()}>
                  {(edge: any) => {
                    const user = edge.addressee;
                    return (
                      <div class="flex items-center gap-3 px-3 py-3">
                        <Avatar
                          src={user?.avatar_url || ""}
                          alt={user?.display_name || user?.id}
                          class="w-9 h-9 rounded-full"
                        />
                        <div class="flex-1 min-w-0">
                          <div class="font-medium truncate">
                            {user?.display_name || user?.id}
                          </div>
                          <div class="text-xs text-muted truncate">
                            @{user?.id}
                          </div>
                        </div>
                        <span class="text-xs text-muted">待機中</span>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </section>

      <section class="bg-white dark:bg-neutral-900 border hairline rounded-2xl p-4 space-y-3">
        <div class="flex items-center gap-2">
          <h2 class="font-semibold">フレンド</h2>
          <span class="text-xs rounded-full bg-gray-100 px-2 py-1">
            {friendCount()}人
          </span>
        </div>
        <Show
          when={!friends.loading}
          fallback={<div class="text-sm text-muted">読み込み中…</div>}
        >
          <Show
            when={(friends() || []).length > 0}
            fallback={<div class="text-sm text-muted">まだフレンドがいません</div>}
          >
            <div class="divide-y hairline rounded-xl border hairline overflow-hidden">
              <For each={friends()}>
                {(edge: any) => {
                  const user = edge.addressee || edge.requester;
                  return (
                    <div class="flex items-center gap-3 px-3 py-3">
                      <Avatar
                        src={user?.avatar_url || ""}
                        alt={user?.display_name || user?.id}
                        class="w-10 h-10 rounded-full"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="font-semibold truncate">
                          {user?.display_name || user?.id}
                        </div>
                        <div class="text-xs text-muted truncate">@{user?.id}</div>
                      </div>
                      <div class="flex items-center gap-2">
                        <a
                          class="text-xs px-3 py-1 rounded-full border hairline hover:bg-gray-50"
                          href={`/chat/dm/${encodeURIComponent(user?.id || "")}`}
                        >
                          DM
                        </a>
                        <a
                          class="text-xs px-3 py-1 rounded-full bg-gray-900 text-white"
                          href={`/@${encodeURIComponent(user?.id || "")}`}
                        >
                          プロフィール
                        </a>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </Show>
      </section>
    </div>
  );
}
