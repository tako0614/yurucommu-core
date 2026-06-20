import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { A, useSearchParams } from "@solidjs/router";
import { useAtomValue, useSetAtom } from "solid-jotai";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import { Actor, Post } from "../types/index.ts";
import {
  CommunityDetail,
  fetchCommunities,
  fetchFollowing,
  fetchTrendingHashtags,
  follow,
  joinCommunity,
  likePost,
  searchActors,
  searchPosts,
  searchRemote,
  unlikePost,
} from "../lib/api.ts";
import {
  enterCommunityScopeAtom,
  scopeCommunitiesAtom,
} from "../atoms/scope.ts";
import { pushToast, toastsAtom } from "../atoms/toast.ts";
import { useI18n } from "../lib/i18n.tsx";
import { formatRelativeTime } from "../lib/datetime.ts";
import { UserAvatar } from "../components/UserAvatar.tsx";
import { PostContent } from "../components/PostContent.tsx";
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";
import { InlineErrorRetry } from "../components/InlineErrorRetry.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { PostSkeleton } from "../components/timeline/PostSkeleton.tsx";
import { HeartIcon } from "../components/icons/SocialIcons.tsx";
import {
  AttachmentGrid,
  MediaLightbox,
  useMediaLightbox,
} from "../components/MediaLightbox.tsx";

const SearchEmptyIcon = () => (
  <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={1.5}
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
);

const REMOTE_ACTOR_QUERY_PATTERN = /^@?[^@\s]+@[^@\s]+$/;

type SearchTab = "users" | "posts" | "communities";

