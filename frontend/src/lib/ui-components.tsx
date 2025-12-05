/**
 * Custom UI Components Registration
 *
 * Registers application-specific components for UiNode rendering
 * (PLAN.md 7: UI ランタイム完全移行)
 */

import type { Component, JSX } from "solid-js";
import { For, Show, Suspense, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { registerUiComponent, type UiRuntimeContext } from "./ui-runtime";

// Import existing components
import PostCard from "../components/PostCard";
import AllStoriesBar from "../components/AllStoriesBar";
import Avatar from "../components/Avatar";
import ProfileModal from "../components/ProfileModal";
import { api, getUser, markNotificationRead, uploadMedia, followUser, unfollowUser, useMe } from "./api";

// Shared helpers
const toArray = (result: unknown): any[] => {
  if (Array.isArray(result)) return result;
  if (Array.isArray((result as any)?.data)) return (result as any).data;
  if (Array.isArray((result as any)?.items)) return (result as any).items;
  return [];
};

const toDateKey = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(value as any);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
};

const formatDateLabel = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(value as any);
  if (Number.isNaN(date.getTime())) return "不明な日付";
  return date.toLocaleDateString();
};

const formatDateTime = (value: unknown): string => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value as any);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return date.toLocaleString();
};

const parseSort = (value?: string) => {
  if (!value) return null;
  const [fieldRaw, dirRaw] = value.split(":");
  const field = fieldRaw?.trim() || "created_at";
  const direction = dirRaw?.trim().toLowerCase() === "asc" ? "asc" : "desc";
  return { field, direction } as const;
};

const userCache = new Map<string, any>();
const fetchUser = async (id?: string | null) => {
  if (!id) return null;
  if (userCache.has(id)) return userCache.get(id);
  const user = await getUser(id).catch(() => null);
  if (user) {
    userCache.set(id, user);
  }
  return user;
};

/**
 * PostFeed - Displays a list of posts
 *
 * Accepts manifest-driven fetch parameters to keep data sourcing declarative.
 */
const PostFeed: Component<{
  source?: string;
  communityId?: string;
  endpoint?: string;
  filter?: Record<string, unknown>;
  sort?: string;
  limit?: number;
  emptyText?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const resolveEndpoint = () => {
    const explicit = (props.endpoint || "").trim();
    if (explicit) return explicit;

    const source = props.source;
    const communityId =
      props.communityId || props.context?.routeParams?.id;

    if (source === "community" && communityId) {
      return `/communities/${communityId}/posts`;
    }
    if (source === "user" && props.context?.routeParams?.userId) {
      return `/users/${props.context.routeParams.userId}/posts`;
    }
    return "/posts";
  };

  const appendParam = (
    search: URLSearchParams,
    key: string,
    value: unknown
  ) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v) => appendParam(search, `${key}[]`, v));
      return;
    }
    if (typeof value === "object") {
      try {
        search.set(key, JSON.stringify(value));
        return;
      } catch {
        // fall through
      }
    }
    search.set(key, String(value));
  };

  const buildQueryString = (
    filter?: Record<string, unknown>,
    sort?: string,
    limit?: number
  ) => {
    const search = new URLSearchParams();
    if (filter && typeof filter === "object") {
      Object.entries(filter).forEach(([key, value]) =>
        appendParam(search, key, value)
      );
    }
    if (sort) {
      search.set("sort", sort);
    }
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      search.set("limit", String(limit));
    }
    const query = search.toString();
    return query ? `?${query}` : "";
  };

  const buildRequestUrl = (
    base: string,
    filter?: Record<string, unknown>,
    sort?: string,
    limit?: number
  ) => {
    const query = buildQueryString(filter, sort, limit);
    if (!query) return base;
    if (base.includes("?")) {
      const separator = base.endsWith("&") || base.endsWith("?") ? "" : "&";
      return `${base}${separator}${query.replace(/^\?/, "")}`;
    }
    return `${base}${query}`;
  };

  const normalizePosts = (result: unknown) => {
    if (Array.isArray(result)) return result;
    const payload =
      (result as any)?.data !== undefined ? (result as any).data : result;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.posts)) return payload.posts;
    if (Array.isArray(payload?.orderedItems)) return payload.orderedItems;
    if (Array.isArray(payload)) return payload;
    return [];
  };

  const applyLocalFilter = (
    items: any[],
    filter?: Record<string, unknown>
  ) => {
    if (!filter || typeof filter !== "object") return items;
    const entries = Object.entries(filter).filter(
      ([, value]) => value !== undefined && value !== null
    );
    if (entries.length === 0) return items;

    return items.filter((item) =>
      entries.every(([key, value]) => {
        const target = (item as any)?.[key];
        if (Array.isArray(value)) {
          return value.includes(target);
        }
        if (typeof value === "object") {
          return JSON.stringify(target) === JSON.stringify(value);
        }
        return target === value;
      })
    );
  };

  const applyLocalSort = (items: any[], sort?: string) => {
    if (!sort) return items;
    const [field, dir] = sort.split(":");
    if (!field) return items;
    const direction = dir === "desc" ? -1 : 1;
    const toComparable = (value: unknown) => {
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const timestamp = Date.parse(value);
        if (!Number.isNaN(timestamp)) return timestamp;
      }
      return value;
    };
    return [...items].sort((a, b) => {
      const av = toComparable((a as any)?.[field]);
      const bv = toComparable((b as any)?.[field]);
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * direction;
      }
      return String(av).localeCompare(String(bv)) * direction;
    });
  };

  const applyLimit = (items: any[], limit?: number) => {
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
      return items;
    }
    return items.slice(0, limit);
  };

  const [posts] = createResource(
    () => ({
      endpoint: resolveEndpoint(),
      filter: props.filter,
      sort: props.sort,
      limit: props.limit,
    }),
    async ({ endpoint, filter, sort, limit }) => {
      try {
        const url = buildRequestUrl(endpoint, filter, sort, limit);
        const result = await api(url);
        const normalized = normalizePosts(result);
        const filtered = applyLocalFilter(normalized, filter);
        const sorted = applyLocalSort(filtered, sort);
        return applyLimit(sorted, limit);
      } catch (err) {
        console.error("[PostFeed] Failed to load posts:", err);
        return [];
      }
    }
  );

  const handleUpdated = (updatedPost: any) => {
    // PostCard handles its own state updates
    console.log("[PostFeed] Post updated:", updatedPost.id);
  };

  const handleDeleted = (postId: string) => {
    // PostCard handles its own state updates
    console.log("[PostFeed] Post deleted:", postId);
  };

  return (
    <Suspense fallback={<div class="text-center py-8 text-muted">Loading...</div>}>
      <Show
        when={posts() && posts()!.length > 0}
        fallback={
          <div class="text-center py-8 text-muted">
            {props.emptyText || "No posts yet"}
          </div>
        }
      >
        <div class="grid gap-2">
          <For each={posts()}>
            {(post) => (
              <PostCard
                post={post}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            )}
          </For>
        </div>
      </Show>
    </Suspense>
  );
};

