import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";

import Avatar from "../components/Avatar";
import ProfileModal from "../components/ProfileModal";
import CommunityCreateModal from "../components/CommunityCreateModal";
import { IconPlus, IconQr, IconSearch } from "../components/icons";
import {
  listMyCommunities,
  listMyFriends,
  listMyFriendRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  useMe,
} from "../lib/api";
import { buildProfileUrlByHandle, buildActivityPubHandle, getUserDomain } from "../lib/url";

type TabMode = "friends" | "communities";

type User = {
  id: string;
  display_name?: string;
  avatar_url?: string;
};

type FriendEntry = { user: User; relation: string };

function relationBadge(relation: string) {
  switch (relation) {
    case "friend":
      return null;
    case "outgoing":
      return <span class="text-xs text-gray-500 bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">リクエスト中</span>;
    case "incoming":
      return <span class="text-xs text-blue-600 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">リクエスト</span>;
    default:
      return null;
  }
}

export default function Connections() {
  const me = useMe();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = createSignal<TabMode>("friends");
  const [shareOpen, setShareOpen] = createSignal(false);
  const [profileModalView, setProfileModalView] = createSignal<"share" | "scan">("share");
  const [createCommunityOpen, setCreateCommunityOpen] = createSignal(false);
  const [actionUser, setActionUser] = createSignal<string | null>(null);

  // Friends data
  const [friendsList, { refetch: refetchFriends }] = createResource(async () => (await listMyFriends().catch(() => [])) as any[]);
  const [incomingRequests, { refetch: refetchIncoming }] = createResource(async () => (await listMyFriendRequests("incoming").catch(() => [])) as any[]);
  const [outgoingRequests, { refetch: refetchOutgoing }] = createResource(async () => (await listMyFriendRequests("outgoing").catch(() => [])) as any[]);

  // Communities data
  const [myCommunities, { mutate: setMyCommunities, refetch: refetchMyCommunities }] = createResource(
    async () => (await listMyCommunities().catch(() => [])) as any[]
  );

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
    () => friendsList.loading || incomingRequests.loading || outgoingRequests.loading
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
      await acceptFriendRequest(userId);
      await Promise.all([refetchIncoming(), refetchFriends()]);
    } catch (error) {
      console.error("Failed to accept friend request:", error);
    } finally {
      setActionUser(null);
    }
  };

  const handleRejectFriend = async (userId: string) => {
    setActionUser(userId);
    try {
      await rejectFriendRequest(userId);
      await Promise.all([refetchIncoming(), refetchOutgoing()]);
    } catch (error) {
      console.error("Failed to reject friend request:", error);
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
          <h1 class="text-xl font-bold">友達</h1>
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
              activeTab() === "friends"
                ? "bg-white dark:bg-neutral-900 shadow-sm"
                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            }`}
            onClick={() => setActiveTab("friends")}
          >
            友達
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

        {/* Friends Tab */}
        <Show when={activeTab() === "friends"}>
          <Show when={!friendsLoading()} fallback={
            <div class="text-center py-8 text-gray-500">読み込み中...</div>
          }>
            <Show when={friends().length > 0} fallback={
              <div class="text-center py-12">
                <div class="text-gray-400 text-4xl mb-3">👋</div>
                <div class="text-gray-600 dark:text-gray-400 mb-4">まだ友達がいません</div>
                <button
                  type="button"
                  class="px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                  onClick={() => openProfileModal("share")}
                >
                  友達を招待
                </button>
              </div>
            }>
              <div class="space-y-1">
                <For each={friends()}>
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
                      <Show when={entry.relation !== "incoming"}>
                        {relationBadge(entry.relation)}
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          {/* Quick actions for friends */}
          <div class="mt-6 pt-4 border-t dark:border-neutral-800">
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="flex items-center gap-2 px-4 py-2 rounded-full border dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                onClick={() => openProfileModal("share")}
              >
                友達を招待
              </button>
              <a
                href="/friend-requests"
                class="flex items-center gap-2 px-4 py-2 rounded-full border dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
              >
                フレンドリクエスト
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
