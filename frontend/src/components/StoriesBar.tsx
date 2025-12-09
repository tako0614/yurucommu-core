import type React from "react";
import { createEffect, createMemo, createResource, createSignal, For, Show } from "../lib/solid-compat";
import { useParams } from "react-router-dom";
import {
  getStoryViewedMap,
  listStories,
  markStoriesViewed,
  type Story,
} from "../lib/stories";
import StoryComposer from "./StoryComposer";
import StoryViewer from "./StoryViewer";
import { getUser, useMe } from "../lib/api";
import Avatar from "./Avatar";

type Props = {
  onOpenViewer?: (index: number) => void;
  onLoaded?: (stories: Story[]) => void;
};

export default function StoriesBar(props: Props) {
  const params = useParams();
  const [stories, { refetch }] = createResource<Story[], string>(
    () => params.id!,
    async (id: string) => (await listStories(id)) as any,
  );
  const me = useMe();

  createEffect(() => {
    const s = stories();
    if (s) props.onLoaded?.(s);
  });

  const [uploading] = createSignal(false);
  const [openComposer, setOpenComposer] = createSignal(false);
  const [selectedFiles, setSelectedFiles] = createSignal<File[]>([]);
  const [viewerIndex, setViewerIndex] = createSignal<number | null>(null);

  // 著者ごとにグルーピングし、最新アクティビティ順。自分のグループを先頭へ。
  const groups = createMemo(() => {
    const list = stories() || [];
    const byAuthor = new Map<
      string,
      { authorId: string; items: Story[]; firstIndex: number }
    >();
    list.forEach((s, idx) => {
      const key = s.author_id;
      const cur = byAuthor.get(key);
      if (cur) {
        cur.items.push(s);
      } else {
        byAuthor.set(key, { authorId: key, items: [s], firstIndex: idx });
      }
    });
    // 各グループ内は古い→新しい
    for (const g of byAuthor.values()) {
      g.items.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    }
    const gs = Array.from(byAuthor.values());
    // グループ自体は最新投稿の新しい順
    gs.sort((
      a,
      b,
    ) => (a.items[a.items.length - 1].created_at <
        b.items[b.items.length - 1].created_at
      ? 1
      : -1)
    );
    // 自分のグループを先頭へ
    const myId = me()?.id;
    if (myId) {
      const idx = gs.findIndex((g) => g.authorId === myId);
      if (idx > 0) {
        const [myG] = gs.splice(idx, 1);
        gs.unshift(myG);
      }
    }
    return gs;
  });

  // 著者のプロフィールをまとめて取得
  const [authorMap] = createResource(() => groups(), async (gs) => {
    const ids = Array.from(
      new Set((gs || []).map((g) => g.authorId)),
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
    const input = e.target;
    const files = input.files;
    if (!files || files.length === 0) return;
    setSelectedFiles([...files]);
    setOpenComposer(true);
    input.value = "";
  };

  return (
    <div className="border-y bg-white dark:bg-neutral-900">
      <div className="px-3 py-2 text-sm text-gray-500 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-xs px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 cursor-pointer">
            {uploading() ? "アップロード中…" : "追加"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onPick}
            />
          </label>
          <button
            className="text-xs px-2 py-1 rounded-full bg-gray-900 text-white"
            onClick={() => setOpenComposer(true)}
          >
            エディタ
          </button>
        </div>
      </div>
      <div className="px-2 pb-4 overflow-x-auto">
        <div className="flex gap-4">
          <For each={groups()}>
            {(g) => {
              const author = () => authorMap()?.get(g.authorId);
              const isMe = () => me()?.id && g.authorId === me()?.id;
              const latest = g.items[g.items.length - 1];
              const isViewed = () => {
                const map = getStoryViewedMap();
                const viewedAt = map[g.authorId];
                return viewedAt && latest?.created_at &&
                  viewedAt >= latest.created_at;
              };
              return (
                <button
                  className="flex-shrink-0 flex flex-col items-center gap-1"
                  onClick={() => {
                    setViewerIndex(g.firstIndex);
                    const createdAt = typeof latest.created_at === 'string' ? latest.created_at : latest.created_at.toISOString();
                    markStoriesViewed(g.authorId, createdAt);
                  }}
                >
                  <div
                    class={"p-[3px] rounded-full " + (isViewed()
                      ? "bg-gradient-to-tr from-gray-300 to-gray-200"
                      : "bg-gradient-to-tr from-pink-500 via-purple-500 to-yellow-500")}
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
                  <div className="w-20 text-center text-[10px] leading-tight line-clamp-2">
                    {new Date(latest.created_at).toLocaleString()}
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </div>

      <StoryComposer
        open={openComposer()}
        communityId={params.id!}
        onClose={() => {
          setOpenComposer(false);
          setSelectedFiles([]);
        }}
        onCreated={async () => {
          await refetch();
        }}
        initialFiles={selectedFiles()}
      />

      {viewerIndex() !== null && (
        <StoryViewer
          stories={stories() || []}
          startIndex={viewerIndex() ?? 0}
          onClose={() => setViewerIndex(null)}
          onUpdated={async () => {
            await refetch();
          }}
        />
      )}
    </div>
  );
}
