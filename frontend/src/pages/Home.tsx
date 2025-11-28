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
import { api, useMe } from "../lib/api";
import AllStoriesBar from "../components/AllStoriesBar";
import PostCard from "../components/PostCard";
import useSwipeTabs from "../hooks/useSwipeTabs";
import Avatar from "../components/Avatar";
import { useShellContext } from "../lib/shell-context";

// Homeの偽StoriesBarを削除。実データ版を使用、E

// HomeからコンポEザーは撤去E作Eは別ペEジへEE

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
  onOpenComposer?: () => void;
};

function InlineComposer(props: {
  avatarUrl?: string;
  displayName?: string;
  onCompose?: () => void;
}) {
  return (
    <div class="rounded-2xl border hairline bg-white/80 dark:bg-neutral-900/80 shadow-sm backdrop-blur">
      <div class="p-3 sm:p-4 flex gap-3">
        <Avatar
          src={props.avatarUrl || ""}
          alt={props.displayName || "あなた"}
          class="w-12 h-12 rounded-full object-cover"
        />
        <div class="flex-1 min-w-0">
          <button
            type="button"
            class="w-full text-left border hairline rounded-2xl px-4 py-3 bg-gray-50 dark:bg-neutral-800 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-neutral-600 transition-colors"
            onClick={props.onCompose}
          >
            <div class="text-sm font-medium text-gray-600 dark:text-gray-300">
              いまどうしてる？
            </div>
            <div class="flex gap-2 mt-2 text-xs text-blue-600">
              <span class="px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30">投稿を書く</span>
              <span class="px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30">画像を追加</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home(props: Props) {
  const outlet = useShellContext();

  const openComposer = () => props.onOpenComposer?.() ?? outlet?.onOpenComposer?.();
  const openNotifications = () =>
    props.onOpenNotifications?.() ?? outlet?.onOpenNotifications?.();

  const me = useMe();
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

  const updatePostInFeeds = (updatedPost: any) => {
    Object.keys(feedStates).forEach((key) => {
      setFeedStates(key, (state) => {
        if (!state || !Array.isArray(state.posts)) return state;
        const idx = state.posts.findIndex((p: any) => p.id === updatedPost?.id);
        if (idx === -1) return state;
        const nextPosts = [...state.posts];
        nextPosts[idx] = { ...nextPosts[idx], ...updatedPost };
        return { ...state, posts: nextPosts };
      });
    });
  };

  const removePostFromFeeds = (postId: string) => {
    Object.keys(feedStates).forEach((key) => {
      setFeedStates(key, (state) => {
        if (!state || !Array.isArray(state.posts)) return state;
        const filtered = state.posts.filter((p: any) => p.id !== postId);
        if (filtered.length === state.posts.length) return state;
        return { ...state, posts: filtered };
      });
    });
  };

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
    <div class="w-full flex flex-col min-h-full">
      {/* Mobile header (Home only): title left, heart right */}
      <div class="md:hidden sticky top-0 z-20 bg-white dark:bg-neutral-900 border-b hairline">
        <div class="h-14 px-3 sm:px-4 w-full flex items-center justify-between">
          <a href="/" class="text-[20px] font-medium tracking-tight">
            YuruCommu
          </a>
          <button
            class="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-neutral-800 active:opacity-80"
            aria-label="通知"
            onClick={openNotifications}
          >
            <IconHeart />
          </button>
        </div>
      </div>
      {/* デスクトップ: 1カラム(中央タイムライン), モバイル: 1カラム */}
      <div class="flex flex-row justify-center gap-4 xl:gap-6 flex-1 overflow-hidden">
        {/* メインコンテンツ (タイムライン) */}
        <div class="flex-1 min-w-0 px-3 sm:px-4 lg:px-0">
          <div class="max-w-[680px] mx-auto">
            {/* ストーリーズ */}
            <div class="mt-6">
              <AllStoriesBar preferredCommunityId={selectedCommunities()[0]} />
            </div>

            {/* クイック作成（Twitter風のツイートボックス） */}
            <div class="mt-4">
              <InlineComposer
                avatarUrl={me()?.avatar_url || ""}
                displayName={me()?.display_name || ""}
                onCompose={openComposer}
              />
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
                              {(p: any) => (
                                <PostCard
                                  post={p}
                                  onUpdated={updatePostInFeeds}
                                  onDeleted={removePostFromFeeds}
                                />
                              )}
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
