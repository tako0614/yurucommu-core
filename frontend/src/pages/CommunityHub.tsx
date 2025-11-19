import { useParams } from "@solidjs/router";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import {
  getUser,
  getCommunity,
  listCommunityPosts,
  createDirectInvites,
  searchUsers,
  updateCommunity,
  uploadMedia,
} from "../lib/api";
import type { Community } from "../lib/api";
import { IconUsers } from "../components/icons";
import Avatar from "../components/Avatar";

// PostComposer removed from hub view

function FeedItem(props: { p: any; community: any }) {
  const [isLiked, setIsLiked] = createSignal(false);
  const [likeCount, setLikeCount] = createSignal(props.p.like_count || 0);
  const [author] = createResource(async () =>
    getUser(props.p.author_id).catch(() => null)
  );

  const handleLike = () => {
    setIsLiked(!isLiked());
    setLikeCount(likeCount() + (isLiked() ? -1 : 1));
  };

  return (
    <article class="bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer">
      {/* Community header */}
      <a
        href={`/c/${props.p.community_id}`}
        class="px-4 pt-2 flex items-center gap-2 text-xs text-gray-500 hover:underline"
      >
        <Avatar
          src={props.community?.icon_url || ""}
          alt="コミュニティ"
          class="w-4 h-4 rounded"
          variant="community"
        />
        <span>{props.community?.name || "コミュニティ"}</span>
      </a>
      {/* Main row */}
      <Show when={author()}>
        <div class="px-4 pb-3 pt-2 flex items-start gap-3">
          <a
            href={`/@${encodeURIComponent((props.p as any).author_handle || props.p.author_id)}`}
            class="flex-shrink-0"
          >
            <Avatar
              src={author()?.avatar_url || ""}
              alt="アバター"
              class="w-12 h-12 rounded-full bg-gray-200 dark:bg-neutral-700 object-cover"
            />
          </a>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1 text-[15px]">
              <a
                href={`/@${encodeURIComponent((props.p as any).author_handle || props.p.author_id)}`}
                class="font-bold text-gray-900 dark:text-white truncate hover:underline"
              >
                {author()?.display_name}
              </a>
            <span class="text-gray-500">·</span>
            <span class="text-gray-500">{props.p.created_at}</span>
          </div>
          {/* Body */}
          <div class="mt-1 text-[15px] leading-[1.4] text-gray-900 dark:text-white whitespace-pre-wrap">
            {props.p.text}
          </div>
          {/* Media */}
          {props.p.media_urls && props.p.media_urls.length > 0 && (
            <div class="mt-3 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700">
              <img
                src={props.p.media_urls[0]}
                alt="投稿画像"
                class="w-full h-auto max-h-96 object-cover"
              />
            </div>
          )}
          {/* Actions */}
          <div class="flex items-center justify-between max-w-md mt-3">
            <button
              class="flex items-center gap-2 text-gray-500 hover:text-blue-500 group"
              aria-label="リプライ"
            >
              <div class="p-2 rounded-full group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-colors">
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                  />
                </svg>
              </div>
              <span class="text-sm">{props.p.comment_count || 0}</span>
            </button>
            <button
              class="flex items-center gap-2 text-gray-500 hover:text-green-500 group"
              aria-label="リポスト"
            >
              <div class="p-2 rounded-full group-hover:bg-green-50 dark:group-hover:bg-green-900/20 transition-colors">
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <span class="text-sm">{props.p.reaction_count || 0}</span>
            </button>
            <button
              class={`flex items-center gap-2 group ${
                isLiked() ? "text-red-500" : "text-gray-500 hover:text-red-500"
              }`}
              onClick={handleLike}
              aria-label="いいね"
            >
              <div
                class={`p-2 rounded-full group-hover:bg-red-50 dark:group-hover:bg-red-900/20 transition-colors ${
                  isLiked() ? "bg-red-50 dark:bg-red-900/20" : ""
                }`}
              >
                <svg
                  class={`w-5 h-5 ${isLiked() ? "fill-current" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                  />
                </svg>
              </div>
              <span class="text-sm">{likeCount()}</span>
            </button>
            <button
              class="flex items-center gap-2 text-gray-500 hover:text-blue-500 group"
              aria-label="共有"
            >
              <div class="p-2 rounded-full group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-colors">
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 12v.01M8 12v.01M12 12v.01M16 12v.01M20 12v.01"
                  />
                </svg>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Show>
    </article>
  );
}

export default function CommunityHub() {
  const params = useParams();
  const communityId = () => params.id;
  const [community] = createResource<Community | null, string | undefined>(
    communityId,
    async (id) => {
      if (!id) return null;
      try {
        return await getCommunity(id);
      } catch {
        return null;
      }
    },
  );
  const [posts] = createResource(
    () => community()?.id,
    async (id) => {
      if (!id) return [];
      try {
        return await listCommunityPosts(id);
      } catch {
        return [];
      }
    },
  );
  // stories removed from hub view

  // posting disabled from hub view

  // Invite/Search state
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<any[]>([]);
  const [notFound, setNotFound] = createSignal(false);
  const [busyInvite, setBusyInvite] = createSignal<string | null>(null);
  const canInvite = createMemo(() => {
    const c: any = community();
    if (!c) return false;
    if (c.invite_policy === "members") return !!c.my_role;
    return c.my_role === "Owner" || c.my_role === "Moderator";
  });
  const doSearch = async () => {
    const raw = query().trim();
    const normalized = raw.startsWith("@") ? raw.slice(1) : raw;
    if (!normalized) {
      setResults([]);
      setNotFound(false);
      return;
    }
    const list = await searchUsers(normalized).catch(() => []);
    const exactMatches = (list || []).filter(
      (u: any) => u?.id === normalized,
    );
    setResults(exactMatches);
    setNotFound(exactMatches.length === 0);
  };
  const inviteUser = async (userId: string) => {
    setBusyInvite(userId);
    try {
      if (!params.id) throw new Error("コミュニティIDが不明です");
      await createDirectInvites(params.id, [userId]);
      alert("招待を送信しました");
    } catch (e: any) {
      alert(e?.message || "招待に失敗しました");
    } finally {
      setBusyInvite(null);
    }
  };

  // Mobile sidebar toggle
  const [showSidebarMobile, setShowSidebarMobile] = createSignal(false);

  // Edit community state
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal("");
  const [icon, setIcon] = createSignal("");
  const [desc, setDesc] = createSignal("");
  const [policy, setPolicy] = createSignal<"owner_mod" | "members">(
    "owner_mod",
  );
  const isManager = createMemo(() =>
    (community() as any)?.my_role === "Owner" || (community() as any)?.my_role === "Moderator"
  );
  const [uploading, setUploading] = createSignal(false);
  const onPickIcon = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadMedia(file);
      setIcon(url);
    } catch (err: any) {
      alert(err?.message || "アイコンのアップロードに失敗しました");
    } finally {
      setUploading(false);
      input.value = "";
    }
  };
  const startEdit = () => {
    const c: any = community();
    if (!c) return;
    setName(c.name || "");
    setIcon(c.icon_url || "");
    setDesc(c.description || "");
    setPolicy((c.invite_policy as any) || "owner_mod");
    setEditing(true);
  };
  const submitEdit = async (e: Event) => {
    e.preventDefault();
    try {
      await updateCommunity(params.id, {
        name: name(),
        icon_url: icon(),
        description: desc(),
        invite_policy: policy(),
      });
      alert("更新しました");
      setEditing(false);
      location.reload();
    } catch (e: any) {
      alert(e?.message || "更新に失敗しました");
    }
  };

  return (
    <div class="mx-auto w-full max-w-[1400px] px-3 sm:px-4 md:px-6 grid md:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] gap-4 md:gap-6">
      {/* Mobile hamburger button (右上) */}
      <div class="md:hidden fixed top-4 right-4 z-50">
        <button
          aria-label="サイドパネルを開く"
          class="p-2 rounded-full bg-white dark:bg-neutral-900 border hairline shadow"
          onClick={() => setShowSidebarMobile((v) => !v)}
        >
          <svg
            class="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
      </div>
      <div>
        <Show when={community()}>
          <div class="mt-4 mb-2 flex items-center gap-3">
            <div class="text-lg font-semibold">{community()!.name}</div>
          </div>
        </Show>

        {/* コミュニティプロフィール / 説明 / 招待 / メンバーをメインに表示 */}
        <Show when={community()}>
          <div class="mt-4 mb-4">
            <div class="flex items-center gap-4">
              <Avatar
                src={community()!.icon_url || ""}
                alt="コミュニティ"
                class="w-20 h-20 rounded-xl object-cover"
                variant="community"
              />
              <div class="min-w-0">
                <div class="text-2xl font-semibold truncate">
                  {community()!.name}
                </div>
                <div class="text-sm text-muted mt-2 truncate">
                  {(community() as any)?.short_description || ""}
                </div>
              </div>
              <Show when={isManager()}>
                <button
                  class="ml-auto px-3 py-1 rounded-full text-sm bg-gray-100 dark:bg-neutral-800"
                  onClick={startEdit}
                >
                  編集
                </button>
              </Show>
            </div>
            <div class="mt-4">
              <div class="font-semibold mb-2">説明</div>
              <div class="text-sm text-muted whitespace-pre-wrap">
                {community()!.description || "説明はありません"}
              </div>
            </div>
          </div>
        </Show>

        {/* Edit dialog */}
        <Show when={editing()}>
          <form
            class="mb-4 bg-white dark:bg-neutral-900 border hairline rounded-xl p-4 grid gap-2"
            onSubmit={submitEdit}
          >
            <div class="font-semibold mb-1">コミュニティ編集</div>
            <input
              class="rounded px-3 py-2 bg-gray-50 dark:bg-neutral-900 border hairline"
              placeholder="名前"
              value={name()}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
            {/* アイコンURL の直接入力は廃止: ファイル選択のみ */}
            <textarea
              class="rounded px-3 py-2 bg-gray-50 dark:bg-neutral-900 border hairline"
              placeholder="説明"
              rows={4}
              value={desc()}
              onInput={(e) => setDesc((e.target as HTMLTextAreaElement).value)}
            />
            <div class="text-sm mt-1">招待権限</div>
            <div class="flex items-center gap-3 text-sm">
              <label class="flex items-center gap-1">
                <input
                  type="radio"
                  name="policy"
                  checked={policy() === "owner_mod"}
                  onChange={() => setPolicy("owner_mod")}
                />{" "}
                オーナー/モデレーターのみ
              </label>
              <label class="flex items-center gap-1">
                <input
                  type="radio"
                  name="policy"
                  checked={policy() === "members"}
                  onChange={() => setPolicy("members")}
                />{" "}
                メンバーまで
              </label>
            </div>
            <div class="grid gap-2">
              <div class="flex items-center gap-2">
                <label class="text-sm text-muted">アイコン画像</label>
                <Show when={uploading()}>
                  <span class="text-sm text-muted">アップロード中...</span>
                </Show>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <label class="inline-flex items-center gap-2 px-3 py-2 rounded border hairline cursor-pointer bg-white dark:bg-neutral-900">
                  <input
                    type="file"
                    accept="image/*"
                    class="hidden"
                    onChange={onPickIcon}
                  />
                  <span class="text-sm">ファイルから選択</span>
                </label>
                <Show when={icon()}>
                  <div class="flex items-center gap-2">
                    <img
                      src={icon()}
                      alt="プレビュー"
                      class="w-12 h-12 rounded object-cover"
                    />
                    <button
                      type="button"
                      class="px-3 py-2 text-sm rounded border hairline"
                      onClick={() => setIcon("")}
                    >
                      クリア
                    </button>
                  </div>
                </Show>
              </div>
            </div>
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                class="px-3 py-2 rounded-full bg-gray-100 dark:bg-neutral-800"
                onClick={() => setEditing(false)}
              >
                キャンセル
              </button>
              <button class="px-3 py-2 rounded-full bg-gray-900 text-white">
                保存
              </button>
            </div>
          </form>
        </Show>

        {/* 投稿は補助コンテンツとして下部に表示 */}
        <div class="mt-6">
          <div class="font-semibold mb-2">投稿</div>
          <div class="grid gap-0 pb-24">
            <For each={posts() || []}>
              {(p: any) => <FeedItem p={p} community={community()} />}
            </For>
          </div>
        </div>
      </div>

      {/* 右ペイン：デスクトップは従来通り固定、モバイルはハンガーから展開するドロワー */}
      <aside class="hidden md:block pt-4">
        <div class="bg-white dark:bg-neutral-900 border hairline rounded-xl p-4 sticky top-[72px] flex flex-col gap-4">
          <div>
            <div class="font-semibold mb-2 flex items-center gap-2">
              <IconUsers size={18} /> 概要
            </div>
            <div class="mt-1 text-sm">
              メンバー: {(community() as any)?.member_count ?? "—"}
            </div>
          </div>
          <Show when={canInvite()}>
            <div>
              <div class="font-semibold mb-2">メンバー招待</div>
              <div class="flex gap-2 mb-2">
                <input
                  class="flex-1 rounded-full px-3 py-2 bg-gray-50 dark:bg-neutral-900 border hairline"
                  placeholder="ユーザーIDで検索"
                  value={query()}
                  onInput={(e) =>
                    setQuery((e.target as HTMLInputElement).value)}
                />
                <button
                  class="px-3 py-2 rounded-full bg-gray-100 dark:bg-neutral-800"
                  onClick={doSearch}
                >
                  検索
                </button>
              </div>
              <div class="flex flex-col gap-2 max-h-40 overflow-auto">
                <For each={results()}>
                  {(u: any) => (
                    <div class="flex items-center gap-2">
                      <Avatar
                        src={u.avatar_url || ""}
                        alt="ユーザー"
                        class="w-8 h-8 rounded-full"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="text-sm truncate">
                          {u.display_name || u.id}
                        </div>
                        <div class="text-xs text-gray-500 truncate">
                          @{u.id}
                        </div>
                      </div>
                      <button
                        class="text-xs px-2 py-1 rounded-full bg-gray-900 text-white disabled:opacity-50"
                        disabled={busyInvite() === u.id}
                        onClick={() => inviteUser(u.id)}
                      >
                        {busyInvite() === u.id ? "送信中…" : "招待"}
                      </button>
                    </div>
                  )}
                </For>
              </div>
              <Show when={notFound()}>
                <div class="text-xs text-muted">一致するユーザーIDが見つかりません</div>
              </Show>
            </div>
          </Show>
          <div>
            <div class="font-semibold mb-2">メンバー</div>
            <div class="flex flex-col gap-2 max-h-56 overflow-auto">
              <For each={(community() as any)?.members || []}>
                {(m: any) => (
                  <div class="flex items-center gap-2">
                    <Avatar
                      src={m.avatar_url || ""}
                      alt="メンバー"
                      class="w-8 h-8 rounded-full"
                    />
                    <div class="text-sm truncate">
                      {m.display_name || m.nickname}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      <Show when={showSidebarMobile()}>
        <div class="fixed inset-0 z-40">
          <div
            class="absolute inset-0 bg-black/40"
            onClick={() => setShowSidebarMobile(false)}
          />
          <div class="absolute right-0 top-0 h-full w-[320px] max-w-[90%] bg-white dark:bg-neutral-900 border-l hairline p-4 overflow-auto">
            <div class="flex items-center justify-between">
              <div class="font-semibold flex items-center gap-2">
                <IconUsers size={18} /> 概要
              </div>
              <button
                class="p-1"
                onClick={() => setShowSidebarMobile(false)}
                aria-label="閉じる"
              >
                <svg
                  class="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="mt-2 text-sm">
              メンバー: {(community() as any)?.member_count ?? "—"}
            </div>
            <Show when={canInvite()}>
              <div class="mt-4">
                <div class="font-semibold mb-2">メンバー招待</div>
                <div class="flex gap-2 mb-2">
                  <input
                    class="flex-1 rounded-full px-3 py-2 bg-gray-50 dark:bg-neutral-900 border hairline"
                    placeholder="ユーザーIDで検索"
                    value={query()}
                    onInput={(e) =>
                      setQuery((e.target as HTMLInputElement).value)}
                  />
                  <button
                    class="px-3 py-2 rounded-full bg-gray-100 dark:bg-neutral-800"
                    onClick={doSearch}
                  >
                    検索
                  </button>
                </div>
                <div class="flex flex-col gap-2 max-h-40 overflow-auto">
                  <For each={results()}>
                    {(u: any) => (
                      <div class="flex items-center gap-2">
                        <Avatar
                          src={u.avatar_url || ""}
                          alt="ユーザー"
                          class="w-8 h-8 rounded-full"
                        />
                        <div class="flex-1 min-w-0">
                          <div class="text-sm truncate">
                            {u.display_name || u.id}
                          </div>
                          <div class="text-xs text-gray-500 truncate">
                            @{u.id}
                          </div>
                        </div>
                        <button
                          class="text-xs px-2 py-1 rounded-full bg-gray-900 text-white disabled:opacity-50"
                          disabled={busyInvite() === u.id}
                          onClick={() => inviteUser(u.id)}
                        >
                          {busyInvite() === u.id ? "送信中…" : "招待"}
                        </button>
                      </div>
                    )}
                  </For>
                </div>
                <Show when={notFound()}>
                  <div class="text-xs text-muted">一致するユーザーIDが見つかりません</div>
                </Show>
              </div>
            </Show>
            <div class="mt-4">
              <div class="font-semibold mb-2">メンバー</div>
              <div class="flex flex-col gap-2 max-h-56 overflow-auto">
                <For each={(community() as any)?.members || []}>
                  {(m: any) => (
                    <div class="flex items-center gap-2">
                    <Avatar
                      src={m.avatar_url || ""}
                      alt="メンバー"
                      class="w-8 h-8 rounded-full"
                    />
                      <div class="text-sm truncate">
                        {m.display_name || m.nickname}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
