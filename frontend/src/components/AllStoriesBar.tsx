import type React from "react";
import { createEffect, createMemo, createResource, createSignal, For, Show } from "../lib/solid-compat";
import { getUser, useMe, listMyCommunities } from "../lib/api";
import {
  getStoryViewedMap,
  listGlobalStories,
  listStories,
  markStoriesViewed,
  type Story,
} from "../lib/stories";
import { IconPlus } from "./icons";
import StoryComposer from "./StoryComposer";
import StoryViewer from "./StoryViewer";
import Avatar from "./Avatar";

type Props = {
  onOpenViewer?: (index: number) => void;
  onLoaded?: (stories: Story[]) => void;
  preferredCommunityId?: string;
};

export default function AllStoriesBar(props: Props) {
  const me = useMe();
  let uploadInput: HTMLInputElement | undefined = undefined;
  const [communities] = createResource(async () => {
    try {
      return await listMyCommunities();
    } catch {
      return [];
    }
  });
  // communities() の解決後に自動で再取得されるよう source を渡す
  const [stories, { refetch: refetchStories }] = createResource<Story[], any>(
    () => communities(),
    async (comms) => {
      const seen = new Set<string>();
      const merged: Story[] = [];
      const addStories = (list: Story[]) => {
        for (const story of list) {
          if (story && typeof story.id === "string" && !seen.has(story.id)) {
            seen.add(story.id);
            merged.push(story);
          }
        }
      };

      const globalStories = (await listGlobalStories().catch(() => [])) as any[];
      addStories(globalStories as Story[]);

      if (Array.isArray(comms)) {
        const lists = await Promise.all(
          comms.map((c: any) => listStories(c.id).catch(() => [])),
        );
        for (const list of lists) addStories(list as Story[]);
      }

      // 最新順
      merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return merged;
    },
  );

  const [composerOpen, setComposerOpen] = createSignal(false);
  const [selectedFiles, setSelectedFiles] = createSignal<File[]>([]);
  const [viewerStories, setViewerStories] = createSignal<Story[] | null>(null);
  const [viewerAuthor, setViewerAuthor] = createSignal<any | null>(null);
  const [viewedMap, setViewedMap] = createSignal(getStoryViewedMap());

  const updateViewedMap = (authorId?: string, latestCreatedAt?: string) => {
    if (authorId == null || !latestCreatedAt) return;
    setViewedMap((prev) => {
      const next = { ...prev };
      const current = next[authorId];
      if (current && current >= latestCreatedAt) return prev;
      next[authorId] = latestCreatedAt;
      return next;
    });
  };

  createEffect(() => {
    const s = stories();
    if (s) props.onLoaded?.(s);
  });

  createEffect(() => {
    stories();
    setViewedMap(getStoryViewedMap());
  });

  // 著者ごとにグルーピング（Instagram風）
  const groups = createMemo(() => {
    const list = stories() || [];
    const byAuthor = new Map<string, Story[]>();
    for (const s of list) {
      const key = s.author_id;
      const arr = byAuthor.get(key) || [];
      arr.push(s);
      byAuthor.set(key, arr);
    }
    // 各グループ内は古い→新しい順（再生順）
    for (const arr of byAuthor.values()) {
      arr.sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    }
    // グループ自体は最新投稿の新しい順
    const gs = Array.from(byAuthor.values());
    gs.sort((
      ga,
      gb,
    ) => (ga[ga.length - 1].created_at < gb[gb.length - 1].created_at
      ? 1
      : -1)
    );
    // 自分のストーリーを先頭へ
    const myId = me()?.id;
    if (myId) {
      const idx = gs.findIndex((g) => g[0]?.author_id === myId);
      if (idx > 0) {
        const [myGroup] = gs.splice(idx, 1);
        gs.unshift(myGroup);
      }
    }
    return gs;
  });

  // 表示用グループ: 自分のグループは別扱いにして一覧から除外する
  const groupsToRender = createMemo(() => {
    const gs = groups() || [];
    const myId = me()?.id;
    if (!myId) return gs;
    return gs.filter((g) => g[0]?.author_id !== myId);
  });

  // 自分のグループ（あれば）
  const myGroup = createMemo(() => {
    const gs = groups() || [];
    const myId = me()?.id;
    if (!myId) return null;
    return gs.find((g) => g[0]?.author_id === myId) || null;
  });

  // 著者のプロフィール（avatar_url）をまとめて取得
  const [authorMap] = createResource(() => groups(), async (gs) => {
    const ids = Array.from(
      new Set((gs || []).map((g) => g[0]?.author_id).filter(Boolean)),
    ) as string[];
    const users = await Promise.all(
      ids.map((id) => getUser(id).catch(() => null)),
    );
    const map = new Map<string, any>();
    users.forEach((u: any) => {
      if (u && u.id) map.set(u.id, u);
    });
    return map;
  });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log("AllStoriesBar: onPick");
    const input = e.target;
    const files = input.files;
    if (!files || files.length === 0) return;
    setSelectedFiles([...files]);
    console.log("AllStoriesBar: setting composerOpen to true");
    setComposerOpen(true);
    console.log("AllStoriesBar: composerOpen is now", composerOpen());
    console.log(
      `AllStoriesBar: opening composer with ${files.length} selected file(s)`,
    );
    input.value = "";
  };

  const hasMyStory = () => {
    const s = stories();
    const userId = me()?.id;
    return s && userId && s.some((story) => story.author_id === userId);
  };

  return (
    <div className="border-b hairline bg-white dark:bg-neutral-900 mb-3 sm:mb-4">
      <div className="px-2 sm:px-3 lg:px-5 py-3 overflow-x-auto">
        <div className="flex gap-4">
          {/* 自分のアイコン（常に表示）。丸は自分のストーリー閲覧、＋は常にアップロード */}
          <div className="shrink-0 flex flex-col items-center gap-1">
            <div className="relative">
              {/* hidden input with ref */}
              <input
                ref={(el) => uploadInput = el as HTMLInputElement}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onPick}
              />

              {/* avatar: if has story, clicking opens viewer; otherwise triggers upload */}
              <Show
                when={hasMyStory()}
                fallback={
                  <button
                    className="cursor-pointer block"
                    onClick={() => uploadInput?.click()}
                  >
                    {/* No decorative ring when user has not posted a story */}
                    <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-white dark:bg-neutral-900 overflow-hidden">
                      <div className="w-full h-full rounded-full overflow-hidden bg-neutral-200">
                        <Show
                          when={me()?.avatar_url}
                          fallback={
                              <div className="w-full h-full grid place-items-center text-gray-600 text-xs">
                              あなた
                            </div>
                          }
                        >
                          <Avatar
                            src={me()?.avatar_url ?? undefined}
                            alt="自分"
                            className="w-full h-full object-cover"
                          />
                        </Show>
                      </div>
                    </div>
                  </button>
                }
              >
                <button
                  className="cursor-pointer block"
                  onClick={() => {
                    const g = myGroup();
                    if (g) {
                      setViewerStories(g);
                      setViewerAuthor(me() || null);
                      const latest = g[g.length - 1];
                      if (latest?.created_at) {
                        const createdAt = typeof latest.created_at === 'string' ? latest.created_at : latest.created_at.toISOString();
                        updateViewedMap(me()?.id ?? "", createdAt);
                        markStoriesViewed(
                          me()?.id || "",
                          createdAt,
                        );
                      }
                    }
                  }}
                >
                  {/* Decorative ring only when user has stories */}
                  <div
                    class={hasMyStory()
                      ? "p-[3px] rounded-full bg-linear-to-tr from-pink-500 via-purple-500 to-yellow-500"
                      : ""}
                  >
                    <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-white dark:bg-neutral-900 p-[3px] overflow-hidden">
                      <div className="w-full h-full rounded-full overflow-hidden bg-neutral-200">
                        <Show
                          when={me()?.avatar_url}
                          fallback={
                            <div className="w-full h-full grid place-items-center text-gray-600 text-xs">
                              あなた
                            </div>
                          }
                        >
                          <Avatar
                            src={me()?.avatar_url ?? undefined}
                            alt="自分"
                            className="w-full h-full object-cover"
                          />
                        </Show>
                      </div>
                    </div>
                  </div>
                </button>
              </Show>
              {/* plus badge always opens upload */}
              <button
                className="absolute -bottom-1 -right-1 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center"
                type="button"
                onClick={() => uploadInput?.click()}
              >
                <IconPlus size={12} className="text-white" />
              </button>
            </div>
          </div>
          <Show when={(groupsToRender() || []).length > 0}>
            <For each={groupsToRender()}>
              {(group) => {
                const latest = group[group.length - 1];
                const authorId = group[0]?.author_id;
                const author = createMemo(() => authorMap()?.get(authorId));
                const isMe = () => me()?.id && authorId === me()?.id;
                const isViewed = () => {
                  const map = viewedMap();
                  const viewedAt = map[authorId || ""];
                  return Boolean(
                    viewedAt && latest?.created_at &&
                      viewedAt >= latest.created_at,
                  );
                };
                return (
                  <button
                    className="shrink-0 flex flex-col items-center gap-1 active:opacity-80"
                    onClick={() => {
                      setViewerStories(group);
                      setViewerAuthor(author() || null);
                      // mark this author's latest as viewed
                      if (authorId && latest?.created_at) {
                        const createdAt = typeof latest.created_at === 'string' ? latest.created_at : latest.created_at.toISOString();
                        updateViewedMap(authorId, createdAt);
                        markStoriesViewed(
                          authorId,
                          createdAt,
                        );
                      }
                    }}
                  >
                    <div
                      class={"p-[3px] rounded-full " + (isViewed()
                        ? "bg-linear-to-tr from-gray-300 to-gray-200"
                        : "bg-linear-to-tr from-pink-500 via-purple-500 to-yellow-500")}
                    >
                      <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-white dark:bg-neutral-900 p-[3px]">
                        <div className="w-full h-full rounded-full overflow-hidden bg-neutral-200">
                          <Show
                            when={author()?.avatar_url ||
                              (isMe() && me()?.avatar_url)}
                            fallback={
                              <div className="w-full h-full grid place-items-center text-gray-600 text-xs">
                                {isMe() ? "あなた" : "ユーザー"}
                              </div>
                            }
                          >
                          <Avatar
                            src={(author()?.avatar_url ||
                              me()?.avatar_url) as string}
                            alt="アバター"
                            className="w-full h-full object-cover"
                          />
                          </Show>
                        </div>
                      </div>
                    </div>
                      <div className="w-24 text-center text-[10px] leading-tight line-clamp-2">
                      {isMe() ? 'あなた' : author()?.display_name || 'ユーザー'}
                    </div>
                  </button>
                );
              }}
            </For>
          </Show>
        </div>
      </div>
      <StoryComposer
        open={composerOpen()}
        communityId={props.preferredCommunityId ?? null}
        onClose={() => {
          console.log("AllStoriesBar: onClose called");
          setComposerOpen(false);
          setSelectedFiles([]);
        }}
        onCreated={async () => {
          await refetchStories?.();
        }}
        initialFiles={selectedFiles()}
      />
      <Show when={viewerStories()}>
        <StoryViewer
          stories={viewerStories() || []}
          startIndex={0}
          author={viewerAuthor() || undefined}
          onClose={() => {
            setViewerStories(null);
            setViewerAuthor(null);
          }}
          onUpdated={async (updated) => {
            setViewerStories(updated);
            await refetchStories?.();
          }}
          myId={me()?.id}
        />
      </Show>
    </div>
  );
}
