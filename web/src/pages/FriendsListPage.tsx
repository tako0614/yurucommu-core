import { For, onMount, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { atom } from "jotai";
import { useAtom } from "solid-jotai";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import { Actor } from "../types/index.ts";
import { fetchFollowers, fetchFollowing } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { UserAvatar } from "../components/UserAvatar.tsx";
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";

const BackIcon = () => (
  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M10 19l-7-7m0 0l7-7m-7 7h18"
    />
  </svg>
);

const MessageIcon = () => (
  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
    />
  </svg>
);

const SearchIcon = () => (
  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
);

type TabType = "following" | "followers";

// Atoms defined at module level
const friends_errorAtom = atom<string | null>(null);
const friends_activeTabAtom = atom<TabType>("following");
const friends_followingAtom = atom<Actor[]>([]);
const friends_followersAtom = atom<Actor[]>([]);
const friends_loadingAtom = atom(true);
const friends_searchQueryAtom = atom("");

export function FriendsListPage() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const [error, setError] = useAtom(friends_errorAtom);
  const clearError = () => setError(null);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useAtom(friends_activeTabAtom);
  const [following, setFollowing] = useAtom(friends_followingAtom);
  const [followers, setFollowers] = useAtom(friends_followersAtom);
  const [loading, setLoading] = useAtom(friends_loadingAtom);
  const [searchQuery, setSearchQuery] = useAtom(friends_searchQueryAtom);

  onMount(() => {
    setSearchQuery("");
    loadFriends();
  });

  const loadFriends = async () => {
    // Only show loading if no cached data
    if (following().length === 0 && followers().length === 0) setLoading(true);
    try {
      const [followingData, followersData] = await Promise.all([
        fetchFollowing(actor.ap_id),
        fetchFollowers(actor.ap_id),
      ]);
      setFollowing(followingData);
      setFollowers(followersData);
    } catch (e) {
      console.error("Failed to load friends:", e);
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const handleStartDM = (friendApId: string) => {
    navigate(`/dm/${encodeURIComponent(friendApId)}`);
  };

  const currentList = () =>
    activeTab() === "following" ? following() : followers();
  const filteredList = () => {
    const query = searchQuery();
    const list = currentList();
    return query
      ? list.filter(
          (f) =>
            f.name?.toLowerCase().includes(query.toLowerCase()) ||
            f.preferred_username.toLowerCase().includes(query.toLowerCase()) ||
            f.username.toLowerCase().includes(query.toLowerCase()),
        )
      : list;
  };

  return (
    <div class="flex flex-col h-full">
      <Show when={error()}>
        <InlineErrorBanner message={error()!} onClose={clearError} />
      </Show>
      {/* Header */}
      <header class="sticky top-0 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div class="flex items-center gap-4 px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            aria-label="Back"
            class="p-2 -ml-2 hover:bg-neutral-900 rounded-full"
          >
            <BackIcon />
          </button>
          <h1 class="text-xl font-bold">{t("nav.friends") || "Friends"}</h1>
        </div>

        {/* Tabs */}
        <div class="flex border-b border-neutral-900">
          <button
            onClick={() => setActiveTab("following")}
            class={`flex-1 py-3 text-center font-medium relative transition-colors ${
              activeTab() === "following"
                ? "text-white"
                : "text-neutral-500 hover:bg-neutral-900/50"
            }`}
          >
            {t("profile.following")} ({following().length})
            <Show when={activeTab() === "following"}>
              <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
            </Show>
          </button>
          <button
            onClick={() => setActiveTab("followers")}
            class={`flex-1 py-3 text-center font-medium relative transition-colors ${
              activeTab() === "followers"
                ? "text-white"
                : "text-neutral-500 hover:bg-neutral-900/50"
            }`}
          >
            {t("profile.followers")} ({followers().length})
            <Show when={activeTab() === "followers"}>
              <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-blue-500 rounded-full" />
            </Show>
          </button>
        </div>
      </header>

      {/* Search */}
      <div class="px-4 py-3 border-b border-neutral-900">
        <div class="flex items-center gap-2 bg-neutral-900 rounded-full px-4 py-2">
          <SearchIcon />
          <input
            type="text"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Search friends..."
            class="flex-1 bg-transparent text-white placeholder-neutral-500 outline-none"
          />
        </div>
      </div>

      {/* List */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={!loading()}
          fallback={
            <div class="p-8 text-center text-neutral-500">
              {t("common.loading")}
            </div>
          }
        >
          <Show
            when={filteredList().length > 0}
            fallback={
              <div class="p-8 text-center text-neutral-500">
                {searchQuery()
                  ? "No results found"
                  : activeTab() === "following"
                    ? "Not following anyone yet"
                    : "No followers yet"}
              </div>
            }
          >
            <For each={filteredList()}>
              {(friend) => (
                <div class="flex items-center gap-3 px-4 py-3 hover:bg-neutral-900/30 transition-colors">
                  <A href={`/profile/${encodeURIComponent(friend.ap_id)}`}>
                    <UserAvatar
                      avatarUrl={friend.icon_url}
                      name={friend.name || friend.preferred_username}
                      size={48}
                    />
                  </A>
                  <A
                    href={`/profile/${encodeURIComponent(friend.ap_id)}`}
                    class="flex-1 min-w-0"
                  >
                    <div class="font-bold text-white truncate">
                      {friend.name || friend.preferred_username}
                    </div>
                    <div class="text-neutral-500 truncate">
                      @{friend.username}
                    </div>
                  </A>
                  <button
                    onClick={() => handleStartDM(friend.ap_id)}
                    class="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-full transition-colors"
                    title="Send message"
                  >
                    <MessageIcon />
                  </button>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
}

export default FriendsListPage;
