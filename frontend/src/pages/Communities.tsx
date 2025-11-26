import { createSignal, createResource, createMemo, For, Show, Switch, Match } from "solid-js";
import { useNavigate } from "@solidjs/router";

import Avatar from "../components/Avatar";
import ProfileModal from "../components/ProfileModal";
import CommunityCreateModal from "../components/CommunityCreateModal";
import { IconQr } from "../components/icons";
import {
  listMyCommunities,
  searchCommunities,
  searchUsers,
  listMyFriends,
  listMyFriendRequests,
  joinCommunity,
  useMe,
} from "../lib/api";
import { buildProfileUrlByHandle, buildActivityPubHandle, getUserDomain } from "../lib/url";

type ViewMode = "overview" | "friends" | "communities";

type User = {
  id: string;
  display_name?: string;
  avatar_url?: string;
};

type FriendEntry = { user: User; relation: string };

function relationLabel(relation: string) {
  switch (relation) {
    case "friend":
      return "友達";
    case "outgoing":
      return "リクエスト送信済み";
    case "incoming":
    default:
      return "リクエスト受信中";
  }
}

export default function Communities() {
  const me = useMe();
  const navigate = useNavigate();

  const [viewMode, setViewMode] = createSignal<ViewMode>("communities");
  const [shareOpen, setShareOpen] = createSignal(false);
  const [profileModalView, setProfileModalView] = createSignal<"share" | "scan">("share");

  const [
    myCommunities,
    { mutate: setMyCommunities, refetch: refetchMyCommunities },
  ] = createResource(async () => (await listMyCommunities().catch(() => [])) as any[]);
  const [communityQuery, setCommunityQuery] = createSignal("");
  const [communityResults, setCommunityResults] = createSignal<any[]>([]);
  const [communitySearching, setCommunitySearching] = createSignal(false);
  const [communityHasSearched, setCommunityHasSearched] = createSignal(false);

  const [userQuery, setUserQuery] = createSignal("");
  const [userResults, setUserResults] = createSignal<any[]>([]);
  const [userSearching, setUserSearching] = createSignal(false);
  const [userNotFound, setUserNotFound] = createSignal(false);

  const [friendsList] = createResource(async () => (await listMyFriends().catch(() => [])) as any[]);
  const [incomingRequests] = createResource(async () => (await listMyFriendRequests("incoming").catch(() => [])) as any[]);
  const [outgoingRequests] = createResource(async () => (await listMyFriendRequests("outgoing").catch(() => [])) as any[]);
  const [createCommunityOpen, setCreateCommunityOpen] = createSignal(false);
  const [joinCommunityId, setJoinCommunityId] = createSignal("");
  const [joinCode, setJoinCode] = createSignal("");
  const [joinNickname, setJoinNickname] = createSignal("");
  const [joining, setJoining] = createSignal(false);
  const [joinMessage, setJoinMessage] = createSignal<string | null>(null);

  const friends = createMemo<FriendEntry[]>(() => {
    const map = new Map<string, FriendEntry>();
    const meId = me()?.id;

    (friendsList() || []).forEach((edge: any) => {
      const user = edge.requester_id === meId ? edge.addressee : edge.requester;
      if (user?.id) map.set(user.id, { user, relation: "friend" });
    });

    (outgoingRequests() || []).forEach((edge: any) => {
      const user = edge.addressee;
      if (user?.id && !map.has(user.id)) map.set(user.id, { user, relation: "outgoing" });
    });

    (incomingRequests() || []).forEach((edge: any) => {
      const user = edge.requester;
      if (user?.id && !map.has(user.id)) map.set(user.id, { user, relation: "incoming" });
    });

    return Array.from(map.values()).sort((a, b) => {
      const an = a.user.display_name || a.user.id;
      const bn = b.user.display_name || b.user.id;
      return an.localeCompare(bn, "ja");
    });
  });

  const friendsLoading = createMemo(
    () => friendsList.loading || incomingRequests.loading || outgoingRequests.loading,
  );
  const communitiesLoading = createMemo(() => myCommunities.loading);

  const firstFriend = createMemo(() => friends()[0]?.user ?? null);
  const firstCommunity = createMemo(() => (myCommunities() || [])[0] ?? null);

  const friendPreview = createMemo(() => {
    if (friendsLoading()) return "読み込み中...";
    const entries = friends();
    if (!entries.length) return "まだ友達がいません";
    const names = entries.slice(0, 3).map((entry) => entry.user.display_name || entry.user.id);
    const joined = names.join(", ");
    return entries.length > 3 ? `${joined} 他${entries.length - 3}人` : joined;
  });

  const communityPreview = createMemo(() => {
    if (communitiesLoading()) return "読み込み中...";
    const list = myCommunities() || [];
    if (!list.length) return "まだコミュニティはありません";
    const names = list.slice(0, 2).map((community: any) => community.name);
    const joined = names.join(", ");
    return list.length > 2 ? `${joined} 他${list.length - 2}件` : joined;
  });

  const friendCountLabel = createMemo(() => (friendsLoading() ? "…" : `${friends().length}人`));
  const communityCountLabel = createMemo(() =>
    communityHasSearched() ? `${communityResults().length}件` : communitiesLoading() ? "…" : `${(myCommunities() || []).length}件`,
  );

  const shareUrl = createMemo(() => {
    const handle = (me() as any)?.handle;
    if (!handle) return "";
    const domain = getUserDomain(me());
    return buildProfileUrlByHandle(handle, domain);
  });

  const shareHandle = createMemo(() => {
    const handle = (me() as any)?.handle;
    if (!handle) return me()?.id || "";
    const domain = getUserDomain(me());
    return buildActivityPubHandle(handle, domain);
  });
  const shareDisplayName = createMemo(() => me()?.display_name || "");
  const shareAvatar = createMemo(() => me()?.avatar_url || "");

  const extractProfileIdFromScan = (value: string): string | null => {
    const raw = (value || "").trim();
    if (!raw) return null;

    const normalized = raw.startsWith("@") ? raw.slice(1) : raw;
    if (/^[A-Za-z0-9._-]{3,}$/.test(normalized)) {
      return normalized;
    }

    const toUrl = (input: string) => {
      try {
        return new URL(input);
      } catch {
        if (typeof window !== "undefined") {
          try {
            return new URL(input, window.location.origin);
          } catch {
            return null;
          }
        }
        return null;
      }
    };

    const url = toUrl(raw);
    if (!url) return null;

    const match = url.pathname.match(/^\/u\/([^/?#]+)/);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }

    return null;
  };

  const openProfileModal = (mode: "share" | "scan") => {
    setProfileModalView(mode);
    setShareOpen(true);
  };

  const closeProfileModal = () => {
    setShareOpen(false);
    setProfileModalView("share");
  };

  const handleScanDetected = (value: string) => {
    const profileId = extractProfileIdFromScan(value);
    if (profileId) {
      closeProfileModal();
      navigate(`/@${encodeURIComponent(profileId)}`);
    }
  };

  const handleCommunitySearch = async () => {
    const q = (communityQuery() || "").trim();
    if (!q) {
      setCommunityHasSearched(false);
      setCommunityResults([]);
      return;
    }
    setCommunityHasSearched(true);
    setCommunitySearching(true);
    try {
      const res = await searchCommunities(q).catch(() => []);
      setCommunityResults(res || []);
    } finally {
      setCommunitySearching(false);
    }
  };

  const handleUserSearch = async () => {
    const raw = userQuery().trim();
    const normalized = raw.startsWith("@") ? raw.slice(1) : raw;
    if (!normalized) {
      setUserResults([]);
      setUserNotFound(false);
      return;
    }
    setUserSearching(true);
    try {
      const list = await searchUsers(normalized).catch(() => []);
      const matches = (list || []).filter((u: any) => u?.id === normalized);
      setUserResults(matches);
      setUserNotFound(matches.length === 0);
    } finally {
      setUserSearching(false);
    }
  };

  const handleJoinByCode = async () => {
    const communityId = joinCommunityId().trim();
    const code = joinCode().trim();
    const nickname = joinNickname().trim();
    if (!communityId || !code) {
      setJoinMessage("コミュニティIDと招待コードを入力してください。");
      return;
    }
    setJoining(true);
    setJoinMessage(null);
    try {
      await joinCommunity(communityId, {
        code,
        nickname: nickname || undefined,
      });
      setJoinMessage("コミュニティに参加しました。ページへ移動します…");
      setTimeout(() => {
        navigate(`/c/${encodeURIComponent(communityId)}`);
      }, 300);
    } catch (error: any) {
      setJoinMessage(error?.message || "コミュニティ参加に失敗しました。");
    } finally {
      setJoining(false);
    }
  };

  const openCreateCommunityModal = () => setCreateCommunityOpen(true);

  const handleCommunityCreated = (community: any) => {
    setCreateCommunityOpen(false);
    setViewMode("communities");
    setCommunityQuery("");
    setCommunityResults([]);
    setCommunityHasSearched(false);
    setMyCommunities((prev) => {
      const list = Array.isArray(prev) ? prev.slice() : [];
      const filtered = list.filter((entry: any) => entry?.id !== community.id);
      return [community, ...filtered];
    });
    void refetchMyCommunities();
  };

  const UserSearchSection = () => (
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <input
          class="flex-1 rounded-full border p-2"
          placeholder="ユーザーIDで検索"
          value={userQuery()}
          onInput={(e) => setUserQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if ((e as KeyboardEvent).key === "Enter") void handleUserSearch();
          }}
        />
        <button
          type="button"
          class="px-4 py-2 rounded-full border bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
          disabled={userSearching()}
          onClick={() => void handleUserSearch()}
        >
          {userSearching() ? "検索中..." : "検索"}
        </button>
        <button
          type="button"
          class="px-4 py-2 rounded-full border bg-gray-100 hover:bg-gray-200"
          onClick={() => openProfileModal("share")}
        >
          招待
        </button>
      </div>
      <Show when={userResults().length > 0}>
        <div class="flex flex-col gap-2 max-h-48 overflow-auto">
          <For each={userResults()}>
            {(entry: any) => (
              <a
                href={buildProfileUrlByHandle((entry as any).handle || entry.id, getUserDomain(entry))}
                class="flex items-center gap-3 rounded-xl border px-4 py-2 hover:bg-gray-50"
              >
                <Avatar
                  src={entry.avatar_url || ""}
                  alt={entry.display_name || entry.id}
                  class="w-10 h-10 rounded-full"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold truncate">
                    {entry.display_name || entry.id}
                  </div>
                  <div class="text-xs text-gray-500 truncate">
                    @{entry.id}
                  </div>
                </div>
                <span class="text-sm text-blue-600">プロフィールへ</span>
              </a>
            )}
          </For>
        </div>
      </Show>
      <Show when={userNotFound()}>
        <div class="text-xs text-gray-500">一致するユーザーIDが見つかりません</div>
      </Show>
    </div>
  );

  const headerTitle = createMemo(() => {
    switch (viewMode()) {
      case "friends":
        return "友達";
      case "communities":
        return "コミュニティ";
      default:
        return "コミュニティ";
    }
  });

  const showBack = createMemo(() => viewMode() === "friends");

  return (
    <>
      <div class="p-6 max-w-3xl mx-auto space-y-6">
        <header class="flex items-center gap-3">
          <Show when={showBack()}>
            <button
              type="button"
              class="rounded-full border px-3 py-1 text-sm hover:bg-gray-100"
              onClick={() => setViewMode("overview")}
            >
              戻る
            </button>
          </Show>
          <h1 class="text-2xl font-bold">{headerTitle()}</h1>
          <div class="ml-auto flex items-center gap-2">
            <Show when={viewMode() === "communities"}>
            <button
              type="button"
              class="rounded-full border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50"
              onClick={openCreateCommunityModal}
            >
                コミュニティを作成
              </button>
            </Show>
            <Show when={viewMode() !== "communities"}>
              <button
                type="button"
                class="inline-flex items-center justify-center p-2 rounded-full border hairline hover:bg-gray-100 text-gray-600"
                aria-label="QRコードをスキャン"
                onClick={() => openProfileModal("scan")}
              >
                <IconQr size={20} />
              </button>
            </Show>
          </div>
        </header>

        <Switch fallback={null}>
          <Match when={viewMode() === "overview"}>
            <div class="space-y-6">
              <div class="space-y-2">
                <UserSearchSection />
                <p class="text-sm text-gray-500">友達とコミュニティをまとめて管理</p>
              </div>

              <div class="space-y-4">
                <button
                  type="button"
                  class="w-full flex items-center gap-4 px-5 py-4 rounded-2xl border bg-white shadow-sm text-left transition hover:bg-gray-50"
                  onClick={() => setViewMode("friends")}
                >
                  <div class="w-14 h-14 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
                    <Show
                      when={firstFriend()}
                      fallback={<span class="text-xl text-gray-500">👤</span>}
                    >
                      {(friend) => (
                        <Avatar
                          src={(friend as any).avatar_url || ""}
                          alt={(friend as any).display_name || (friend as any).id}
                          class="w-14 h-14 rounded-full object-cover"
                        />
                      )}
                    </Show>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-base font-semibold">友達</div>
                    <div class="text-sm text-gray-500 truncate">{friendPreview()}</div>
                  </div>
                  <span class="px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-600">{friendCountLabel()}</span>
                  <span class="text-gray-400">›</span>
                </button>

                <button
                  type="button"
                  class="w-full flex items-center gap-4 px-5 py-4 rounded-2xl border bg-white shadow-sm text-left transition hover:bg-gray-50"
                  onClick={() => setViewMode("communities")}
                >
                  <div class="w-14 h-14 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center">
                    <Show
                      when={firstCommunity()}
                      fallback={<span class="text-xl text-gray-500">👥</span>}
                    >
                      {(community) => (
                        <Avatar
                          src={(community as any).icon_url || ""}
                          alt={(community as any).name}
                          class="w-14 h-14 rounded-full object-cover"
                          variant="community"
                        />
                      )}
                    </Show>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-base font-semibold">コミュニティ</div>
                    <div class="text-sm text-gray-500 truncate">{communityPreview()}</div>
                  </div>
                  <span class="px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-600">{communityCountLabel()}</span>
                  <span class="text-gray-400">›</span>
                </button>

              </div>
            </div>
          </Match>

          <Match when={viewMode() === "friends"}>
            <div class="space-y-6">
              <div class="space-y-2">
                <UserSearchSection />
                <p class="text-sm text-gray-500">友達とコミュニティをまとめて管理</p>
              </div>

              <Show when={!friendsLoading()} fallback={<div class="text-sm text-gray-500">読み込み中...</div>}>
                <section class="bg-white rounded-2xl border shadow-sm">
                  <div class="flex items-center px-6 py-4 border-b">
                    <h2 class="font-semibold">友達</h2>
                    <div class="ml-auto text-sm text-gray-500">{friendCountLabel()}</div>
                  </div>

                  <Show when={friends().length > 0} fallback={<div class="px-6 py-6 text-sm text-gray-500">まだ友達がいません</div>}>
                    <For each={friends()}>
                      {(entry) => (
                        <div class="flex items-center gap-3 px-6 py-4 border-t first:border-t-0">
                          <Avatar
                            src={entry.user.avatar_url || ""}
                            alt={entry.user.display_name || entry.user.id}
                            class="w-12 h-12 rounded-full"
                          />
                          <div class="min-w-0 flex-1">
                            <div class="font-semibold truncate">{entry.user.display_name || entry.user.id}</div>
                            <div class="text-sm text-gray-500 truncate">{entry.user.id}</div>
                          </div>
                          <span class="px-3 py-1 rounded-full text-sm bg-gray-100">{relationLabel(entry.relation)}</span>
                        </div>
                      )}
                    </For>
                  </Show>
                </section>
              </Show>
            </div>
          </Match>

          <Match when={viewMode() === "communities"}>
            <div class="space-y-6">
              <div class="space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <input
                    class="flex-1 min-w-[220px] rounded-full border p-2"
                    placeholder="コミュニティ名で検索"
                    value={communityQuery()}
                    onInput={(e) => setCommunityQuery((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if ((e as KeyboardEvent).key === "Enter") void handleCommunitySearch();
                    }}
                  />
                  <button
                    type="button"
                    class="px-4 py-2 rounded-full bg-blue-600 text-white"
                    onClick={() => void handleCommunitySearch()}
                >
                  {communitySearching() ? "検索中..." : "検索"}
                </button>
              </div>
              <p class="text-sm text-gray-500">コミュニティを検索して参加できます</p>
              <div class="grid md:grid-cols-2 gap-4">
                <div class="bg-white dark:bg-neutral-900 border hairline rounded-2xl p-4 space-y-3">
                  <div class="font-semibold">招待コードで参加</div>
                  <div class="grid gap-2">
                    <input
                      class="rounded-full border hairline px-3 py-2 bg-gray-50 dark:bg-neutral-900"
                      placeholder="コミュニティID"
                      value={joinCommunityId()}
                      onInput={(e) => setJoinCommunityId((e.target as HTMLInputElement).value)}
                    />
                    <input
                      class="rounded-full border hairline px-3 py-2 bg-gray-50 dark:bg-neutral-900"
                      placeholder="招待コード"
                      value={joinCode()}
                      onInput={(e) => setJoinCode((e.target as HTMLInputElement).value)}
                    />
                    <input
                      class="rounded-full border hairline px-3 py-2 bg-gray-50 dark:bg-neutral-900"
                      placeholder="ニックネーム (任意)"
                      value={joinNickname()}
                      onInput={(e) => setJoinNickname((e.target as HTMLInputElement).value)}
                    />
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        class="px-4 py-2 rounded-full bg-gray-900 text-white disabled:opacity-60"
                        onClick={() => void handleJoinByCode()}
                        disabled={joining()}
                      >
                        {joining() ? "参加中…" : "参加する"}
                      </button>
                      <Show when={joinMessage()}>
                        <span class="text-sm text-muted">{joinMessage()}</span>
                      </Show>
                    </div>
                  </div>
                </div>
                <div class="bg-white dark:bg-neutral-900 border hairline rounded-2xl p-4 space-y-2">
                  <div class="font-semibold">招待の管理</div>
                  <p class="text-sm text-muted">
                    受信したコミュニティ招待を確認・承認できます。
                  </p>
                  <a
                    class="inline-flex items-center gap-2 px-4 py-2 rounded-full border hairline hover:bg-gray-50 text-sm"
                    href="/invitations"
                  >
                    招待一覧を開く
                  </a>
                </div>
              </div>
              </div>

              <Show when={!communitiesLoading() || communityHasSearched()} fallback={<div class="text-sm text-gray-500">読み込み中...</div>}>
                <section class="bg-white rounded-2xl border shadow-sm">
                  <div class="flex items-center px-6 py-4 border-b">
                    <h2 class="font-semibold">コミュニティ</h2>
                    <div class="ml-auto text-sm text-gray-500">{communityCountLabel()}</div>
                  </div>

                  <Show when={communityHasSearched()}>
                    <Show
                      when={communityResults().length > 0}
                      fallback={
                        <div class="px-6 py-6 text-center text-sm text-gray-500">
                          {communitySearching() ? "検索中..." : "一致するコミュニティが見つかりません"}
                        </div>
                      }
                    >
                      <For each={communityResults()}>
                        {(community) => (
                          <a href={`/c/${(community as any).id}`} class="flex items-center gap-3 px-6 py-4 border-t first:border-t-0 hover:bg-gray-50">
                            <Avatar src={(community as any).icon_url || ""} alt={(community as any).name} class="w-13 h-13 rounded" variant="community" />
                            <div class="min-w-0 flex-1">
                              <div class="font-semibold truncate">{(community as any).name}</div>
                              <div class="text-sm text-gray-500 truncate">
                                {(community as any).member_count ? `メンバー: ${(community as any).member_count}` : ""}
                              </div>
                              <div class="text-sm text-gray-500 truncate">{(community as any).description || ""}</div>
                            </div>
                          </a>
                        )}
                      </For>
                    </Show>
                  </Show>

                  <Show when={!communityHasSearched()}>
                    <Show
                      when={(myCommunities() || []).length > 0}
                      fallback={
                        <div class="px-6 py-6 text-center text-sm text-gray-500 space-y-3">
                          <div>まだコミュニティはありません</div>
                          <button
                            type="button"
                            class="inline-flex items-center justify-center rounded-full border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50"
                            onClick={openCreateCommunityModal}
                          >
                            コミュニティを作成
                          </button>
                        </div>
                      }
                    >
                      <For each={myCommunities() || []}>
                        {(community) => (
                          <a href={`/c/${(community as any).id}`} class="flex items-center gap-3 px-6 py-4 border-t first:border-t-0 hover:bg-gray-50">
                            <Avatar src={(community as any).icon_url || ""} alt={(community as any).name} class="w-13 h-13 rounded" variant="community" />
                            <div class="min-w-0 flex-1">
                              <div class="font-semibold truncate">{(community as any).name}</div>
                              <div class="text-sm text-gray-500 truncate">
                                {(community as any).member_count ? `メンバー: ${(community as any).member_count}` : ""}
                              </div>
                              <div class="text-sm text-gray-500 truncate">{(community as any).description || ""}</div>
                            </div>
                          </a>
                        )}
                      </For>
                    </Show>
                  </Show>
                </section>
              </Show>
            </div>
          </Match>
        </Switch>
      </div>

      <CommunityCreateModal
        open={createCommunityOpen()}
        onClose={() => setCreateCommunityOpen(false)}
        onCreated={handleCommunityCreated}
      />
      <ProfileModal
        open={shareOpen()}
        onClose={closeProfileModal}
        profileUrl={shareUrl()}
        displayName={shareDisplayName()}
        handle={shareHandle()}
        avatarUrl={shareAvatar()}
        initialView={profileModalView()}
        onScanDetected={handleScanDetected}
      />
    </>
  );
}
