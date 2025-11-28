import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";

import Avatar from "../components/Avatar";
import ProfileModal from "../components/ProfileModal";
import CommunityCreateModal from "../components/CommunityCreateModal";
import { IconPlus, IconQr, IconSearch } from "../components/icons";
import {
  listMyCommunities,
  listMyFollowing,
  listMyFollowers,
  listMyFollowRequests,
  acceptFollowRequest,
  rejectFollowRequest,
  followUser,
  unfollowUser,
  useMe,
} from "../lib/api";
import { buildProfileUrlByHandle, buildActivityPubHandle, getUserDomain } from "../lib/url";

type TabMode = "follows" | "communities";

type User = {
  id: string;
  display_name?: string;
  avatar_url?: string;
};

type ConnectionEntry = { user: User; relation: string };

function relationBadge(relation: string) {
  switch (relation) {
    case "friend":
      return <span class="text-xs text-green-700 bg-green-100 dark:bg-green-900/40 px-2 py-0.5 rounded-full">友達</span>;
    case "following":
      return <span class="text-xs text-gray-700 bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">フォロー中</span>;
    case "follower":
      return <span class="text-xs text-blue-700 bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded-full">フォロワー</span>;
    case "outgoing":
      return <span class="text-xs text-gray-600 bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">フォロー申請中</span>;
    case "incoming":
      return <span class="text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">フォローリクエスト</span>;
    default:
      return null;
  }
}