/**
 * StoriesBar - Displays story avatars
 */
const StoriesBar: Component<{
  communityId?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const communityId = () =>
    props.communityId || props.context?.routeParams?.id;

  return <AllStoriesBar preferredCommunityId={communityId()} />;
};

/**
 * UserAvatar - User avatar display
 */
const UserAvatar: Component<{
  src?: string;
  size?: "sm" | "md" | "lg";
  alt?: string;
}> = (props) => {
  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
  };
  const sizeClass = sizeClasses[props.size || "md"];

  return (
    <Avatar
      src={props.src || ""}
      alt={props.alt || "User"}
      class={`${sizeClass} rounded-full bg-gray-200 dark:bg-neutral-700`}
    />
  );
};

/**
 * ThreadList - DM thread list
 */
const ThreadList: Component<{
  emptyText?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const [threads] = createResource(async () => {
    try {
      return await api("/dm/threads");
    } catch (err) {
      console.error("[ThreadList] Failed to load threads:", err);
      return [];
    }
  });

  return (
    <Suspense fallback={<div class="text-center py-8 text-muted">Loading...</div>}>
      <Show
        when={threads() && threads()!.length > 0}
        fallback={
          <div class="text-center py-8 text-muted">
            {props.emptyText || "No messages yet"}
          </div>
        }
      >
        <div class="divide-y divide-gray-200 dark:divide-neutral-700">
          <For each={threads()}>
            {(thread: any) => (
              <a
                href={`/dm/${thread.id}`}
                class="block p-4 hover:bg-gray-50 dark:hover:bg-neutral-800"
              >
                <div class="flex items-center gap-3">
                  <UserAvatar src={thread.participant?.avatar_url} size="md" />
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold text-gray-900 dark:text-white truncate">
                      {thread.participant?.display_name || thread.participant?.handle || "Unknown"}
                    </div>
                    <div class="text-sm text-gray-500 truncate">
                      {thread.last_message?.text || ""}
                    </div>
                  </div>
                </div>
              </a>
            )}
          </For>
        </div>
      </Show>
    </Suspense>
  );
};

/**
 * CommunityList - Community list display
 */
const CommunityList: Component<{
  showJoined?: boolean;
  emptyText?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const endpoint = () => (props.showJoined ? "/me/communities" : "/communities");

  const [communities] = createResource(endpoint, async (path) => {
    try {
      return await api(path);
    } catch (err) {
      console.error("[CommunityList] Failed to load communities:", err);
      return [];
    }
  });

  return (
    <Suspense fallback={<div class="text-center py-8 text-muted">Loading...</div>}>
      <Show
        when={communities() && communities()!.length > 0}
        fallback={
          <div class="text-center py-8 text-muted">
            {props.emptyText || "No communities found"}
          </div>
        }
      >
        <div class="grid gap-4">
          <For each={communities()}>
            {(community: any) => (
              <a
                href={`/communities/${community.id}`}
                class="block p-4 bg-white dark:bg-neutral-800 rounded-lg border border-gray-200 dark:border-neutral-700 hover:border-blue-500"
              >
                <div class="flex items-center gap-3">
                  <Show when={community.icon_url}>
                    <img
                      src={community.icon_url}
                      alt=""
                      class="w-12 h-12 rounded-lg object-cover"
                    />
                  </Show>
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold text-gray-900 dark:text-white">
                      {community.name}
                    </div>
                    <Show when={community.description}>
                      <div class="text-sm text-gray-500 line-clamp-2">
                        {community.description}
                      </div>
                    </Show>
                  </div>
                </div>
              </a>
            )}
          </For>
        </div>
      </Show>
    </Suspense>
  );
};

/**
 * NotificationList - Notifications with date grouping and unread filter
 */
