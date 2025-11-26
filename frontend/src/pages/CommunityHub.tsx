import { useNavigate, useParams } from "@solidjs/router";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import {
  getCommunity,
  listCommunityPosts,
  createDirectInvites,
  searchUsers,
  updateCommunity,
  uploadMedia,
  listCommunityInvites,
  createInviteCode,
  disableInviteCode,
  resetCommunityInvites,
  leaveCommunity,
} from "../lib/api";
import type { Community } from "../lib/api";
import { IconUsers } from "../components/icons";
import Avatar from "../components/Avatar";
import PostCard from "../components/PostCard";
import StoryComposer from "../components/StoryComposer";

// PostComposer removed from hub view

export default function CommunityHub() {
  const params = useParams();
  const navigate = useNavigate();
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
  const [posts, { mutate: setPosts }] = createResource(
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
  const handlePostUpdated = (updated: any) => {
    setPosts((prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.map((p: any) =>
        p.id === updated?.id ? { ...p, ...updated } : p,
      );
    });
  };
  const handlePostDeleted = (id: string) => {
    setPosts((prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.filter((p: any) => p.id !== id);
    });
  };
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

  const [inviteCodes, { refetch: refetchInviteCodes }] = createResource(
    () => community()?.id,
    async (id) => {
      if (!id) return [];
      try {
        return await listCommunityInvites(id);
      } catch {
        return [];
      }
    },
  );
  const [inviteMaxUses, setInviteMaxUses] = createSignal("1");
  const [inviteExpiresAt, setInviteExpiresAt] = createSignal("");
  const [inviteBusy, setInviteBusy] = createSignal(false);
  const [inviteMessage, setInviteMessage] = createSignal<string | null>(null);

  const createCode = async () => {
    if (!params.id) return;
    setInviteBusy(true);
    setInviteMessage(null);
    try {
      const maxUses = Number(inviteMaxUses()) || 1;
      const expires = inviteExpiresAt().trim() || null;
      await createInviteCode(params.id, { max_uses: maxUses, expires_at: expires });
      await refetchInviteCodes();
      setInviteMessage("招待コードを作成しました。");
      setInviteMaxUses("1");
      setInviteExpiresAt("");
    } catch (error: any) {
      setInviteMessage(error?.message || "招待コードの作成に失敗しました。");
    } finally {
      setInviteBusy(false);
    }
  };

  const disableCode = async (code: string) => {
    if (!params.id) return;
    setInviteBusy(true);
    try {
      await disableInviteCode(params.id, code);
      await refetchInviteCodes();
    } catch (error: any) {
      setInviteMessage(error?.message || "無効化に失敗しました。");
    } finally {
      setInviteBusy(false);
    }
  };

  const resetCodes = async () => {
    if (!params.id) return;
    if (!confirm("すべての招待コードを失効させますか？")) return;
    setInviteBusy(true);
    try {
      await resetCommunityInvites(params.id);
      await refetchInviteCodes();
      setInviteMessage("すべての招待コードを無効化しました。");
    } catch (error: any) {
      setInviteMessage(error?.message || "リセットに失敗しました。");
    } finally {
      setInviteBusy(false);
    }
  };

  const [storyOpen, setStoryOpen] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  const [leaveMessage, setLeaveMessage] = createSignal<string | null>(null);

  const handleLeave = async () => {
    if (!params.id) return;
    if (!confirm("コミュニティから退出しますか？")) return;
    setLeaving(true);
    setLeaveMessage(null);
    try {
      await leaveCommunity(params.id);
      navigate("/communities");
    } catch (error: any) {
      setLeaveMessage(error?.message || "退出に失敗しました。");
    } finally {
      setLeaving(false);
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
    <>
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
            <div class="mt-4 flex flex-wrap items-center gap-2">
              <Show when={(community() as any)?.my_role}>
                <button
                  class="px-3 py-2 rounded-full bg-gray-900 text-white text-sm"
                  onClick={() => setStoryOpen(true)}
                >
                  コミュニティストーリーを投稿
                </button>
              </Show>
              <Show when={(community() as any)?.my_role && (community() as any)?.my_role !== "Owner"}>
                <div class="flex items-center gap-2">
                  <button
                    class="px-3 py-2 rounded-full border hairline text-sm disabled:opacity-60"
                    disabled={leaving()}
                    onClick={() => void handleLeave()}
                  >
                    {leaving() ? "退出中…" : "コミュニティを退出"}
                  </button>
                  <Show when={leaveMessage()}>
                    <span class="text-xs text-red-500">{leaveMessage()}</span>
                  </Show>
                </div>
              </Show>
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

        <Show when={canInvite()}>
          <div class="mb-6 grid gap-4 md:grid-cols-2">
            <div class="bg-white dark:bg-neutral-900 border hairline rounded-xl p-4 space-y-3">
              <div class="flex items-center gap-2">
                <div class="font-semibold">招待コード</div>
                <span class="text-xs text-muted">権限: モデレーター以上</span>
              </div>
              <div class="grid gap-2">
                <label class="text-sm text-muted">最大利用回数</label>
                <input
                  class="rounded-full px-3 py-2 bg-gray-50 dark:bg-neutral-900 border hairline"
                  type="number"
                  min="1"
                  value={inviteMaxUses()}
                  onInput={(e) => setInviteMaxUses((e.target as HTMLInputElement).value)}
                />
                <label class="text-sm text-muted">有効期限 (ISO日時, 任意)</label>
                <input
                  class="rounded-full px-3 py-2 bg-gray-50 dark:bg-neutral-900 border hairline"
                  placeholder="例: 2024-12-31T15:00:00Z"
                  value={inviteExpiresAt()}
                  onInput={(e) => setInviteExpiresAt((e.target as HTMLInputElement).value)}
                />
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="px-4 py-2 rounded-full bg-gray-900 text-white text-sm disabled:opacity-60"
                    disabled={inviteBusy()}
                    onClick={() => void createCode()}
                  >
                    {inviteBusy() ? "作成中…" : "コードを作成"}
                  </button>
                  <button
                    type="button"
                    class="px-4 py-2 rounded-full border hairline text-sm disabled:opacity-60"
                    disabled={inviteBusy()}
                    onClick={() => void resetCodes()}
                  >
                    全コードを無効化
                  </button>
                </div>
                <Show when={inviteMessage()}>
                  <div class="text-sm text-muted">{inviteMessage()}</div>
                </Show>
              </div>
            </div>
            <div class="bg-white dark:bg-neutral-900 border hairline rounded-xl p-4 space-y-3">
              <div class="font-semibold flex items-center justify-between">
                <span>発行済みコード</span>
                <button
                  class="text-xs text-blue-600 hover:underline"
                  type="button"
                  onClick={() => refetchInviteCodes()}
                >
                  再読込
                </button>
              </div>
              <Show
                when={!inviteCodes.loading}
                fallback={<div class="text-sm text-muted">読み込み中…</div>}
              >
                <Show
                  when={(inviteCodes() || []).length > 0}
                  fallback={<div class="text-sm text-muted">招待コードはありません。</div>}
                >
                  <div class="flex flex-col gap-2">
                    <For each={inviteCodes() || []}>
                      {(inv: any) => (
                        <div class="border hairline rounded-lg px-3 py-2">
                          <div class="flex items-center gap-2">
                            <span class="font-mono text-sm break-all">{inv.code}</span>
                            <button
                              type="button"
                              class="text-xs px-2 py-1 rounded-full border hairline"
                              onClick={() => navigator.clipboard?.writeText(inv.code)}
                            >
                              コピー
                            </button>
                          </div>
                          <div class="text-xs text-muted mt-1">
                            利用 {inv.uses ?? 0}/{inv.max_uses ?? "∞"} ・
                            {inv.active ? "有効" : "無効"}
                            {inv.expires_at ? ` ・期限 ${inv.expires_at}` : ""}
                          </div>
                          <div class="mt-1 flex items-center gap-2">
                            <button
                              type="button"
                              class="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-neutral-800 disabled:opacity-60"
                              disabled={inviteBusy()}
                              onClick={() => disableCode(inv.code)}
                            >
                              無効化
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </Show>

        {/* 投稿は補助コンテンツとして下部に表示 */}
        <div class="mt-6">
          <div class="font-semibold mb-2">投稿</div>
          <div class="grid gap-0 pb-24">
            <For each={posts() || []}>
              {(p: any) => (
                <PostCard
                  post={{
                    ...p,
                    community_name: community()?.name || (p as any).community_name,
                    community_icon_url: community()?.icon_url || (p as any).community_icon_url,
                  }}
                  onUpdated={handlePostUpdated}
                  onDeleted={handlePostDeleted}
                />
              )}
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
      <StoryComposer
        open={storyOpen()}
        communityId={community()?.id ?? null}
        onClose={() => setStoryOpen(false)}
      />
    </>
  );
}