export default function Connections() {
  const me = useMe();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = createSignal<TabMode>("follows");
  const [shareOpen, setShareOpen] = createSignal(false);
  const [profileModalView, setProfileModalView] = createSignal<"share" | "scan">("share");
  const [createCommunityOpen, setCreateCommunityOpen] = createSignal(false);
  const [actionUser, setActionUser] = createSignal<string | null>(null);

  // Follow data
  const [following, { refetch: refetchFollowing }] = createResource(async () => (await listMyFollowing().catch(() => [])) as any[]);
  const [followers, { refetch: refetchFollowers }] = createResource(async () => (await listMyFollowers().catch(() => [])) as any[]);
  const [incomingRequests, { refetch: refetchIncoming }] = createResource(async () => (await listMyFollowRequests("incoming").catch(() => [])) as any[]);
  const [outgoingRequests, { refetch: refetchOutgoing }] = createResource(async () => (await listMyFollowRequests("outgoing").catch(() => [])) as any[]);

  // Communities data
  const [myCommunities, { mutate: setMyCommunities, refetch: refetchMyCommunities }] = createResource(
    async () => (await listMyCommunities().catch(() => [])) as any[]
  );

  const connections = createMemo<ConnectionEntry[]>(() => {
    const map = new Map<string, ConnectionEntry>();

    (following() || []).forEach((edge: any) => {
      const user = edge.user;
      if (user?.id) {
        map.set(user.id, {
          user,
          relation: edge.is_friend ? "friend" : "following",
        });
      }
    });

    (followers() || []).forEach((edge: any) => {
      const user = edge.user;
      if (!user?.id) return;
      const existing = map.get(user.id);
      if (existing) {
        map.set(user.id, {
          user,
          relation:
            existing.relation === "friend" || edge.is_friend ? "friend" : existing.relation,
        });
      } else {
        map.set(user.id, {
          user,
          relation: edge.is_friend ? "friend" : "follower",
        });
      }
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

  const followsLoading = createMemo(
    () => following.loading || followers.loading || incomingRequests.loading || outgoingRequests.loading
  );
  const communitiesLoading = createMemo(() => myCommunities.loading);

  const incomingCount = createMemo(() => (incomingRequests() || []).length);

  // Profile sharing
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

    try {
      const url = new URL(raw);
      const match = url.pathname.match(/^\/u\/([^/?#]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    } catch {}

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

  const handleAcceptFriend = async (userId: string) => {
    setActionUser(userId);
    try {
      await acceptFollowRequest(userId);
      await Promise.all([refetchIncoming(), refetchFollowing(), refetchFollowers()]);
    } catch (error) {
      console.error("Failed to accept friend request:", error);
    } finally {
      setActionUser(null);
    }
  };

  const handleRejectFriend = async (userId: string) => {
    setActionUser(userId);
    try {
      await rejectFollowRequest(userId);
      await Promise.all([refetchIncoming(), refetchOutgoing(), refetchFollowers()]);
    } catch (error) {
      console.error("Failed to reject friend request:", error);
    } finally {
      setActionUser(null);
    }
  };

  const handleFollowBack = async (userId: string) => {
    setActionUser(userId);
    try {
      await followUser(userId);
      await Promise.all([refetchFollowing(), refetchFollowers(), refetchOutgoing(), refetchIncoming()]);
    } catch (error) {
      console.error("Failed to follow user:", error);
    } finally {
      setActionUser(null);
    }
  };

  const handleUnfollow = async (userId: string) => {
    setActionUser(userId);
    try {
      await unfollowUser(userId);
      await Promise.all([refetchFollowing(), refetchFollowers(), refetchOutgoing()]);
    } catch (error) {
      console.error("Failed to unfollow user:", error);
    } finally {
      setActionUser(null);
    }
  };

  const handleCommunityCreated = (community: any) => {
    setCreateCommunityOpen(false);
    setMyCommunities((prev) => {
      const list = Array.isArray(prev) ? prev.slice() : [];
      const filtered = list.filter((entry: any) => entry?.id !== community.id);
      return [community, ...filtered];
    });
    void refetchMyCommunities();
  };

  return (
    <>
      <div class="max-w-2xl mx-auto px-4 py-4">
        {/* Header */}
        <header class="flex items-center gap-3 mb-4">
          <h1 class="text-xl font-bold">フォロー</h1>
          <div class="flex-1" />
          
          {/* Action buttons */}
          <button
            type="button"
            class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800"
            aria-label="QRコードをスキャン"
            onClick={() => openProfileModal("scan")}
          >
            <IconQr size={20} />
          </button>
          <button
            type="button"
            class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800"
            aria-label="検索"
            onClick={() => navigate("/users")}
          >
            <IconSearch size={20} />
          </button>
          <Show when={activeTab() === "communities"}>
            <button
              type="button"
              class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800"
              aria-label="コミュニティを作成"
              onClick={() => setCreateCommunityOpen(true)}
            >
              <IconPlus size={20} />
            </button>
          </Show>
        </header>

        {/* Tab Switcher */}
        <div class="flex gap-1 p-1 bg-gray-100 dark:bg-neutral-800 rounded-full mb-4">
          <button
            type="button"
            class={`flex-1 py-2 px-4 text-sm font-medium rounded-full transition-colors ${
              activeTab() === "follows"
                ? "bg-white dark:bg-neutral-900 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
            onClick={() => setActiveTab("follows")}
          >
            フォロー
            <Show when={incomingCount() > 0}>
              <span class="ml-1 text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded-full">
                {incomingCount()}
              </span>
            </Show>
          </button>
          <button
            type="button"
            class={`flex-1 py-2 px-4 text-sm font-medium rounded-full transition-colors ${
              activeTab() === "communities"
                ? "bg-white dark:bg-neutral-900 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
            onClick={() => setActiveTab("communities")}
          >
            コミュニティ
          </button>
        </div>

        {/* Follows Tab */}
        <Show when={activeTab() === "follows"}>
          <Show when={!followsLoading()} fallback={
            <div class="text-center py-8 text-gray-500">読み込み中...</div>
          }>
            <Show when={connections().length > 0} fallback={
              <div class="text-center py-12">
                <div class="text-gray-400 text-4xl mb-3">👋</div>
                <div class="text-gray-600 dark:text-gray-400 mb-4">まだフォローがありません</div>
                <button
                  type="button"
                  class="px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                  onClick={() => openProfileModal("share")}
                >
                  プロフィールを共有
                </button>
              </div>
            }>
              <div class="space-y-1">
                <For each={connections()}>
                  {(entry) => (
                    <div class="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors">
                      <Avatar
                        src={entry.user.avatar_url || ""}
                        alt={entry.user.display_name || entry.user.id}
                        class="w-12 h-12 rounded-full shrink-0"
                      />
                      <div class="min-w-0 flex-1">
                        <a href={`/@${encodeURIComponent(entry.user.id)}`} class="block">
                          <div class="font-medium truncate">
                            {entry.user.display_name || entry.user.id}
                          </div>
                          <div class="text-sm text-gray-500 dark:text-gray-400 truncate">
                            @{entry.user.id}
                          </div>
                        </a>
                      </div>
                      <Show when={entry.relation === "incoming"}>
                        <div class="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            class="px-3 py-1.5 rounded-full bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
                            disabled={actionUser() === entry.user.id}
                            onClick={() => handleAcceptFriend(entry.user.id)}
                          >
                            {actionUser() === entry.user.id ? "処理中…" : "承認"}
                          </button>
                          <button
                            type="button"
                            class="px-3 py-1.5 rounded-full border dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-60"
                            disabled={actionUser() === entry.user.id}
                            onClick={() => handleRejectFriend(entry.user.id)}
                          >
                            拒否
                          </button>
                        </div>
                      </Show>
                      <Show when={entry.relation === "follower"}>
                        <div class="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            class="px-3 py-1.5 rounded-full bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
                            disabled={actionUser() === entry.user.id}
                            onClick={() => handleFollowBack(entry.user.id)}
                          >
                            {actionUser() === entry.user.id ? "処理中…" : "フォローする"}
                          </button>
                          {relationBadge(entry.relation)}
                        </div>
                      </Show>
                      <Show when={entry.relation === "following" || entry.relation === "friend"}>
                        <div class="flex items-center gap-2 shrink-0">
                          {relationBadge(entry.relation)}
                          <button
                            type="button"
                            class="px-3 py-1.5 rounded-full border dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-60"
                            disabled={actionUser() === entry.user.id}
                            onClick={() => handleUnfollow(entry.user.id)}
                          >
                            {actionUser() === entry.user.id ? "解除中…" : "フォロー解除"}
                          </button>
                        </div>
                      </Show>
                      <Show when={entry.relation === "outgoing"}>
                        <div class="flex items-center gap-2 shrink-0">
                          {relationBadge(entry.relation)}
                          <button
                            type="button"
                            class="px-3 py-1.5 rounded-full border dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-60"
                            disabled={actionUser() === entry.user.id}
                            onClick={() => handleUnfollow(entry.user.id)}
                          >
                            {actionUser() === entry.user.id ? "取消中…" : "取消"}
                          </button>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          {/* Quick actions for follows */}
          <div class="mt-6 pt-4 border-t dark:border-neutral-800">
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="flex items-center gap-2 px-4 py-2 rounded-full border dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                onClick={() => openProfileModal("share")}
              >
                プロフィールを共有
              </button>
              <a
                href="/follow-requests"
                class="flex items-center gap-2 px-4 py-2 rounded-full border dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
              >
                フォローリクエスト
              </a>
            </div>
          </div>
        </Show>

        {/* Communities Tab */}
        <Show when={activeTab() === "communities"}>
          <Show when={!communitiesLoading()} fallback={
            <div class="text-center py-8 text-gray-500">読み込み中...</div>
          }>
            <Show when={(myCommunities() || []).length > 0} fallback={
              <div class="text-center py-12">
                <div class="text-gray-400 text-4xl mb-3">👥</div>
                <div class="text-gray-600 dark:text-gray-400 mb-4">まだコミュニティはありません</div>
                <button
                  type="button"
                  class="px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                  onClick={() => setCreateCommunityOpen(true)}
                >
                  コミュニティを作成
                </button>
              </div>
            }>
              <div class="space-y-1">
                <For each={myCommunities() || []}>
                  {(community: any) => (
                    <a
                      href={`/c/${encodeURIComponent(community.id)}`}
                      class="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors"
                    >
                      <Avatar
                        src={community.icon_url || ""}
                        alt={community.name}
                        class="w-12 h-12 rounded-xl shrink-0"
                        variant="community"
                      />
                      <div class="min-w-0 flex-1">
                        <div class="font-medium truncate">{community.name}</div>
                        <div class="text-sm text-gray-500 dark:text-gray-400 truncate">
                          {community.member_count ? `${community.member_count}人` : ""}
                          {community.member_count && community.description ? " · " : ""}
                          {community.description || ""}
                        </div>
                      </div>
                    </a>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          {/* Quick actions for communities */}
          <div class="mt-6 pt-4 border-t dark:border-neutral-800">
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="flex items-center gap-2 px-4 py-2 rounded-full border dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                onClick={() => setCreateCommunityOpen(true)}
              >
                <IconPlus size={16} />
                コミュニティを作成
              </button>
              <a
                href="/invitations"
                class="flex items-center gap-2 px-4 py-2 rounded-full border dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
              >
                コミュニティ招待
              </a>
            </div>
          </div>
        </Show>
      </div>

      {/* Modals */}
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