const NotificationList: Component<{
  id?: string;
  endpoint?: string;
  emptyText?: string;
  limit?: number;
  groupByDate?: boolean;
  unreadOnly?: boolean;
  context?: UiRuntimeContext;
}> = (props) => {
  const resolvedEndpoint = () => (props.endpoint?.trim() || "/notifications");

  const [notifications, { refetch }] = createResource(
    () => ({ endpoint: resolvedEndpoint(), unreadOnly: props.unreadOnly, limit: props.limit }),
    async ({ endpoint }) => {
      if (!endpoint) return [];
      try {
        const result = await api(endpoint);
        return toArray(result);
      } catch (err) {
        console.error("[NotificationList] Failed to load notifications:", err);
        throw err;
      }
    }
  );

  createEffect(() => {
    if (!props.id || !props.context?.registerRefetch) return;
    const unregister = props.context.registerRefetch(props.id, () => refetch());
    onCleanup(unregister);
  });

  const filteredItems = createMemo(() => {
    const items = toArray(notifications() || []);
    const filtered = props.unreadOnly ? items.filter((item: any) => !item?.read) : items;
    if (typeof props.limit === "number" && Number.isFinite(props.limit) && props.limit > 0) {
      return filtered.slice(0, props.limit);
    }
    return filtered;
  });

  const groupedItems = createMemo(() => {
    const shouldGroup = props.groupByDate !== false;
    if (!shouldGroup) return [];
    const groups = new Map<string, any[]>();
    for (const item of filteredItems()) {
      const key = toDateKey((item as any)?.created_at);
      const current = groups.get(key) || [];
      current.push(item);
      groups.set(key, current);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({
      key,
      label: formatDateLabel(key),
      items,
    }));
  });

  const markRead = async (item: any) => {
    if (!item?.id || item.read) return;
    try {
      await markNotificationRead(item.id);
      await refetch();
    } catch (err) {
      console.error("[NotificationList] Failed to mark as read:", err);
    }
  };

  const renderNotification = (item: any) => {
    const title = item?.message || item?.type || "通知";
    const timestamp = formatDateTime(item?.created_at);
    const link = item?.ref_type === "post" && item?.ref_id ? `/posts/${item.ref_id}` : null;

    return (
      <div class="flex gap-3 px-3 py-3 hover:bg-gray-50 dark:hover:bg-neutral-800">
        <div class="mt-1">
          <span class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
            🔔
          </span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold text-gray-900 dark:text-white">{title}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">{timestamp}</div>
          <Show when={link}>
            <a href={link as string} class="text-xs text-blue-600 hover:underline dark:text-blue-400">
              詳細を見る
            </a>
          </Show>
        </div>
        <div class="flex flex-col items-end gap-2">
          <Show when={!item?.read}>
            <span class="h-2 w-2 rounded-full bg-blue-500" aria-label="未読" />
          </Show>
          <Show when={!item?.read}>
            <button
              type="button"
              class="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              onClick={() => markRead(item)}
            >
              既読にする
            </button>
          </Show>
        </div>
      </div>
    );
  };

  const errorMessage = () => {
    const err = notifications.error;
    if (!err) return null;
    return (err as any).message || String(err);
  };

  return (
    <Suspense fallback={<div class="text-center py-6 text-muted">読み込み中…</div>}>
      <Show when={!notifications.error} fallback={<div class="p-3 text-sm text-red-500">{errorMessage()}</div>}>
        <Show
          when={filteredItems().length > 0}
          fallback={<div class="text-center py-6 text-muted">{props.emptyText || "通知はありません"}</div>}
        >
          {props.groupByDate !== false ? (
            <div class="space-y-4">
              <For each={groupedItems()}>
                {(group) => (
                  <div class="space-y-2">
                    <div class="text-xs font-semibold text-gray-500 dark:text-gray-400">{group.label}</div>
                    <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-800 divide-y divide-gray-200 dark:divide-neutral-800">
                      <For each={group.items}>{(item) => renderNotification(item)}</For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          ) : (
            <div class="overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-800 divide-y divide-gray-200 dark:divide-neutral-800">
              <For each={filteredItems()}>{(item) => renderNotification(item)}</For>
            </div>
          )}
        </Show>
      </Show>
    </Suspense>
  );
};

/**
 * PostComposer - Lightweight post creation form
 */
const PostComposer: Component<{
  endpoint?: string;
  defaultVisibility?: "public" | "followers" | "private";
  maxLength?: number;
  onPosted?: (payload?: any) => void;
  context?: UiRuntimeContext;
}> = (props) => {
  const [text, setText] = createSignal("");
  const [files, setFiles] = createSignal<File[]>([]);
  const [visibility, setVisibility] = createSignal<"public" | "followers" | "private">(props.defaultVisibility || "public");
  const [posting, setPosting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const resolvedEndpoint = () => props.endpoint?.trim() || "/posts";
  const maxLength = createMemo(() => {
    const value = props.maxLength;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    return 500;
  });

  const remaining = createMemo(() => maxLength() - text().length);
  const isOverLimit = createMemo(() => remaining() < 0);
  const isDisabled = createMemo(() => posting() || isOverLimit() || (!text().trim() && files().length === 0));

  const handleFiles = (list: FileList | null) => {
    const next = list ? Array.from(list) : [];
    if (!next.length) return;
    setFiles((prev) => [...prev, ...next]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (ev: Event) => {
    ev.preventDefault();
    const content = text().trim();
    if (!content && files().length === 0) {
      setError("投稿内容を入力してください");
      return;
    }
    const endpoint = resolvedEndpoint();
    if (!endpoint) {
      setError("投稿先が指定されていません");
      return;
    }

    setPosting(true);
    setError(null);
    try {
      const mediaUrls: string[] = [];
      for (const file of files()) {
        const url = await uploadMedia(file);
        mediaUrls.push(url);
      }

      const payload: Record<string, any> = {
        text: content,
        type: mediaUrls.length > 0 ? "image" : "text",
        visibility: visibility(),
        audience: "all",
        visible_to_friends: visibility() !== "private",
      };

      if (mediaUrls.length > 0) {
        payload.media = mediaUrls.map((url) => ({ url }));
      }

      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setText("");
      setFiles([]);

      if (typeof props.onPosted === "function") {
        await props.onPosted(result);
      } else if (props.context?.refresh) {
        props.context.refresh();
      }
    } catch (err: any) {
      setError(err?.message || "投稿に失敗しました");
    } finally {
      setPosting(false);
    }
  };

  return (
    <form class="grid gap-3 rounded-lg border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4" onSubmit={handleSubmit}>
      <textarea
        class="w-full min-h-[120px] resize-none rounded-md border border-gray-200 dark:border-neutral-800 bg-transparent p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-500 focus:outline-none"
        placeholder="いま何を考えていますか？"
        value={text()}
        maxLength={maxLength()}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />

      <Show when={files().length > 0}>
        <div class="flex flex-wrap gap-2">
          <For each={files()}>
            {(file, index) => (
              <div class="flex items-center gap-2 rounded-full bg-gray-100 dark:bg-neutral-800 px-3 py-1 text-xs text-gray-800 dark:text-gray-100">
                <span class="max-w-[180px] truncate" title={file.name}>{file.name}</span>
                <button
                  type="button"
                  class="text-gray-500 hover:text-red-500"
                  onClick={() => removeFile(index())}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={error()}>
        <div class="text-sm text-red-500">{error()}</div>
      </Show>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <label class="inline-flex cursor-pointer items-center gap-2 rounded-full bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 dark:bg-neutral-800 dark:text-gray-100 dark:hover:bg-neutral-700">
            画像を追加
            <input type="file" accept="image/*" multiple class="hidden" onChange={(e) => handleFiles((e.target as HTMLInputElement).files)} />
          </label>

          <select
            class="rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-100"
            value={visibility()}
            onChange={(e) => setVisibility((e.target as HTMLSelectElement).value as any)}
          >
            <option value="public">公開</option>
            <option value="followers">フォロワー</option>
            <option value="private">非公開</option>
          </select>
        </div>

        <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span class={isOverLimit() ? "text-red-500" : ""}>{remaining()} 文字</span>
          <button
            type="submit"
            class="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            disabled={isDisabled()}
          >
            {posting() ? "投稿中…" : "投稿"}
          </button>
        </div>
      </div>
    </form>
  );
};

/**
 * Comment item for CommentList
 */
const CommentItem: Component<{ comment: any }> = (props) => {
  const [author] = createResource(() => props.comment?.author_id, fetchUser);
  const displayName = createMemo(
    () => author()?.display_name || author()?.handle || props.comment?.author_id || "ユーザー",
  );
  const avatarUrl = createMemo(() => author()?.avatar_url || "");
  const createdAt = createMemo(() => formatDateTime(props.comment?.created_at));

  return (
    <div class="flex gap-3">
      <Avatar
        src={avatarUrl()}
        alt={displayName()}
        class="w-10 h-10 rounded-full bg-gray-200 dark:bg-neutral-700"
      />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-gray-900 dark:text-white">{displayName()}</span>
          <span class="text-xs text-gray-500 dark:text-gray-400">{createdAt()}</span>
        </div>
        <div class="mt-1 text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap leading-relaxed">
          {props.comment?.text || ""}
        </div>
        <div class="mt-2 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <button type="button" class="hover:text-blue-600 dark:hover:text-blue-400">返信</button>
          <button type="button" class="hover:text-blue-600 dark:hover:text-blue-400">いいね</button>
        </div>
      </div>
    </div>
  );
};

/**
 * CommentList - Comments for a post
 */
const CommentList: Component<{
  id?: string;
  endpoint?: string;
  emptyText?: string;
  sort?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const resolvedEndpoint = () => {
    if (props.endpoint && props.endpoint.trim()) return props.endpoint.trim();
    const postId = props.context?.routeParams?.id;
    return postId ? `/posts/${postId}/comments` : "";
  };

  const [comments, { refetch }] = createResource(
    () => ({ path: resolvedEndpoint(), sort: props.sort }),
    async ({ path }) => {
      if (!path) return [];
      try {
        const result = await api(path);
        return toArray(result);
      } catch (err) {
        console.error("[CommentList] Failed to load comments:", err);
        throw err;
      }
    }
  );

  createEffect(() => {
    if (!props.id || !props.context?.registerRefetch) return;
    const unregister = props.context.registerRefetch(props.id, () => refetch());
    onCleanup(unregister);
  });

  const sortedComments = createMemo(() => {
    const items = toArray(comments() || []);
    const sort = parseSort(props.sort);
    if (!sort) return items;
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      const av = (a as any)?.[sort.field];
      const bv = (b as any)?.[sort.field];
      const ad = new Date(av as any).getTime();
      const bd = new Date(bv as any).getTime();
      if (!Number.isNaN(ad) && !Number.isNaN(bd) && ad !== bd) {
        return (ad - bd) * direction;
      }
      return String(av ?? "").localeCompare(String(bv ?? "")) * direction;
    });
  });

  const errorMessage = () => {
    const err = comments.error;
    if (!err) return null;
    return (err as any).message || String(err);
  };

  return (
    <Suspense fallback={<div class="text-center py-6 text-muted">読み込み中…</div>}>
      <Show when={!comments.error} fallback={<div class="p-3 text-sm text-red-500">{errorMessage()}</div>}>
        <Show
          when={sortedComments().length > 0}
          fallback={<div class="text-center py-6 text-muted">{props.emptyText || "コメントはまだありません"}</div>}
        >
          <div class="space-y-4">
            <For each={sortedComments()}>{(comment: any) => <CommentItem comment={comment} />}</For>
          </div>
        </Show>
      </Show>
    </Suspense>
  );
};

/**
 * CommentForm - Create a new comment
 */
const CommentForm: Component<{
  endpoint?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onPosted?: (payload?: any) => void;
  context?: UiRuntimeContext;
}> = (props) => {
  const [text, setText] = createSignal("");
  const [posting, setPosting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const resolvedEndpoint = () => {
    if (props.endpoint && props.endpoint.trim()) return props.endpoint.trim();
    const postId = props.context?.routeParams?.id;
    return postId ? `/posts/${postId}/comments` : "";
  };

  const submit = async (ev: Event) => {
    ev.preventDefault();
    const content = text().trim();
    if (!content) {
      setError("コメントを入力してください");
      return;
    }
    const endpoint = resolvedEndpoint();
    if (!endpoint) {
      setError("投稿先が設定されていません");
      return;
    }

    setPosting(true);
    setError(null);
    try {
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({ text: content }),
      });
      setText("");
      if (typeof props.onPosted === "function") {
        await props.onPosted(result);
      } else if (props.context?.refresh) {
        props.context.refresh();
      }
    } catch (err: any) {
      setError(err?.message || "コメントを投稿できませんでした");
    } finally {
      setPosting(false);
    }
  };

  return (
    <form class="grid gap-2" onSubmit={submit}>
      <textarea
        class="w-full min-h-[80px] resize-none rounded-md border border-gray-200 dark:border-neutral-800 bg-transparent p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-500 focus:outline-none"
        placeholder={props.placeholder || "コメントを書く…"}
        value={text()}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        autofocus={props.autoFocus}
      />
      <Show when={error()}>
        <div class="text-sm text-red-500">{error()}</div>
      </Show>
      <div class="flex items-center justify-between gap-3">
        <div class="text-xs text-gray-500 dark:text-gray-400">{text().length} 文字</div>
        <button
          type="submit"
          class="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
          disabled={posting() || !text().trim()}
        >
          {posting() ? "送信中…" : "送信"}
        </button>
      </div>
    </form>
  );
};

/**
 * FriendList - Display friends list
 */
const FriendList: Component<{
  id?: string;
  endpoint?: string;
  emptyText?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const resolvedEndpoint = () => props.endpoint?.trim() || "/me/friends";

  const [friends, { refetch }] = createResource(
    resolvedEndpoint,
    async (path) => {
      try {
        const result = await api(path);
        return toArray(result);
      } catch (err) {
        console.error("[FriendList] Failed to load friends:", err);
        return [];
      }
    }
  );

  createEffect(() => {
    if (!props.id || !props.context?.registerRefetch) return;
    const unregister = props.context.registerRefetch(props.id, () => refetch());
    onCleanup(unregister);
  });

  return (
    <Suspense fallback={<div class="text-center py-6 text-muted">読み込み中…</div>}>
      <Show
        when={friends() && friends()!.length > 0}
        fallback={
          <div class="text-center py-6 text-muted">
            {props.emptyText || "まだ友達がいません"}
          </div>
        }
      >
        <div class="divide-y divide-gray-200 dark:divide-neutral-700">
          <For each={friends()}>
            {(friend: any) => {
              const user = friend.user || friend;
              return (
                <a
                  href={`/@${user.handle || user.id}`}
                  class="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-neutral-800"
                >
                  <Avatar
                    src={user.avatar_url || ""}
                    alt={user.display_name || user.handle || "User"}
                    class="w-10 h-10 rounded-full bg-gray-200 dark:bg-neutral-700"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold text-gray-900 dark:text-white truncate">
                      {user.display_name || user.handle || "Unknown"}
                    </div>
                    <Show when={user.handle}>
                      <div class="text-sm text-gray-500 truncate">@{user.handle}</div>
                    </Show>
                  </div>
                </a>
              );
            }}
          </For>
        </div>
      </Show>
    </Suspense>
  );
};

/**
 * UserSearchResults - Search results for users
 */
const UserSearchResults: Component<{
  id?: string;
  query?: string;
  emptyText?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const resolvedQuery = () => props.query || props.context?.state?.userQuery || "";

  const [users, { refetch }] = createResource(
    resolvedQuery,
    async (query) => {
      if (!query.trim()) return [];
      try {
        const result = await api(`/users?q=${encodeURIComponent(query)}`);
        return toArray(result);
      } catch (err) {
        console.error("[UserSearchResults] Failed to search users:", err);
        return [];
      }
    }
  );

  createEffect(() => {
    if (!props.id || !props.context?.registerRefetch) return;
    const unregister = props.context.registerRefetch(props.id, () => refetch());
    onCleanup(unregister);
  });

  return (
    <Suspense fallback={<div class="text-center py-6 text-muted">検索中…</div>}>
      <Show when={resolvedQuery().trim()}>
        <Show
          when={users() && users()!.length > 0}
          fallback={
            <div class="text-center py-6 text-muted">
              {props.emptyText || "ユーザーが見つかりません"}
            </div>
          }
        >
          <div class="divide-y divide-gray-200 dark:divide-neutral-700">
            <For each={users()}>
              {(user: any) => (
                <a
                  href={`/@${user.handle || user.id}`}
                  class="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-neutral-800"
                >
                  <Avatar
                    src={user.avatar_url || ""}
                    alt={user.display_name || user.handle || "User"}
                    class="w-10 h-10 rounded-full bg-gray-200 dark:bg-neutral-700"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold text-gray-900 dark:text-white truncate">
                      {user.display_name || "Unknown"}
                    </div>
                    <Show when={user.handle}>
                      <div class="text-sm text-gray-500 truncate">@{user.handle}</div>
                    </Show>
                  </div>
                </a>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </Suspense>
  );
};

/**
 * InvitationList - Community invitations list
 */
const InvitationList: Component<{
  id?: string;
  endpoint?: string;
  emptyText?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const resolvedEndpoint = () => props.endpoint?.trim() || "/me/invitations";

  const [invitations, { refetch }] = createResource(
    resolvedEndpoint,
    async (path) => {
      try {
        const result = await api(path);
        return toArray(result);
      } catch (err) {
        console.error("[InvitationList] Failed to load invitations:", err);
        return [];
      }
    }
  );

  createEffect(() => {
    if (!props.id || !props.context?.registerRefetch) return;
    const unregister = props.context.registerRefetch(props.id, () => refetch());
    onCleanup(unregister);
  });

  const handleAccept = async (communityId: string) => {
    try {
      await api(`/communities/${communityId}/invitations/accept`, { method: "POST" });
      await refetch();
    } catch (err) {
      console.error("[InvitationList] Failed to accept invitation:", err);
    }
  };

  const handleDecline = async (communityId: string) => {
    try {
      await api(`/communities/${communityId}/invitations/decline`, { method: "POST" });
      await refetch();
    } catch (err) {
      console.error("[InvitationList] Failed to decline invitation:", err);
    }
  };

  return (
    <Suspense fallback={<div class="text-center py-6 text-muted">読み込み中…</div>}>
      <Show
        when={invitations() && invitations()!.length > 0}
        fallback={
          <div class="text-center py-6 text-muted">
            {props.emptyText || "招待はありません"}
          </div>
        }
      >
        <div class="space-y-3">
          <For each={invitations()}>
            {(invitation: any) => (
              <div class="rounded-lg border border-gray-200 dark:border-neutral-700 p-4 bg-white dark:bg-neutral-800">
                <div class="flex items-start gap-3">
                  <Show when={invitation.community?.icon_url}>
                    <img
                      src={invitation.community.icon_url}
                      alt=""
                      class="w-12 h-12 rounded-lg object-cover"
                    />
                  </Show>
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold text-gray-900 dark:text-white">
                      {invitation.community?.name || invitation.community_id}
                    </div>
                    <Show when={invitation.message}>
                      <div class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {invitation.message}
                      </div>
                    </Show>
                  </div>
                </div>
                <div class="flex gap-2 mt-3">
                  <button
                    type="button"
                    class="flex-1 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    onClick={() => handleAccept(invitation.community_id)}
                  >
                    参加する
                  </button>
                  <button
                    type="button"
                    class="flex-1 rounded-full border border-gray-300 dark:border-neutral-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700"
                    onClick={() => handleDecline(invitation.community_id)}
                  >
                    辞退する
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Suspense>
  );
};

/**
 * FollowRequestList - Follow requests list
 */
const FollowRequestList: Component<{
  id?: string;
  endpoint?: string;
  emptyText?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const resolvedEndpoint = () => props.endpoint?.trim() || "/me/follow-requests";

  const [requests, { refetch }] = createResource(
    resolvedEndpoint,
    async (path) => {
      try {
        const result = await api(path);
        return toArray(result);
      } catch (err) {
        console.error("[FollowRequestList] Failed to load follow requests:", err);
        return [];
      }
    }
  );

  createEffect(() => {
    if (!props.id || !props.context?.registerRefetch) return;
    const unregister = props.context.registerRefetch(props.id, () => refetch());
    onCleanup(unregister);
  });

  const handleAccept = async (requesterId: string) => {
    try {
      await api(`/users/${requesterId}/follow/accept`, { method: "POST" });
      await refetch();
    } catch (err) {
      console.error("[FollowRequestList] Failed to accept request:", err);
    }
  };

  const handleReject = async (requesterId: string) => {
    try {
      await api(`/users/${requesterId}/follow/reject`, { method: "POST" });
      await refetch();
    } catch (err) {
      console.error("[FollowRequestList] Failed to reject request:", err);
    }
  };

  return (
    <Suspense fallback={<div class="text-center py-6 text-muted">読み込み中…</div>}>
      <Show
        when={requests() && requests()!.length > 0}
        fallback={
          <div class="text-center py-6 text-muted">
            {props.emptyText || "フォローリクエストはありません"}
          </div>
        }
      >
        <div class="space-y-3">
          <For each={requests()}>
            {(request: any) => {
              const requester = request.requester || {};
              return (
                <div class="rounded-lg border border-gray-200 dark:border-neutral-700 p-4 bg-white dark:bg-neutral-800">
                  <div class="flex items-center gap-3">
                    <Avatar
                      src={requester.avatar_url || ""}
                      alt={requester.display_name || "User"}
                      class="w-12 h-12 rounded-full bg-gray-200 dark:bg-neutral-700"
                    />
                    <div class="flex-1 min-w-0">
                      <div class="font-semibold text-gray-900 dark:text-white truncate">
                        {requester.display_name || "Unknown"}
                      </div>
                      <Show when={requester.handle}>
                        <div class="text-sm text-gray-500 truncate">@{requester.handle}</div>
                      </Show>
                    </div>
                  </div>
                  <div class="flex gap-2 mt-3">
                    <button
                      type="button"
                      class="flex-1 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                      onClick={() => handleAccept(request.requester_id)}
                    >
                      承認
                    </button>
                    <button
                      type="button"
                      class="flex-1 rounded-full border border-gray-300 dark:border-neutral-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700"
                      onClick={() => handleReject(request.requester_id)}
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
    </Suspense>
  );
};

/**
 * MessageThread - DM message thread view
 */
const MessageThread: Component<{
  id?: string;
  threadId?: string;
  emptyText?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const resolvedThreadId = () =>
    props.threadId || props.context?.state?.activeThreadId || props.context?.routeParams?.id || "";

  const [messages, { refetch }] = createResource(
    resolvedThreadId,
    async (threadId) => {
      if (!threadId) return [];
      try {
        const result = await api(`/dm/threads/${threadId}/messages`);
        return toArray(result);
      } catch (err) {
        console.error("[MessageThread] Failed to load messages:", err);
        return [];
      }
    }
  );

  createEffect(() => {
    if (!props.id || !props.context?.registerRefetch) return;
    const unregister = props.context.registerRefetch(props.id, () => refetch());
    onCleanup(unregister);
  });

  return (
    <Suspense fallback={<div class="text-center py-6 text-muted">読み込み中…</div>}>
      <Show when={resolvedThreadId()}>
        <Show
          when={messages() && messages()!.length > 0}
          fallback={
            <div class="text-center py-6 text-muted">
              {props.emptyText || "メッセージはまだありません"}
            </div>
          }
        >
          <div class="space-y-3 max-h-[50vh] overflow-y-auto p-2">
            <For each={messages()}>
              {(message: any) => (
                <div class="rounded-lg bg-gray-100 dark:bg-neutral-800 p-3">
                  <div class="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                    {message.content || message.text || ""}
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {formatDateTime(message.published || message.created_at)}
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </Suspense>
  );
};

/**
 * MessageComposer - DM message composer
 */
const MessageComposer: Component<{
  threadId?: string;
  recipients?: string[];
  placeholder?: string;
  onSent?: () => void;
  context?: UiRuntimeContext;
}> = (props) => {
  const [text, setText] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const resolvedRecipients = () =>
    props.recipients || props.context?.state?.activeRecipients || [];

  const handleSubmit = async (ev: Event) => {
    ev.preventDefault();
    const content = text().trim();
    if (!content) {
      setError("メッセージを入力してください");
      return;
    }

    setSending(true);
    setError(null);
    try {
      await api("/dm/send", {
        method: "POST",
        body: JSON.stringify({
          recipients: resolvedRecipients(),
          content,
        }),
      });
      setText("");
      if (typeof props.onSent === "function") {
        props.onSent();
      } else if (props.context?.refresh) {
        props.context.refresh();
      }
    } catch (err: any) {
      setError(err?.message || "送信に失敗しました");
    } finally {
      setSending(false);
    }
  };

  return (
    <form class="grid gap-2" onSubmit={handleSubmit}>
      <textarea
        class="w-full min-h-[80px] resize-none rounded-md border border-gray-200 dark:border-neutral-800 bg-transparent p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500 focus:outline-none"
        placeholder={props.placeholder || "メッセージを入力"}
        value={text()}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />
      <Show when={error()}>
        <div class="text-sm text-red-500">{error()}</div>
      </Show>
      <div class="flex justify-end">
        <button
          type="submit"
          class="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
          disabled={sending() || !text().trim()}
        >
          {sending() ? "送信中…" : "送信"}
        </button>
      </div>
    </form>
  );
};

/**
 * NavLink - Navigation link with active state
 */
const NavLink: Component<{
  href?: string;
  text?: string;
  icon?: string;
  children?: JSX.Element;
}> = (props) => {
  const isActive = () => {
    if (typeof window === "undefined") return false;
    return window.location.pathname === props.href;
  };

  return (
    <a
      href={props.href}
      class={`flex items-center gap-2 px-3 py-2 rounded-lg ${
        isActive()
          ? "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400"
          : "hover:bg-gray-100 dark:hover:bg-neutral-800"
      }`}
    >
      <Show when={props.icon}>
        <span>{props.icon}</span>
      </Show>
      {props.children || props.text}
    </a>
  );
};

/**
 * PageHeader - Page header with title and actions
 */
const PageHeader: Component<{
  title?: string;
  backHref?: string;
  children?: JSX.Element;
}> = (props) => {
  return (
    <div class="flex items-center gap-4 mb-6">
      <Show when={props.backHref}>
        <a
          href={props.backHref}
          class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800"
        >
          ←
        </a>
      </Show>
      <h1 class="text-xl font-bold text-gray-900 dark:text-white flex-1">
        {props.title}
      </h1>
      {props.children}
    </div>
  );
};

/**
 * UserProfileView - Full user profile display with posts
 */
const UserProfileView: Component<{
  handle?: string;
  context?: UiRuntimeContext;
}> = (props) => {
  const me = useMe();
  const [shareOpen, setShareOpen] = createSignal(false);
  const [profileModalView, setProfileModalView] = createSignal<"share" | "scan">("share");
  const [loading, setLoading] = createSignal(false);

  // Parse handle from props or route params
  const rawHandle = createMemo(() => {
    const h = props.handle || props.context?.routeParams?.handle || "";
    // Decode URI components
    let current = h;
    for (let i = 0; i < 3; i++) {
      try {
        const decoded = decodeURIComponent(current);
        if (decoded === current) break;
        current = decoded;
      } catch {
        break;
      }
    }
    return current;
  });

  const parseHandle = (raw: string) => {
    const trimmed = (raw || "").trim().replace(/^@+/, "");
    if (!trimmed) return { username: "", domain: null };
    const parts = trimmed.split("@");
    if (parts.length >= 2) {
      return { username: parts[0] || "", domain: parts[1] || null };
    }
    return { username: parts[0] || trimmed, domain: null };
  };

  const handleInfo = createMemo(() => parseHandle(rawHandle()));
  const lookupId = createMemo(() => handleInfo().username);

  // Fetch user data
  const [user, { mutate: setUser }] = createResource(
    () => ({ id: lookupId(), domain: handleInfo().domain }),
    async ({ id, domain }) => {
      if (!id) throw new Error("missing profile id");
      try {
        const lookup = domain ? `@${id}@${domain}` : id;
        const result = await getUser(lookup);
        return normalizeUserProfile(result, id, domain || undefined);
      } catch (error) {
        console.error("[UserProfileView] user fetch failed:", error);
        throw error;
      }
    }
  );

  // Normalize user profile data
  const normalizeUserProfile = (raw: any, fallbackHandle: string, fallbackDomain?: string) => {
    const data = raw?.data || raw || {};
    const actorId = typeof data.id === "string" ? data.id : undefined;

    const extractDomain = (url?: string) => {
      if (!url) return undefined;
      try { return new URL(url).hostname; } catch { return undefined; }
    };

    const candidateDomain =
      data.domain?.trim() ||
      fallbackDomain?.trim() ||
      extractDomain(data.url) ||
      extractDomain(actorId);

    const handle =
      data.handle?.trim() ||
      data.username?.trim() ||
      data.preferredUsername?.trim() ||
      fallbackHandle?.trim() ||
      (actorId ? actorId.split("/").pop() : undefined);

    const displayName =
      data.display_name?.trim() ||
      data.name?.trim() ||
      data.preferredUsername?.trim() ||
      data.username?.trim() ||
      handle ||
      fallbackHandle;

    const avatarUrl =
      data.avatar_url?.trim() ||
      (Array.isArray(data.icon)
        ? data.icon.find((icon: any) => icon?.url)?.url
        : data.icon?.url);

    return {
      ...data,
      handle: handle || data.handle,
      id: data.id || handle,
      display_name: displayName,
      domain: candidateDomain,
      avatar_url: avatarUrl,
    };
  };

  // Fetch user's posts
  const [posts, { mutate: setPosts }] = createResource(
    () => user(),
    async (u) => {
      if (!u) return [];
      try {
        const globalPosts = await api("/posts").catch(() => []);
        const userPosts = toArray(globalPosts).filter((p: any) => p?.author_id === u.id);
        return userPosts.sort((a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      } catch {
        return [];
      }
    }
  );

  const handlePostUpdated = (updated: any) => {
    setPosts((prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.map((p: any) => p.id === updated?.id ? { ...p, ...updated } : p);
    });
  };

  const handlePostDeleted = (id: string) => {
    setPosts((prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.filter((p: any) => p.id !== id);
    });
  };

  // Relationship status
  const relationship = createMemo(() => (user() as any)?.relationship || {});
  const followingStatus = createMemo(() => {
    const rel = relationship();
    return rel?.following ?? (user() as any)?.friend_status ?? null;
  });
  const isFriend = createMemo(() => {
    const rel = relationship();
    if (typeof rel?.is_friend === "boolean") return rel.is_friend;
    return (user() as any)?.friend_status === "accepted";
  });

  // Follow/unfollow actions
  const buildFollowTargetId = (u: any) => {
    const rawId = (u?.id || u?.handle || "").toString().trim();
    if (!rawId) return null;
    if (rawId.includes("@")) return rawId;
    const domain = u?.domain?.trim() || null;
    const handle = rawId.replace(/^@+/, "");
    return domain ? `@${handle}@${domain}` : handle;
  };

  const onFollow = async () => {
    if (!user()) return;
    const target = buildFollowTargetId(user());
    if (!target) return;
    setLoading(true);
    try {
      await followUser(target);
      setUser((prev: any) => prev ? {
        ...prev,
        relationship: { ...prev.relationship, following: "pending", is_friend: prev.relationship?.is_friend || false },
      } : prev);
    } catch {}
    setLoading(false);
  };

  const onUnfollow = async () => {
    if (!user()) return;
    const target = buildFollowTargetId(user());
    if (!target) return;
    setLoading(true);
    try {
      await unfollowUser(target);
      setUser((prev: any) => prev ? {
        ...prev,
        relationship: { ...prev.relationship, following: null, is_friend: false },
        friend_status: null,
      } : prev);
    } catch {}
    setLoading(false);
  };

  // Share URLs
  const profileDomain = createMemo(() => (user() as any)?.domain || "");
  const shareUrl = createMemo(() => {
    const handle = (user() as any)?.handle;
    if (!handle) return "";
    const domain = profileDomain();
    return domain ? `https://${domain}/@${handle}` : `/@${handle}`;
  });
  const shareHandle = createMemo(() => {
    const handle = (user() as any)?.handle;
    if (!handle) return user()?.id || "";
    const domain = profileDomain();
    return domain ? `@${handle}@${domain}` : `@${handle}`;
  });

  return (
    <div class="max-w-[680px] mx-auto">
      {/* Profile Card */}
      <div class="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-md p-4">
        <Show when={user.error}>
          <div class="text-center p-6">
            <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-2">
              ユーザーが見つかりません
            </h2>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
              @{lookupId()} は存在しないか、アクセスできません。
            </p>
            <a href="/" class="inline-block px-4 py-2 bg-blue-600 text-white rounded-full text-sm hover:bg-blue-700">
              ホームに戻る
            </a>
          </div>
        </Show>
        <Show when={!user.error && user()} fallback={!user.error && <div class="text-muted">読み込み中…</div>}>
          <div class="flex items-start gap-4">
            <img
              src={user()?.avatar_url || ""}
              alt="アバター"
              class="w-20 h-20 rounded-full bg-gray-200 dark:bg-neutral-700 object-cover"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <div class="text-xl font-semibold truncate">
                  {user()!.display_name || "ユーザー"}
                </div>
                <span class="text-xs text-muted break-all">
                  ID: @{user()!.handle || user()!.id}
                </span>
                <Show when={isFriend()}>
                  <span class="text-xs font-semibold text-green-700 dark:text-green-300">
                    友達（相互フォロー）
                  </span>
                </Show>
              </div>
              <div class="mt-3 flex items-center gap-8">
                <div>
                  <div class="text-[15px] font-semibold text-gray-900 dark:text-white">
                    {posts()?.length ?? 0}
                  </div>
                  <div class="text-[12px] text-muted">投稿</div>
                </div>
              </div>
              <div class="mt-3 flex items-center">
                <div class="ml-auto flex items-center gap-2">
                  <Show when={me() && user() && me()!.id !== user()!.id}>
                    <div class="flex items-center gap-2 flex-wrap">
                      <Show when={followingStatus() === "accepted"}>
                        <button
                          class="px-3 py-1.5 rounded-full border border-gray-200 dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                          disabled={loading()}
                          onClick={onUnfollow}
                        >
                          {loading() ? "解除中…" : "フォロー中"}
                        </button>
                      </Show>
                      <Show when={followingStatus() === "pending"}>
                        <button
                          class="px-3 py-1.5 rounded-full border border-gray-200 dark:border-neutral-700 text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                          disabled={loading()}
                          onClick={onUnfollow}
                        >
                          {loading() ? "キャンセル中…" : "フォロー申請中 (取消)"}
                        </button>
                      </Show>
                      <Show when={!followingStatus()}>
                        <button
                          class="px-3 py-1.5 rounded-full bg-black text-white hover:opacity-90 text-sm"
                          disabled={loading()}
                          onClick={onFollow}
                        >
                          {loading() ? "送信中…" : "フォローする"}
                        </button>
                      </Show>
                    </div>
                  </Show>
                  <button
                    onClick={() => { setProfileModalView("share"); setShareOpen(true); }}
                    class="px-3 py-1.5 border border-gray-200 dark:border-neutral-700 rounded-full text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                  >
                    プロフィールを共有
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Show>
      </div>

      {/* Posts List */}
      <div class="mt-3 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-md overflow-hidden">
        <div class="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">投稿</div>
        <Show when={posts()} fallback={<div class="px-3 py-10 text-center text-muted">投稿を読み込み中…</div>}>
          <Show when={posts()!.length > 0} fallback={<div class="px-3 py-10 text-center text-muted">まだ投稿がありません</div>}>
            <div class="grid gap-0">
              <For each={posts() || []}>
                {(p: any) => (
                  <PostCard post={p} onUpdated={handlePostUpdated} onDeleted={handlePostDeleted} />
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      {/* Profile Modal */}
      <ProfileModal
        open={shareOpen()}
        onClose={() => { setShareOpen(false); setProfileModalView("share"); }}
        profileUrl={shareUrl()}
        displayName={user()?.display_name || ""}
        handle={shareHandle()}
        avatarUrl={user()?.avatar_url || ""}
        initialView={profileModalView()}
      />
    </div>
  );
};

/**
 * Register all custom components
 */
export function registerCustomComponents() {
  // Data display components
  registerUiComponent("PostFeed", PostFeed);
  registerUiComponent("StoriesBar", StoriesBar);
  registerUiComponent("UserAvatar", UserAvatar);
  registerUiComponent("ThreadList", ThreadList);
  registerUiComponent("CommunityList", CommunityList);
  registerUiComponent("NotificationList", NotificationList);
  registerUiComponent("PostComposer", PostComposer);
  registerUiComponent("CommentList", CommentList);
  registerUiComponent("CommentForm", CommentForm);
  registerUiComponent("FriendList", FriendList);
  registerUiComponent("UserSearchResults", UserSearchResults);
  registerUiComponent("InvitationList", InvitationList);
  registerUiComponent("FollowRequestList", FollowRequestList);
  registerUiComponent("MessageThread", MessageThread);
  registerUiComponent("MessageComposer", MessageComposer);
  registerUiComponent("NavLink", NavLink);
  registerUiComponent("PageHeader", PageHeader);
  registerUiComponent("UserProfileView", UserProfileView);

  console.log("[UiComponents] Custom components registered");
}
