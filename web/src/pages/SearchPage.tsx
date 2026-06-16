import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { A, useSearchParams } from "@solidjs/router";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import { Actor, Post } from "../types/index.ts";
import {
  CommunityDetail,
  fetchCommunities,
  fetchFollowing,
  fetchTrendingHashtags,
  follow,
  likePost,
  searchActors,
  searchPosts,
  searchRemote,
  unlikePost,
} from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { formatRelativeTime } from "../lib/datetime.ts";
import { UserAvatar } from "../components/UserAvatar.tsx";
import { PostContent } from "../components/PostContent.tsx";
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";
import { InlineErrorRetry } from "../components/InlineErrorRetry.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { PostSkeleton } from "../components/timeline/PostSkeleton.tsx";
import { HeartIcon } from "../components/icons/SocialIcons.tsx";

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

  const [communities, setCommunities] = createSignal<CommunityDetail[]>([]);
  const [filteredCommunities, setFilteredCommunities] = createSignal<
    CommunityDetail[]
  >([]);

  const [following, setFollowing] = createSignal<Actor[]>([]);

  const [trendingHashtags, setTrendingHashtags] = createSignal<
    { tag: string; count: number }[]
  >([]);

  onMount(() => {
    setSearchQuery("");
    setSearched(false);
    setSearchUsersResult([]);
    setSearchPostsResult([]);
    fetchTrendingHashtags(10)
      .catch(() => [])
      .then(setTrendingHashtags);
    fetchCommunities()
      .then(setCommunities)
      .catch((e) => console.error("Failed to fetch communities", e));
    fetchFollowing(actor.ap_id)
      .then(setFollowing)
      .catch((e) => console.error("Failed to fetch following", e));
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

  const performSearch = async (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    const shouldSearchRemote = REMOTE_ACTOR_QUERY_PATTERN.test(trimmedQuery);

    setSearching(true);
    setSearched(true);
    setSearchError(null);
    setLastQuery(trimmedQuery);
    try {
      const [usersRes, postsRes, remoteUsersRes] = await Promise.all([
        searchActors(trimmedQuery),
        searchPosts(trimmedQuery),
        shouldSearchRemote
          ? searchRemote(trimmedQuery)
          : Promise.resolve([] as Actor[]),
      ]);

      const mergedUsers = [...usersRes];
      for (const remoteUser of remoteUsersRes) {
        if (!mergedUsers.some((u) => u.ap_id === remoteUser.ap_id)) {
          mergedUsers.push(remoteUser);
        }
      }

      setSearchUsersResult(mergedUsers);
      setSearchPostsResult(postsRes);

      // Client-side community filter
      const lowerQuery = trimmedQuery.toLowerCase();
      setFilteredCommunities(
        communities().filter(
          (c) =>
            (c.display_name || c.name).toLowerCase().includes(lowerQuery) ||
            (c.summary || "").toLowerCase().includes(lowerQuery),
        ),
      );
    } catch (e) {
      console.error("Search failed:", e);
      setSearchError(t("common.loadFailed"));
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearched(false);
    setSearchError(null);
    setSearchUsersResult([]);
    setSearchPostsResult([]);
    setFilteredCommunities([]);
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
      await follow(targetActor.ap_id);
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
              aria-label="Search"
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
                aria-label="Clear search"
                class="text-neutral-500 hover:text-white"
              >
                <CloseIcon />
              </button>
            </Show>
          </form>
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
                    <div class="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />
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
                /* Trending hashtags when not searching */

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
                              performSearch(`#${tag}`);
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
              }
            >
              {/* Users tab */}
              <Show when={searchTab() === "users"}>
                <Show
                  when={searchUsersResult().length > 0}
                  fallback={
                    <EmptyState
                      icon={<SearchEmptyIcon />}
                      title={t("search.noResults")}
                      hint={t("search.noResultsHint")}
                    />
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
                          <div class="flex items-center gap-6 mt-3">
                            <button
                              onClick={() => handleLike(post)}
                              aria-label={post.liked ? "Unlike" : "Like"}
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
    </div>
  );
}

export default SearchPage;