const CloseIcon = () => (
  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M6 18L18 6M6 6l12 12"
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

function getSingleSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function SearchPage() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const setToasts = useSetAtom(toastsAtom);
  const enterCommunityScope = useSetAtom(enterCommunityScopeAtom);
  // The owner's joined communities (single source of truth for membership).
  // Changes here (a join elsewhere in the app) mean the discover list is stale,
  // so it drives a re-fetch.
  const scopeCommunities = useAtomValue(scopeCommunitiesAtom);
  const lightbox = useMediaLightbox();
  const [error, setError] = createSignal<string | null>(null);
  const clearError = () => setError(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchTab, setSearchTab] = createSignal<SearchTab>("users");
  const [searchUsersResult, setSearchUsersResult] = createSignal<Actor[]>([]);
  const [searchPostsResult, setSearchPostsResult] = createSignal<Post[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [searched, setSearched] = createSignal(false);
  const [searchError, setSearchError] = createSignal<string | null>(null);
  const [lastQuery, setLastQuery] = createSignal("");
  // Inward-first: search stays inside the owner's own graph / in-scope data
  // (local actors, posts, joined communities) by default. Reaching out to
  // remote servers via webfinger is an explicit, secondary opt-in so a
  // personal instance does not silently fan out to the whole fediverse.
  const [includeRemote, setIncludeRemote] = createSignal(false);
  const [searchingRemote, setSearchingRemote] = createSignal(false);

  const [communities, setCommunities] = createSignal<CommunityDetail[]>([]);
  const [filteredCommunities, setFilteredCommunities] = createSignal<
    CommunityDetail[]
  >([]);
  // Communities the owner has not entered yet — the discovery surface. Pending
  // (approval-policy) requests stay visible so the state is legible.
  const discoverCommunities = createMemo(() =>
    communities().filter((c) => !c.is_member),
  );
  const [joiningApId, setJoiningApId] = createSignal<string | null>(null);

  const [following, setFollowing] = createSignal<Actor[]>([]);

  const [trendingHashtags, setTrendingHashtags] = createSignal<
    { tag: string; count: number }[]
  >([]);

  // Pull the community list that backs the discover surface. Kept in a function
  // so it can be re-run when the list goes stale (window refocus, membership
  // change) rather than only once on mount.
  const refreshDiscoverCommunities = () => {
    fetchCommunities()
      .then(setCommunities)
      .catch((e) => console.error("Failed to fetch communities", e));
  };

  onMount(() => {
    setSearchQuery("");
    setSearched(false);
    setSearchUsersResult([]);
    setSearchPostsResult([]);
    fetchTrendingHashtags(10)
      .catch(() => [])
      .then(setTrendingHashtags);
    refreshDiscoverCommunities();
    fetchFollowing(actor.ap_id)
      .then(setFollowing)
      .catch((e) => console.error("Failed to fetch following", e));

    // Re-fetch when the tab regains focus so a join/leave that happened on
    // another surface (or device) doesn't leave a stale discover list.
    const onFocus = () => refreshDiscoverCommunities();
    globalThis.addEventListener("focus", onFocus);
    onCleanup(() => globalThis.removeEventListener("focus", onFocus));
  });

  // Re-fetch the discover list whenever joined-community membership changes
  // (e.g. a join from the ScopeBar/picker), so already-joined communities drop
  // out of discover without a manual reload. Skips the initial run since
  // onMount already fetches.
  let scopeHydrated = false;
  createEffect(() => {
    scopeCommunities();
    if (!scopeHydrated) {
      scopeHydrated = true;
      return;
    }
    refreshDiscoverCommunities();
  });

  // Handle search query parameter from URL
  createEffect(() => {
    const searchParam = getSingleSearchParam(searchParams.search);
    if (searchParam) {
      setSearchQuery(searchParam);
      setSearchParams({});
      performSearch(searchParam);
    }
  });

  // Whether the current query is a webfinger-style handle (@user@host). Remote
  // lookup only makes sense for these; the toggle is hidden otherwise.
  const lastQueryIsRemoteHandle = createMemo(() =>
    REMOTE_ACTOR_QUERY_PATTERN.test(lastQuery()),
  );

  // After a search resolves, if the active tab has no hits but another does,
  // jump to the first non-empty tab (in tab order) so the owner sees results
  // instead of an empty pane next to populated ones. If the active tab already
  // has hits — or everything is empty — leave the selection alone.
  const TAB_ORDER: SearchTab[] = ["users", "posts", "communities"];
  const autoSelectNonEmptyTab = (counts: Record<SearchTab, number>) => {
    if (counts[searchTab()] > 0) return;
    const firstWithHits = TAB_ORDER.find((tab) => counts[tab] > 0);
    if (firstWithHits) {
      setSearchTab(firstWithHits);
    }
  };

  const performSearch = async (query: string, suppressAutoSelect = false) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    setSearching(true);
    setSearched(true);
    setSearchError(null);
    setLastQuery(trimmedQuery);
    try {
      // Inward-first: only the owner's own instance (local actors / posts /
      // joined communities). Remote servers are reached only when the owner
      // explicitly toggles "search other servers".
      const [usersRes, postsRes] = await Promise.all([
        searchActors(trimmedQuery),
        searchPosts(trimmedQuery),
      ]);

      setSearchUsersResult(usersRes);
      setSearchPostsResult(postsRes);

      // Client-side community filter
      const lowerQuery = trimmedQuery.toLowerCase();
      const matchedCommunities = communities().filter(
        (c) =>
          (c.display_name || c.name).toLowerCase().includes(lowerQuery) ||
          (c.summary || "").toLowerCase().includes(lowerQuery),
      );
      setFilteredCommunities(matchedCommunities);

      // If the active tab came back empty but another tab has hits, move the
      // owner to the first non-empty tab so a resolved search never lands on a
      // blank screen while results are sitting one tab over. Suppressed when the
      // caller has an explicit tab intent (e.g. tapping a trending hashtag pins
      // the posts tab) so it is never bounced off by an empty result.
      if (!suppressAutoSelect) {
        autoSelectNonEmptyTab({
          users: usersRes.length,
          posts: postsRes.length,
          communities: matchedCommunities.length,
        });
      }

      // If the owner has remote lookup enabled and the query is a handle,
      // fan out to other servers and merge the extra actors in.
      if (includeRemote() && REMOTE_ACTOR_QUERY_PATTERN.test(trimmedQuery)) {
        await runRemoteSearch(trimmedQuery);
      }
    } catch (e) {
      console.error("Search failed:", e);
      setSearchError(t("common.loadFailed"));
    } finally {
      setSearching(false);
    }
  };

  // Secondary, opt-in remote (webfinger) lookup. Merges any remote actors not
  // already present into the users result without disturbing the inward set.
  const runRemoteSearch = async (query: string) => {
    setSearchingRemote(true);
    try {
      const remoteUsersRes = await searchRemote(query);
      setSearchUsersResult((prev) => {
        const merged = [...prev];
        for (const remoteUser of remoteUsersRes) {
          if (!merged.some((u) => u.ap_id === remoteUser.ap_id)) {
            merged.push(remoteUser);
          }
        }
        return merged;
      });
    } catch (e) {
      console.error("Remote search failed:", e);
    } finally {
      setSearchingRemote(false);
    }
  };

  // Toggle remote lookup. Turning it on for an already-run handle query runs
  // the remote fan-out immediately so the result updates without re-submitting.
  const toggleIncludeRemote = () => {
    const next = !includeRemote();
    setIncludeRemote(next);
    if (next && lastQueryIsRemoteHandle() && !searchingRemote()) {
      void runRemoteSearch(lastQuery());
    }
  };

  // A handle-shaped query (@user@domain) with no local hit and remote lookup
  // still off: the owner almost certainly meant a fediverse account, so offer
  // an inline "search other servers" prompt instead of a bare no-results pane.
  const showRemoteHandlePrompt = createMemo(
    () =>
      searchTab() === "users" &&
      lastQueryIsRemoteHandle() &&
      !includeRemote() &&
      searchUsersResult().length === 0,
  );

  // Acting on the inline prompt enables remote for the intent and immediately
  // fans out, so the toggle reflects the new state and results stream in.
  const acceptRemoteHandlePrompt = () => {
    setIncludeRemote(true);
    if (lastQueryIsRemoteHandle() && !searchingRemote()) {
      void runRemoteSearch(lastQuery());
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearched(false);
    setSearchError(null);
    setSearchUsersResult([]);
    setSearchPostsResult([]);
    setFilteredCommunities([]);
    setSearchingRemote(false);
  };

  const handleLike = async (post: Post) => {
    try {
      if (post.liked) {
        await unlikePost(post.ap_id);
        setSearchPostsResult((prev) =>
          prev.map((p) =>
            p.ap_id === post.ap_id
              ? { ...p, liked: false, like_count: p.like_count - 1 }
              : p,
          ),
        );
      } else {
        await likePost(post.ap_id);
        setSearchPostsResult((prev) =>
          prev.map((p) =>
            p.ap_id === post.ap_id
              ? { ...p, liked: true, like_count: p.like_count + 1 }
              : p,
          ),
        );
      }
    } catch (e) {
      console.error("Failed to toggle like:", e);
      setError(t("common.error"));
    }
  };

  const handleFollow = async (targetActor: Actor, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const { status } = await follow(targetActor.ap_id);
      // A private/remote account's follow may land as a pending request awaiting
      // approval — don't misrepresent it as followed or drop it from results.
      if (status === "pending") {
        pushToast(setToasts, t("profile.followRequested"), { kind: "success" });
        return;
      }
      setFollowing((prev) => [...prev, targetActor]);
      setSearchUsersResult((prev) =>
        prev.filter((u) => u.ap_id !== targetActor.ap_id),
      );
    } catch (e) {
      console.error("Failed to follow:", e);
      setError(t("common.error"));
    }
  };

  const isFollowing = (actorApId: string) =>
    following().some((f) => f.ap_id === actorApId);

  const label = (community: CommunityDetail) =>
    community.display_name || community.name;

  // One-tap join from the discovery surface. An open community drops the owner
  // straight into it as the active scope (new ScopeBar pill); an approval/invite
  // community surfaces a toast and reflects the pending/invite state in the list.
  const handleJoin = async (community: CommunityDetail, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (joiningApId()) return;
    setJoiningApId(community.ap_id);
    try {
      const result = await joinCommunity(community.name);
      if (result.status === "joined") {
        setCommunities((prev) =>
          prev.map((c) =>
            c.ap_id === community.ap_id
              ? {
                  ...c,
                  is_member: true,
                  member_role: "member",
                  join_status: null,
                  member_count: c.member_count + 1,
                }
              : c,
          ),
        );
        // Refresh the scope source and stand in the community just joined.
        await enterCommunityScope(community);
        pushToast(
          setToasts,
          t("discover.joined").replace("{name}", label(community)),
          { kind: "success" },
        );
      } else if (result.status === "pending") {
        setCommunities((prev) =>
          prev.map((c) =>
            c.ap_id === community.ap_id ? { ...c, join_status: "pending" } : c,
          ),
        );
        pushToast(
          setToasts,
          t("discover.requested").replace("{name}", label(community)),
          { kind: "info" },
        );
      } else {
        // invite_required
        pushToast(
          setToasts,
          t("discover.inviteOnly").replace("{name}", label(community)),
          { kind: "info" },
        );
      }
    } catch (err) {
      console.error("Failed to join community:", err);
      pushToast(setToasts, t("discover.joinFailed"), { kind: "error" });
    } finally {
      setJoiningApId(null);
    }
  };

  const tabs = (): { key: SearchTab; label: string; count: number }[] => [
    {
      key: "users",
      label: t("nav.members"),
      count: searchUsersResult().length,
    },
    {
      key: "posts",
      label: t("profile.posts"),
      count: searchPostsResult().length,
    },
    {
      key: "communities",
      label: t("timeline.communities"),
      count: filteredCommunities().length,
    },
  ];

  return (
    <div class="flex flex-col h-full bg-neutral-900">
      <Show when={error()}>
        <InlineErrorBanner message={error()!} onClose={clearError} />
      </Show>

      {/* Header with Search */}
      <header class="sticky top-0 bg-neutral-900/80 backdrop-blur-sm z-10">
        <div class="px-4 py-3">
          <form
            class="flex items-center gap-2 bg-neutral-900 rounded-lg px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              performSearch(searchQuery());
            }}
          >
            <button
              type="submit"
              aria-label={t("common.search")}
              class="text-neutral-500 hover:text-white transition-colors"
            >
              <SearchIcon />
            </button>
            <input
              type="text"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              placeholder={t("nav.search")}
              class="flex-1 bg-transparent outline-none text-white placeholder-neutral-500 text-sm"
            />
            <Show when={searchQuery()}>
              <button
                type="button"
                onClick={clearSearch}
                aria-label={t("search.clear")}
                class="text-neutral-500 hover:text-white"
              >
                <CloseIcon />
              </button>
            </Show>
          </form>
          {/* Inward-first expectation: search starts within your own
              connections; other servers are an explicit opt-in in the people
              tab. */}
          <Show when={!searched()}>
            <p class="px-1 pt-2 text-xs text-neutral-500">
              {t("search.scopeHint")}
            </p>
          </Show>
        </div>

        {/* Search result tabs */}
        <Show when={searched()}>
          <div class="flex border-t border-neutral-900">
            <For each={tabs()}>
              {({ key, label, count }) => (
                <button
                  onClick={() => setSearchTab(key)}
                  class={`flex-1 py-3 text-center text-sm font-medium relative ${
                    searchTab() === key ? "text-white" : "text-neutral-500"
                  }`}
                >
                  {label} ({count})
                  <Show when={searchTab() === key}>
                    <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-accent rounded-full" />
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </header>

      <div class="flex-1 overflow-y-auto">
        <Show
          when={!searchError()}
          fallback={
            <InlineErrorRetry
              message={searchError()!}
              retryLabel={t("common.retry")}
              onRetry={() => performSearch(lastQuery())}
            />
          }
        >
          <Show when={!searching()} fallback={<PostSkeleton count={5} />}>
            <Show
              when={searched()}
              fallback={
                /* Default discovery surface (not searching): communities to
                   join, then trending hashtags. */
                <div>
                  {/* Communities Discover — non-member communities with one-tap
                      join. Joining an open community lands you in it as a new
                      ScopeBar pill. */}
                  <div class="px-4 pt-4 pb-2">
                    <h2 class="text-lg font-bold text-white">
                      {t("discover.title")}
                    </h2>
                    <p class="text-sm text-neutral-500 mt-0.5">
                      {t("discover.subtitle")}
                    </p>
                  </div>
                  <Show
                    when={discoverCommunities().length > 0}
                    fallback={
                      <div class="px-4 pb-4">
                        <EmptyState
                          icon={<SearchEmptyIcon />}
                          title={t("discover.empty")}
                          hint={t("discover.emptyHint")}
                        />
                      </div>
                    }
                  >
                    <For each={discoverCommunities()}>
                      {(community) => (
                        <A
                          href={`/groups/${community.name}`}
                          class="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
                        >
                          <div class="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden shrink-0">
                            <Show
                              when={community.icon_url}
                              fallback={
                                <span class="text-lg font-medium text-white">
                                  {(community.display_name || community.name)
                                    .charAt(0)
                                    .toUpperCase()}
                                </span>
                              }
                            >
                              <img
                                src={community.icon_url ?? undefined}
                                alt=""
                                class="w-full h-full object-cover"
                              />
                            </Show>
                          </div>
                          <div class="flex-1 min-w-0">
                            <div class="font-bold text-white truncate">
                              {community.display_name || community.name}
                            </div>
                            <Show when={community.summary}>
                              <div class="text-sm text-neutral-400 truncate mt-0.5">
                                {community.summary}
                              </div>
                            </Show>
                            <div class="text-xs text-neutral-500 mt-0.5">
                              {community.member_count ?? 0}{" "}
                              {t("groups.members")}
                            </div>
                          </div>
                          <Show
                            when={community.join_status === "pending"}
                            fallback={
                              <button
                                onClick={(e) => handleJoin(community, e)}
                                disabled={joiningApId() !== null}
                                class="px-4 py-1.5 bg-[var(--accent)] text-white font-medium rounded-full hover:brightness-110 transition-colors text-sm shrink-0 disabled:opacity-50"
                              >
                                {joiningApId() === community.ap_id
                                  ? t("discover.joining")
                                  : t("discover.join")}
                              </button>
                            }
                          >
                            <span class="px-4 py-1.5 border border-neutral-700 text-neutral-400 font-medium rounded-full text-sm shrink-0">
                              {t("groups.pending")}
                            </span>
                          </Show>
                        </A>
                      )}
                    </For>
                  </Show>

                  {/* Trending hashtags when not searching */}
                  <div class="px-4 py-4">
                    <h2 class="text-lg font-bold text-white mb-4">
                      {t("search.trending")}
                    </h2>
                    <Show
                      when={trendingHashtags().length > 0}
                      fallback={
                        <EmptyState
                          icon={<SearchEmptyIcon />}
                          title={t("search.empty")}
                          hint={t("search.emptyHint")}
                        />
                      }
                    >
                      <div class="space-y-3">
                        <For each={trendingHashtags()}>
                          {({ tag, count }) => (
                            <button
                              onClick={() => {
                                setSearchQuery(`#${tag}`);
                                setSearchTab("posts");
                                // Explicit posts-tab intent: keep it pinned even
                                // if the search comes back empty.
                                performSearch(`#${tag}`, true);
                              }}
                              class="block w-full text-left px-3 py-2.5 rounded-lg hover:bg-neutral-900/50 transition-colors"
                            >
                              <div class="font-medium text-white">#{tag}</div>
                              <div class="text-xs text-neutral-500 mt-0.5">
                                {count} {t("profile.posts").toLowerCase()}
                              </div>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </div>
              }
            >
              {/* Users tab */}
              <Show when={searchTab() === "users"}>
                {/* Inward-first affordance: results above are from your own
                    instance / connections. Reaching out to other servers is an
                    explicit secondary toggle, not the default. */}
                <div class="border-b border-neutral-900 px-4 py-3">
                  <button
                    type="button"
                    onClick={toggleIncludeRemote}
                    aria-pressed={includeRemote()}
                    class="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-white">
                        {t("search.searchOtherServers")}
                      </div>
                      <div class="text-xs text-neutral-500">
                        {t("search.searchOtherServersHint")}
                      </div>
                    </div>
                    <span
                      class={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                        includeRemote()
                          ? "bg-[var(--accent)]"
                          : "bg-neutral-700"
                      }`}
                    >
                      <span
                        class={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                          includeRemote() ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </span>
                  </button>
                  <Show when={includeRemote() && !lastQueryIsRemoteHandle()}>
                    <p class="mt-2 text-xs text-neutral-500">
                      {t("search.remoteFormatHint")}
                    </p>
                  </Show>
                  <Show when={searchingRemote()}>
                    <p class="mt-2 text-xs text-neutral-400">
                      {t("search.searchingRemote")}
                    </p>
                  </Show>
                </div>
                <Show
                  when={searchUsersResult().length > 0}
                  fallback={
                    <Show
                      when={showRemoteHandlePrompt()}
                      fallback={
                        <EmptyState
                          icon={<SearchEmptyIcon />}
                          title={t("search.noResults")}
                          hint={t("search.noResultsHint")}
                        />
                      }
                    >
                      {/* Handle-shaped query with no local hit: offer the
                          remote lookup inline instead of a dead-end empty pane. */}
                      <div class="px-4 py-8 text-center">
                        <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800 text-neutral-400">
                          <SearchEmptyIcon />
                        </div>
                        <p class="text-sm font-medium text-white">
                          {t("search.remoteHandlePromptTitle")}
                        </p>
                        <p class="mt-1 text-xs text-neutral-500">
                          {t("search.remoteHandlePromptHint").replace(
                            "{handle}",
                            lastQuery(),
                          )}
                        </p>
                        <button
                          type="button"
                          onClick={acceptRemoteHandlePrompt}
                          class="mt-4 inline-flex items-center rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:brightness-110"
                        >
                          {t("search.searchOtherServers")}
                        </button>
                      </div>
                    </Show>
                  }
                >
                  <For each={searchUsersResult()}>
                    {(user) => (
                      <div class="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
                        <A href={`/profile/${encodeURIComponent(user.ap_id)}`}>
                          <UserAvatar
                            avatarUrl={user.icon_url}
                            name={user.name || user.preferred_username}
                            size={48}
                          />
                        </A>
                        <div class="flex-1 min-w-0">
                          <A
                            href={`/profile/${encodeURIComponent(user.ap_id)}`}
                            class="hover:underline"
                          >
                            <div class="font-bold text-white truncate">
                              {user.name || user.preferred_username}
                            </div>
                          </A>
                          <div class="text-neutral-500 truncate">
                            @{user.username}
                          </div>
                          <Show when={user.summary}>
                            <div class="text-sm text-neutral-400 truncate mt-1">
                              {user.summary}
                            </div>
                          </Show>
                        </div>
                        <Show
                          when={
                            user.ap_id !== actor.ap_id &&
                            !isFollowing(user.ap_id)
                          }
                        >
                          <button
                            onClick={(e) => handleFollow(user, e)}
                            class="px-4 py-1.5 bg-white text-black font-medium rounded-full hover:bg-neutral-200 transition-colors text-sm shrink-0"
                          >
                            {t("profile.follow")}
                          </button>
                        </Show>
                        <Show when={isFollowing(user.ap_id)}>
                          <span class="px-4 py-1.5 border border-neutral-700 text-neutral-400 font-medium rounded-full text-sm shrink-0">
                            {t("profile.following")}
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>

              {/* Posts tab */}
              <Show when={searchTab() === "posts"}>
                <Show
                  when={searchPostsResult().length > 0}
                  fallback={
                    <EmptyState
                      icon={<SearchEmptyIcon />}
                      title={t("search.noResults")}
                      hint={t("search.noResultsHint")}
                    />
                  }
                >
                  <For each={searchPostsResult()}>
                    {(post) => (
                      <div class="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
                        <A
                          href={`/profile/${encodeURIComponent(
                            post.author.ap_id,
                          )}`}
                        >
                          <UserAvatar
                            avatarUrl={post.author.icon_url}
                            name={
                              post.author.name || post.author.preferred_username
                            }
                            size={48}
                          />
                        </A>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-baseline gap-2">
                            <A
                              href={`/profile/${encodeURIComponent(
                                post.author.ap_id,
                              )}`}
                              class="font-bold text-white truncate hover:underline"
                            >
                              {post.author.name ||
                                post.author.preferred_username}
                            </A>
                            <span class="text-neutral-500 truncate">
                              @{post.author.username}
                            </span>
                            <span class="text-neutral-500">·</span>
                            <span class="text-neutral-500 text-sm">
                              {formatRelativeTime(post.published)}
                            </span>
                          </div>
                          <A href={`/post/${encodeURIComponent(post.ap_id)}`}>
                            <PostContent
                              content={post.content}
                              summary={post.summary}
                              class="text-[15px] text-neutral-200 mt-1"
                            />
                          </A>
                          <Show
                            when={
                              post.attachments && post.attachments.length > 0
                            }
                          >
                            <AttachmentGrid
                              attachments={post.attachments}
                              onOpen={(idx, e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                lightbox.open(post.attachments, idx);
                              }}
                            />
                          </Show>
                          <div class="flex items-center gap-6 mt-3">
                            <button
                              onClick={() => handleLike(post)}
                              aria-label={
                                post.liked ? t("posts.unlike") : t("posts.like")
                              }
                              aria-pressed={post.liked}
                              class={`flex items-center gap-2 transition-colors ${
                                post.liked
                                  ? "text-pink-500"
                                  : "text-neutral-500 hover:text-pink-500"
                              }`}
                            >
                              <HeartIcon filled={post.liked || false} />
                              <Show
                                when={
                                  post.author.ap_id === actor.ap_id &&
                                  post.like_count > 0
                                }
                              >
                                <span class="text-sm">{post.like_count}</span>
                              </Show>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>

              {/* Communities tab */}
              <Show when={searchTab() === "communities"}>
                <Show
                  when={filteredCommunities().length > 0}
                  fallback={
                    <EmptyState
                      icon={<SearchEmptyIcon />}
                      title={t("search.noResults")}
                      hint={t("search.noResultsHint")}
                    />
                  }
                >
                  <For each={filteredCommunities()}>
                    {(community) => (
                      <A
                        href={`/groups/${community.name}`}
                        class="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
                      >
                        <div class="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden shrink-0">
                          <Show
                            when={community.icon_url}
                            fallback={
                              <span class="text-lg font-medium text-white">
                                {(community.display_name || community.name)
                                  .charAt(0)
                                  .toUpperCase()}
                              </span>
                            }
                          >
                            <img
                              src={community.icon_url ?? undefined}
                              alt=""
                              class="w-full h-full object-cover"
                            />
                          </Show>
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="font-bold text-white truncate">
                            {community.display_name || community.name}
                          </div>
                          <Show when={community.summary}>
                            <div class="text-sm text-neutral-400 truncate mt-0.5">
                              {community.summary}
                            </div>
                          </Show>
                          <div class="text-xs text-neutral-500 mt-0.5">
                            {community.member_count ?? 0} {t("groups.members")}
                          </div>
                        </div>
                      </A>
                    )}
                  </For>
                </Show>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
      <Show when={lightbox.isOpen()}>
        <MediaLightbox
          attachments={lightbox.attachments()}
          index={lightbox.index()}
          onClose={lightbox.close}
        />
      </Show>
    </div>
  );
}

export default SearchPage;
