import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  onCleanup,
  onMount,
  type Accessor,
} from "solid-js";
import { createStore } from "solid-js/store";
import { IconHeart } from "../components/icons";
import { api, getUser } from "../lib/api";
import AllStoriesBar from "../components/AllStoriesBar";
import Avatar from "../components/Avatar";
import useSwipeTabs from "../hooks/useSwipeTabs";

// Homeの偽StoriesBarを削除。実データ版を使用、E

// HomeからコンポEザーは撤去E作Eは別ペEジへEE

function formatTimestamp(value?: string) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value || "";
  }
}



function FeedItem(props: { p: any }) {
  const [isLiked, setIsLiked] = createSignal(false);
  const [likeCount, setLikeCount] = createSignal(props.p.like_count || 0);
  const [shareCopied, setShareCopied] = createSignal(false);
  const [author] = createResource(async () =>
    getUser(props.p.author_id).catch(() => null)
  );

  const mediaUrls = createMemo(() =>
    Array.isArray(props.p.media_urls)
      ? (props.p.media_urls as string[]).filter(
          (url) => typeof url === "string" && url.length > 0,
        )
      : []
  );
  const formattedCreatedAt = createMemo(() => formatTimestamp(props.p.created_at));
  const shareLabel = createMemo(() => (shareCopied() ? "コピーしました" : "共有"));
  let shareResetTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (shareResetTimer) clearTimeout(shareResetTimer);
  });

  const handleLike = () => {
    setIsLiked((prev) => {
      const next = !prev;
      setLikeCount((count) => Math.max(0, count + (next ? 1 : -1)));
      return next;
    });
  };

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const postUrl = new URL(`/posts/${props.p.id}`, window.location.origin).toString();
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ url: postUrl });
        return;
      }
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(postUrl);
      }
    } catch {
      // fall through to fallback UI state
    }
    setShareCopied(true);
    if (shareResetTimer) clearTimeout(shareResetTimer);
    shareResetTimer = setTimeout(() => setShareCopied(false), 2000);
  };

  return (
    <article class="bg-white dark:bg-neutral-900 border hairline rounded-2xl shadow-sm transition-colors">
      <Show when={props.p.community_id && (props.p.community_name || props.p.community_icon_url)}>
        <a
          href={`/c/${props.p.community_id}`}
          class="px-4 pt-3 flex items-center gap-2 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100 transition-colors"
        >
          <Avatar
            src={props.p.community_icon_url || ""}
            alt="コミュニティ"
            class="w-4 h-4 rounded"
            variant="community"
          />
          <span>{props.p.community_name || "コミュニティ"}</span>
        </a>
      </Show>
      <Show when={author()}>
        <div class="px-4 pb-4 pt-3 flex items-start gap-3">
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
            <div class="flex flex-wrap items-center gap-x-2 text-[15px] leading-tight">
                <a
                href={`/@${encodeURIComponent((props.p as any).author_handle || props.p.author_id)}`}
                class="font-semibold text-gray-900 dark:text-white truncate hover:underline"
              >
                {author()?.display_name}
              </a>
              <Show when={formattedCreatedAt()}>
                {(createdAt) => (
                  <>
                    <span class="text-gray-500">·</span>
                    <span class="text-gray-500">{createdAt()}</span>
                  </>
                )}
              </Show>
            </div>
          <Show when={props.p.text}>
            <div class="mt-2 text-[15px] leading-[1.5] text-gray-900 dark:text-white whitespace-pre-wrap">
              {props.p.text}
            </div>
          </Show>
          <Show when={mediaUrls().length > 0}>
            <div class="mt-3 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-black/5 dark:bg-white/5">
              <Show
                when={mediaUrls().length === 1}
                fallback={
                  <div class="flex overflow-x-auto gap-2 snap-x snap-mandatory">
                    <For each={mediaUrls()}>
                      {(url, idx) => (
                        <div class="flex-shrink-0 basis-full snap-center">
                          <img
                            src={url}
                            alt={`投稿画像${idx() + 1}`}
                            class="w-full h-full max-h-96 object-cover"
                          />
                        </div>
                      )}
                    </For>
                  </div>
                }
              >
                <img
                  src={mediaUrls()[0]}
                  alt="投稿画像"
                  class="w-full h-full max-h-96 object-cover"
                />
              </Show>
            </div>
          </Show>
            <div class="flex items-center justify-between max-w-md mt-4 text-sm text-gray-500">
              <button
                type="button"
                class="flex items-center gap-2 rounded-full px-2 py-1 hover:text-blue-500 transition-colors group"
                aria-label="返信"
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
                <span>{props.p.comment_count || 0}</span>
              </button>
              <button
                type="button"
                class="flex items-center gap-2 rounded-full px-2 py-1 hover:text-green-500 transition-colors group"
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
                <span>{props.p.reaction_count || 0}</span>
              </button>
              <button
                type="button"
                class={`flex items-center gap-2 rounded-full px-2 py-1 transition-colors group ${
                  isLiked() ? "text-red-500" : "hover:text-red-500"
                }`}
                onClick={handleLike}
                aria-label="いいね"
              >
                <div
                  class={`p-2 rounded-full transition-colors group-hover:bg-red-50 dark:group-hover:bg-red-900/20 ${
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
                <span>{likeCount()}</span>
              </button>
              <button
                type="button"
                class="flex items-center gap-2 rounded-full px-2 py-1 hover:text-blue-500 transition-colors group"
                onClick={handleShare}
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
                      d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"
                    />
                  </svg>
                </div>
                <span aria-live="polite">{shareLabel()}</span>
              </button>
            </div>
          </div>
        </div>
      </Show>
    </article>
  );
}

type FilterOption =
  | { key: "all"; label: string; type: "all" }
  | { key: string; label: string; type: "community" };

type SwipeBindings = ReturnType<typeof useSwipeTabs>;

function TimelineFilter(props: {
  options: Accessor<FilterOption[]>;
  activeIndex: Accessor<number>;
  onSelectIndex: (index: number) => void;
  swipe: SwipeBindings;
}) {
  let containerRef: HTMLDivElement | undefined;
  let containerObserver: ResizeObserver | undefined;
  const optionRefs = new Map<string, HTMLButtonElement>();
  const [optionRects, setOptionRects] = createSignal<
    Record<string, { left: number; width: number }>
  >({});

  const updateOptionRect = (key: string) => {
    const el = optionRefs.get(key);
    if (!el || !containerRef) return;
    const optionBounds = el.getBoundingClientRect();
    const containerBounds = containerRef.getBoundingClientRect();
    setOptionRects((prev) => ({
      ...prev,
      [key]: {
        left: optionBounds.left - containerBounds.left,
        width: optionBounds.width,
      },
    }));
  };

  const removeOptionRect = (key: string) => {
    setOptionRects((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const updateAllOptionRects = () => {
    if (!containerRef) return;
    requestAnimationFrame(() => {
      props.options().forEach((option) => updateOptionRect(option.key));
    });
  };

  const setContainerRef = (el: HTMLDivElement | undefined) => {
    containerObserver?.disconnect();
    containerRef = el;
    if (containerRef) {
      updateAllOptionRects();
      containerObserver = new ResizeObserver(() => updateAllOptionRects());
      containerObserver.observe(containerRef);
    }
    props.swipe.ref(el ?? null);
  };

  onCleanup(() => {
    containerObserver?.disconnect();
    props.swipe.ref(null);
  });

  const timelineProps = props;

  function OptionButton(props: { option: FilterOption; index: number }) {
    let buttonEl: HTMLButtonElement | undefined;
    const isActive = createMemo(
      () => props.index === timelineProps.activeIndex(),
    );

    onMount(() => {
      if (!buttonEl) return;
      optionRefs.set(props.option.key, buttonEl);
      updateOptionRect(props.option.key);
      const observer = new ResizeObserver(() => updateOptionRect(props.option.key));
      observer.observe(buttonEl);
      onCleanup(() => {
        observer.disconnect();
        optionRefs.delete(props.option.key);
        removeOptionRect(props.option.key);
      });
    });

    createEffect(() => {
      if (buttonEl) updateOptionRect(props.option.key);
    });

    return (
      <button
        ref={(el) => {
          buttonEl = el ?? undefined;
          if (el) {
            optionRefs.set(props.option.key, el);
            updateOptionRect(props.option.key);
          }
        }}
        type="button"
        data-option-key={props.option.key}
        class={`relative z-10 flex-shrink-0 px-4 py-2 text-sm font-semibold whitespace-nowrap rounded-full transition-colors ${
          isActive()
            ? "text-gray-900 dark:text-white"
            : "text-muted hover:text-gray-900 dark:hover:text-white"
        }`}
        onClick={() => timelineProps.onSelectIndex(props.index)}
      >
        {props.option.label}
      </button>
    );
  }

  createEffect(() => {
    props.options();
    queueMicrotask(() => updateAllOptionRects());
  });

  const indicatorPosition = createMemo(() => {
    const option = props.options()[props.activeIndex()];
    if (!option) return { left: 0, width: 0 };
    return optionRects()[option.key] ?? { left: 0, width: 0 };
  });

  const indicatorStyle = createMemo(() => {
    const position = indicatorPosition();
    const width = Math.max(0, position.width);
    return {
      transform: `translateX(${position.left}px)`,
      width: `${width}px`,
      transition: props.swipe.dragging()
        ? "none"
        : "transform 0.2s ease, width 0.2s ease",
    } as const;
  });

  return (
    <div class="mb-3">
      <div
        ref={setContainerRef}
        class="relative overflow-hidden rounded-full border hairline bg-neutral-100 dark:bg-neutral-800 transition-colors"
        style={{ "touch-action": "pan-y" }}
        {...props.swipe.handlers}
      >
        <div
          class="absolute top-1 bottom-1 rounded-full border hairline bg-white dark:bg-neutral-900 shadow-sm pointer-events-none"
          style={indicatorStyle()}
        />
        <div class="relative flex gap-2 px-2 py-1">
          <For each={props.options()}>
            {(option, index) => (
              <OptionButton option={option} index={index()} />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

type Props = {
  onOpenNotifications?: () => void;
};

export default function Home(props: Props) {
  const [selectedCommunities, setSelectedCommunities] = createSignal<string[]>(
    [],
  );
  const toCommunityId = (value: unknown) => {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return undefined;
  };

  const extractCommunityIds = (items: unknown): string[] =>
    Array.isArray(items)
      ? (items as any[])
          .map((item) => toCommunityId(item?.id))
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];

  const [communities] = createResource(async () => {
    const comms = await api("/me/communities").catch(() => []);
    // 初期値として全Communityを選抁E
    if (selectedCommunities().length === 0) {
      setSelectedCommunities(extractCommunityIds(comms));
    }
    return comms;
  });

  const filterOptions = createMemo<FilterOption[]>(() => {
    const comms = communities() || [];
    return [
      { key: "all", label: "すべて", type: "all" as const },
      ...comms.map((c: any) => ({
        key: String(c.id ?? ""),
        label: String(c.name ?? "コミュニティ"),
        type: "community" as const,
      })),
    ];
  });

  const sliderLength = createMemo(() => Math.max(1, filterOptions().length));

  const [activeIndex, setActiveIndex] = createSignal(0);

  const selectAll = () => {
    const comms = communities();
    setSelectedCommunities(extractCommunityIds(comms));
  };

  const selectCommunity = (id: string) => {
    if (!id) return;
    const normalized = toCommunityId(id);
    if (!normalized) return;
    setSelectedCommunities([normalized]);
  };

  const applySelection = (index: number) => {
    const opts = filterOptions();
    const boundedIndex = clampIndex(index);
    const option = opts[boundedIndex];
    if (!option) return;
    setActiveIndex((prev) => (prev === boundedIndex ? prev : boundedIndex));
    if (option.type === "all") {
      selectAll();
    } else {
      selectCommunity(option.key);
    }
    const prev = boundedIndex > 0 ? opts[boundedIndex - 1] : undefined;
    const next =
      boundedIndex < opts.length - 1 ? opts[boundedIndex + 1] : undefined;
    if (prev) void ensureFeedState(prev);
    if (next) void ensureFeedState(next);
  };

  const clampIndex = (index: number) => {
    const opts = filterOptions();
    const max = Math.max(0, opts.length - 1);
    return Math.max(0, Math.min(index, max));
  };

  const handleSwipeIndex = (index: number) => {
    const next = clampIndex(index);
    if (next === activeIndex()) return;
    applySelection(next);
  };

  const activeOption = createMemo(() => {
    const opts = filterOptions();
    return opts[clampIndex(activeIndex())];
  });

  const filterSwipe = useSwipeTabs({
    length: () => filterOptions().length,
    currentIndex: () => activeIndex(),
    setIndex: handleSwipeIndex,
  });

  const timelineSwipe = useSwipeTabs({
    length: () => filterOptions().length,
    currentIndex: () => activeIndex(),
    setIndex: handleSwipeIndex,
  });

  onCleanup(() => {
    filterSwipe.ref(null);
    timelineSwipe.ref(null);
  });

  createEffect(() => {
    const opts = filterOptions();
    const comms = communities();
    const communityIds = extractCommunityIds(comms);
    const allIndex = opts.findIndex((option) => option.type === "all");
    const defaultIndex = allIndex >= 0 ? allIndex : 0;
    const currentActive = clampIndex(activeIndex());
    const selectionValues = Array.from(
      new Set(
        selectedCommunities()
          .map((value) => toCommunityId(value))
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    );
    const selectionSet = new Set(selectionValues);

    const allSelected =
      communityIds.length > 0 &&
      communityIds.every((id) => selectionSet.has(id)) &&
      selectionValues.length === communityIds.length;

    let nextIndex = defaultIndex;

    if (
      allSelected &&
      (currentActive === defaultIndex || selectionValues.length > 1)
    ) {
      nextIndex = defaultIndex;
    } else if (selectionValues.length >= 1) {
      const primarySelected = selectionValues[0];
      const matchIndex = opts.findIndex((option) => {
        if (option.type !== "community") return false;
        if (selectionValues.length === 1) {
          return option.key === primarySelected;
        }
        return selectionSet.has(option.key);
      });
      if (matchIndex >= 0) nextIndex = matchIndex;
    }

    setActiveIndex((prev) => (prev === nextIndex ? prev : nextIndex));
  });

  const toTimestamp = (value: unknown) => {
    if (!value) return 0;
    const time = Date.parse(String(value));
    return Number.isNaN(time) ? 0 : time;
  };

  type FeedStatus = "idle" | "loading" | "ready" | "error";
  type FeedState = {
    status: FeedStatus;
    posts: any[];
    error?: string;
  };

  const [feedStates, setFeedStates] = createStore<Record<string, FeedState>>({});

  type ActiveFeedSource = {
    option: FilterOption;
    comms: any[] | undefined;
  };

  const activeFeedSource = createMemo<ActiveFeedSource | null>(() => {
    const option = activeOption();
    if (!option) return null;
    if (option.type === "community" && !option.key) return null;
    const comms = communities();
    if (option.type === "all") {
      if (communities.loading) return null;
      return {
        option,
        comms: Array.isArray(comms) ? comms : [],
      } satisfies ActiveFeedSource;
    }
    return {
      option,
      comms: Array.isArray(comms) ? comms : undefined,
    } satisfies ActiveFeedSource;
  });

  const [activeFeed, { refetch: refetchActiveFeed }] = createResource(
    activeFeedSource,
    async (source) => {
      if (!source) return [] as any[];
      return fetchPostsForOption(source.option, source.comms);
    },
  );

  createEffect(() => {
    const source = activeFeedSource();
    if (!source) return;
    const key = source.option.key;
    if (activeFeed.loading) {
      setFeedStates(key, (prev) => ({
        status: "loading",
        posts: prev?.posts ?? [],
        error: undefined,
      }));
      return;
    }
    const err = activeFeed.error;
    if (err) {
      setFeedStates(key, {
        status: "error",
        posts: [],
        error: err.message || "投稿を読み込めませんでした",
      });
      return;
    }
    if (activeFeed.state !== "unresolved") {
      setFeedStates(key, {
        status: "ready",
        posts: activeFeed() ?? [],
        error: undefined,
      });
    }
  });

  let previousCommunitySignature = "";

  createEffect(() => {
    const comms = communities();
    if (!Array.isArray(comms)) return;
    const signature = extractCommunityIds(comms).join("|");
    if (signature === previousCommunitySignature) return;
    previousCommunitySignature = signature;
    const allOption = filterOptions().find((option) => option.type === "all");
    if (!allOption) return;
    const existing = feedStates[allOption.key];
    if (existing?.status === "ready") {
      setFeedStates(allOption.key, { ...existing, status: "idle" });
      if (allOption.key === activeOption()?.key) {
        void refetchActiveFeed();
      } else {
        void ensureFeedState(allOption);
      }
    }
  });

  const fetchPostsForOption = async (
    option: FilterOption,
    comms: any[] | undefined,
  ) => {
    let communityIds: string[] = [];
    if (option.type === "all") {
      communityIds = extractCommunityIds(comms);
    } else if (option.type === "community") {
      const normalized = toCommunityId(option.key);
      communityIds = normalized ? [normalized] : [];
    }

    const metaMap = new Map<string, any>();
    for (const c of (comms || []) as any[]) {
      const id = toCommunityId(c?.id);
      if (id) {
        metaMap.set(id, c);
      }
    }

    const communityListsPromise = communityIds.length
      ? Promise.all(
          communityIds.map((id) =>
            api(`/communities/${id}/posts`).catch(() => []),
          ),
        )
      : Promise.resolve([] as any[]);
    const globalListPromise =
      option.type === "all"
        ? api(`/posts`).catch(() => [])
        : Promise.resolve([]);

    const [communityLists, globalList] = await Promise.all([
      communityListsPromise,
      globalListPromise,
    ]);

    const combined: any[] = [];
    (communityLists as any[]).forEach((list, index) => {
      const communityId = communityIds[index];
      const meta = communityId ? metaMap.get(communityId) : undefined;
      for (const post of (Array.isArray(list) ? list : []) as any[]) {
        combined.push({
          ...post,
          community_name: post?.community_name ?? meta?.name,
          community_icon_url: post?.community_icon_url ?? meta?.icon_url,
        });
      }
    });

    if (Array.isArray(globalList)) {
      for (const post of globalList as any[]) {
        combined.push({ ...post });
      }
    }

    combined.sort(
      (a, b) => toTimestamp(b?.created_at) - toTimestamp(a?.created_at),
    );
    return combined;
  };

  const ensureFeedState = async (option?: FilterOption) => {
    if (!option) return;
    const key = option.key;
    if (!key) return;
    const existing = feedStates[key];
    if (existing?.status === "loading" || existing?.status === "ready") return;

    const comms = communities();
    if (option.type === "all" && (communities.loading || !Array.isArray(comms))) {
      return;
    }

    const previousPosts = existing?.posts ?? [];
    setFeedStates(key, {
      status: "loading",
      posts: previousPosts,
      error: undefined,
    });

    try {
      const posts = await fetchPostsForOption(option, comms);
      setFeedStates(key, {
        status: "ready",
        posts,
        error: undefined,
      });
    } catch (err: any) {
      setFeedStates(key, {
        status: "error",
        posts: [],
        error: err?.message || "投稿を読み込めませんでした",
      });
    }
  };

  const resolveCommunityIdsForOption = (option: FilterOption) => {
    if (!option) return [] as string[];
    if (option.type === "all") {
      return extractCommunityIds(communities());
    }
    if (option.type === "community") {
      const normalized = toCommunityId(option.key);
      return normalized ? [normalized] : [];
    }
    return [];
  };

  createEffect(() => {
    const loading = communities.loading;
    const opts = filterOptions();
    const index = clampIndex(activeIndex());
    if (loading) return;
    const prev = index > 0 ? opts[index - 1] : undefined;
    const next = index < opts.length - 1 ? opts[index + 1] : undefined;
    if (prev) void ensureFeedState(prev);
    if (next) void ensureFeedState(next);
  });

  // Composeは別ペEジに移勁E

  return (
    <div class="w-full h-screen flex flex-col">
      {/* Mobile header (Home only): title left, heart right */}
      <div class="md:hidden sticky top-0 z-20 bg-white dark:bg-neutral-900 border-b hairline">
        <div class="h-14 px-3 sm:px-4 w-full flex items-center justify-between">
          <a href="/" class="text-[20px] font-medium tracking-tight">
            YuruCommu
          </a>
          <button
            class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800 active:opacity-80"
            aria-label="通知"
            onClick={props.onOpenNotifications}
          >
            <IconHeart />
          </button>
        </div>
      </div>
      {/* デスクトップ: 1カラム(中央タイムライン), モバイル: 1カラム */}
      <div class="flex flex-row justify-center gap-4 xl:gap-6 flex-1 overflow-hidden">
        {/* メインコンテンツ (タイムライン) */}
        <div class="flex-1 min-w-0 px-3 sm:px-4 lg:px-0 overflow-y-auto hidden-scrollbar">
          <div class="max-w-[680px] mx-auto">
            {/* ストーリーズ */}
            <div class="mt-6">
              <AllStoriesBar preferredCommunityId={selectedCommunities()[0]} />
            </div>

            {/* 表示範囲フィルター */}
            <TimelineFilter
              options={filterOptions}
              activeIndex={activeIndex}
              onSelectIndex={(index) => applySelection(clampIndex(index))}
              swipe={filterSwipe}
            />

            {/* 統合フィード */}
            <div
              class="relative overflow-hidden"
              ref={(el) => timelineSwipe.ref(el ?? null)}
              {...timelineSwipe.handlers}
            >
              <div
                class="flex"
                classList={{
                  "transition-transform": !timelineSwipe.dragging(),
                  "duration-300": !timelineSwipe.dragging(),
                  "ease-out": !timelineSwipe.dragging(),
                  "transition-none": timelineSwipe.dragging(),
                }}
                style={{
                  width: `${sliderLength() * 100}%`,
                  transform: timelineSwipe.sliderTransform(),
                }}
              >
                <For each={filterOptions()}>
                  {(option) => {
                    const feed = () => feedStates[option.key];
                    const posts = () => feed()?.posts ?? [];
                    const status = () => feed()?.status ?? "idle";
                    const error = () => feed()?.error;
                                    const fallbackText = () => {
                                      const st = status();
                                      if (st === "loading") return "読み込み中…";
                                      if (st === "error")
                                        return error() || "投稿の読み込みに失敗しました";
                                      if (option.type === "all" && communities.loading)
                                        return "読み込み中…";
                                      const ids = resolveCommunityIdsForOption(option);
                                      if (ids.length === 0) return "まだ投稿がありません";
                                      if (st === "idle") return "読み込み中…";
                                      return "まだ投稿がありません";
                                    };
                    return (
                      <div class="flex-none" style={{ width: `${100 / sliderLength()}%` }}>
                        <div class="grid gap-2 pb-24">
                          <Show
                            when={posts().length > 0}
                            fallback={
                              <div class="text-center py-8 text-muted">
                                {fallbackText()}
                              </div>
                            }
                          >
                            <For each={posts()}>
                              {(p: any) => <FeedItem p={p} />}
                            </For>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        </div>


      </div>
    </div>
  );
}
