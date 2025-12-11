import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { getUser, useMe, listMyCommunities } from "../lib/api";
import { getStoryViewedMap, listGlobalStories, listStories, markStoriesViewed, type Story } from "../lib/stories";
import { IconPlus } from "./icons";
import StoryComposer from "./StoryComposer";
import StoryViewer from "./StoryViewer";
import Avatar from "./Avatar";
import { useAsyncResource } from "../lib/useAsyncResource";

type Props = {
  onOpenViewer?: (index: number) => void;
  onLoaded?: (stories: Story[]) => void;
  preferredCommunityId?: string;
};

export default function AllStoriesBar(props: Props) {
  const me = useMe();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [communities] = useAsyncResource(async () => {
    try {
      return await listMyCommunities();
    } catch {
      return [];
    }
  });
  const [stories, { refetch: refetchStories }] = useAsyncResource<Story[], any>(
    () => communities.data,
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

      const globalStories = (await listGlobalStories().catch(() => [])) as Story[];
      addStories(globalStories);

      if (Array.isArray(comms)) {
        const lists = await Promise.all(comms.map((c: any) => listStories(c.id).catch(() => [])));
        for (const list of lists) addStories(list as Story[]);
      }

      merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return merged;
    },
  );

  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [viewerStories, setViewerStories] = useState<Story[] | null>(null);
  const [viewerAuthor, setViewerAuthor] = useState<any | null>(null);
  const [viewedMap, setViewedMap] = useState<Record<string, string>>(getStoryViewedMap());

  useEffect(() => {
    if (stories.data) props.onLoaded?.(stories.data);
  }, [stories.data, props]);

  useEffect(() => {
    stories.data;
    setViewedMap(getStoryViewedMap());
  }, [stories.data]);

  const groups = useMemo(() => {
    const list = stories.data || [];
    const byAuthor = new Map<string, Story[]>();
    for (const s of list) {
      const key = s.author_id;
      const arr = byAuthor.get(key) || [];
      arr.push(s);
      byAuthor.set(key, arr);
    }
    for (const arr of byAuthor.values()) {
      arr.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    }
    const gs = Array.from(byAuthor.values());
    gs.sort((ga, gb) => (ga[ga.length - 1].created_at < gb[gb.length - 1].created_at ? 1 : -1));
    const myId = me()?.id;
    if (myId) {
      const idx = gs.findIndex((g) => g[0]?.author_id === myId);
      if (idx > 0) {
        const [myGroup] = gs.splice(idx, 1);
        gs.unshift(myGroup);
      }
    }
    return gs;
  }, [me, stories.data]);

  const groupsToRender = useMemo(() => {
    const gs = groups || [];
    const myId = me()?.id;
    if (!myId) return gs;
    return gs.filter((g) => g[0]?.author_id !== myId);
  }, [groups, me]);

  const myGroup = useMemo(() => {
    const gs = groups || [];
    const myId = me()?.id;
    if (!myId) return null;
    return gs.find((g) => g[0]?.author_id === myId) || null;
  }, [groups, me]);

  const [authorMap] = useAsyncResource(() => groups, async (gs) => {
    const ids = Array.from(new Set((gs || []).map((g) => g[0]?.author_id).filter(Boolean))) as string[];
    const users = await Promise.all(ids.map((id) => getUser(id).catch(() => null)));
    const map = new Map<string, any>();
    users.forEach((u: any) => {
      if (u && u.id) map.set(u.id, u);
    });
    return map;
  });

  const updateViewedMapState = (authorId?: string, latestCreatedAt?: string) => {
    if (authorId == null || !latestCreatedAt) return;
    setViewedMap((prev) => {
      const current = prev[authorId];
      if (current && current >= latestCreatedAt) return prev;
      return { ...prev, [authorId]: latestCreatedAt };
    });
  };

  const hasMyStory = useMemo(() => {
    const s = stories.data;
    const userId = me()?.id;
    return Boolean(s && userId && s.some((story) => story.author_id === userId));
  }, [stories.data, me]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = input.files;
    if (!files || files.length === 0) return;
    setSelectedFiles([...files]);
    setComposerOpen(true);
    input.value = "";
  };

  return (
    <div className="border-b hairline bg-white dark:bg-neutral-900 mb-3 sm:mb-4">
      <div className="px-2 sm:px-3 lg:px-5 py-3 overflow-x-auto">
        <div className="flex gap-4">
          <div className="shrink-0 flex flex-col items-center gap-1">
            <div className="relative">
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onPick}
              />
              {!hasMyStory ? (
                <button className="cursor-pointer block" onClick={() => uploadInputRef.current?.click()}>
                  <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-white dark:bg-neutral-900 overflow-hidden">
                    <div className="w-full h-full rounded-full overflow-hidden bg-neutral-200">
                      {me()?.avatar_url ? (
                        <Avatar src={me()?.avatar_url ?? undefined} alt="自分" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full grid place-items-center text-gray-600 text-xs">あなた</div>
                      )}
                    </div>
                  </div>
                </button>
              ) : (
                <button
                  className="cursor-pointer block"
                  onClick={() => {
                    const g = myGroup;
                    if (g) {
                      setViewerStories(g);
                      setViewerAuthor(me() || null);
                      const latest = g[g.length - 1];
                      if (latest?.created_at) {
                        const createdAt =
                          typeof latest.created_at === "string" ? latest.created_at : latest.created_at.toISOString();
                        updateViewedMapState(me()?.id ?? "", createdAt);
                        markStoriesViewed(me()?.id || "", createdAt);
                      }
                    }
                  }}
                >
                  <div className={hasMyStory ? "p-[3px] rounded-full bg-linear-to-tr from-pink-500 via-purple-500 to-yellow-500" : ""}>
                    <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-white dark:bg-neutral-900 p-[3px] overflow-hidden">
                      <div className="w-full h-full rounded-full overflow-hidden bg-neutral-200">
                        {me()?.avatar_url ? (
                          <Avatar src={me()?.avatar_url ?? undefined} alt="自分" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full grid place-items-center text-gray-600 text-xs">あなた</div>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              )}
              <button
                className="absolute -bottom-1 -right-1 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center"
                type="button"
                onClick={() => uploadInputRef.current?.click()}
              >
                <IconPlus size={12} className="text-white" />
              </button>
            </div>
          </div>
          {groupsToRender.length > 0 && (
            <>
              {groupsToRender.map((group) => {
                const latest = group[group.length - 1];
                const authorId = group[0]?.author_id;
                const author = authorMap.data?.get(authorId);
                const isMe = me()?.id && authorId === me()?.id;
                const viewedAt = viewedMap[authorId || ""];
                const isViewed = viewedAt && latest?.created_at && viewedAt >= latest.created_at;
                return (
                  <button
                    key={`${authorId}-${latest?.id}`}
                    className="shrink-0 flex flex-col items-center gap-1 active:opacity-80"
                    onClick={() => {
                      setViewerStories(group);
                      setViewerAuthor(author || null);
                      if (authorId && latest?.created_at) {
                        const createdAt =
                          typeof latest.created_at === "string" ? latest.created_at : latest.created_at.toISOString();
                        updateViewedMapState(authorId, createdAt);
                        markStoriesViewed(authorId, createdAt);
                      }
                    }}
                  >
                    <div
                      className={`p-[3px] rounded-full ${
                        isViewed ? "bg-linear-to-tr from-gray-300 to-gray-200" : "bg-linear-to-tr from-pink-500 via-purple-500 to-yellow-500"
                      }`}
                    >
                      <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-white dark:bg-neutral-900 p-[3px]">
                        <div className="w-full h-full rounded-full overflow-hidden bg-neutral-200">
                          {author?.avatar_url || (isMe && me()?.avatar_url) ? (
                            <Avatar
                              src={(author?.avatar_url || me()?.avatar_url) as string}
                              alt="アバター"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full grid place-items-center text-gray-600 text-xs">
                              {isMe ? "あなた" : "ユーザー"}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="w-24 text-center text-[10px] leading-tight line-clamp-2">
                      {isMe ? "あなた" : author?.display_name || "ユーザー"}
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
      <StoryComposer
        open={composerOpen}
        communityId={props.preferredCommunityId ?? null}
        onClose={() => {
          setComposerOpen(false);
          setSelectedFiles([]);
        }}
        onCreated={async () => {
          await refetchStories?.();
        }}
        initialFiles={selectedFiles}
      />
      {viewerStories && (
        <StoryViewer
          stories={viewerStories || []}
          startIndex={0}
          author={viewerAuthor || undefined}
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
      )}
    </div>
  );
}
