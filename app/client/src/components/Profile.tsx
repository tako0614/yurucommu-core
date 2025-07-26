import { createResource, For, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { fetchActivityPubObjects, fetchUserProfile } from "./microblog/api.ts";
import { PostList } from "./microblog/Post.tsx";
import { UserAvatar } from "./microblog/UserAvatar.tsx";
import {
  accounts as accountsAtom,
  activeAccount,
  activeAccountId,
} from "../states/account.ts";
import { profileUserState } from "../states/router.ts";

export default function Profile() {
  const [username, setUsername] = useAtom(profileUserState);
  const [account] = useAtom(activeAccount);
  const [accounts] = useAtom(accountsAtom);
  const [activeId, setActiveId] = useAtom(activeAccountId);

  const isOwnProfile = () => account()?.userName === username();

  const [info] = createResource(() => username(), fetchUserProfile);
  const [posts] = createResource(
    () => username(),
    async (name) => {
      if (!name) return [];
      const objs = await fetchActivityPubObjects(name, "Note");
      const displayName = info()?.displayName || name;
      const avatar = info()?.avatarInitial || "";
      return objs.map((o) => ({
        id: o.id,
        content: o.content ?? "",
        userName: name,
        displayName,
        authorAvatar: avatar,
        createdAt: o.published,
        likes: typeof (o.extra as Record<string, unknown>)?.likes === "number"
          ? (o.extra as Record<string, unknown>)?.likes as number
          : 0,
        retweets:
          typeof (o.extra as Record<string, unknown>)?.retweets === "number"
            ? (o.extra as Record<string, unknown>)?.retweets as number
            : 0,
        replies:
          typeof (o.extra as Record<string, unknown>)?.replies === "number"
            ? (o.extra as Record<string, unknown>)?.replies as number
            : 0,
      }));
    },
  );

  const formatDate = (d: string) => new Date(d).toLocaleString("ja-JP");

  const handleSwitch = (id: string) => {
    setActiveId(id);
    const acc = accounts().find((a) => a.id === id);
    if (acc) setUsername(acc.userName);
  };

  return (
    <div class="min-h-screen text-white">
      <Show
        when={!info.loading}
        fallback={<div class="p-4">Loading...</div>}
      >
        <Show
          when={info()}
          fallback={<div class="p-4">ユーザーが見つかりません</div>}
        >
          {(data) => (
            <>
              <div class="relative">
                <div class="h-48 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500" />
                <div class="absolute -bottom-16 left-4">
                  <UserAvatar
                    avatarUrl={data.avatarInitial}
                    username={data.userName}
                    size="w-32 h-32"
                  />
                </div>
              </div>
              <div class="pt-20 px-4">
                <div class="flex items-center justify-between">
                  <div>
                    <h2 class="text-2xl font-bold">{data.displayName}</h2>
                    <p class="text-gray-400">@{data.userName}</p>
                  </div>
                  <Show when={isOwnProfile()}>
                    <select
                      value={activeId() || ""}
                      onChange={(e) => handleSwitch(e.currentTarget.value)}
                      class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
                    >
                      <For each={accounts()}>
                        {(a) => <option value={a.id}>{a.displayName}</option>}
                      </For>
                    </select>
                  </Show>
                </div>
                <div class="flex space-x-6 mt-4 text-gray-400 text-sm">
                  <span>投稿 {data.postCount}</span>
                  <span>フォロー中 {data.followingCount}</span>
                  <span>フォロワー {data.followersCount}</span>
                </div>
              </div>
              <div class="mt-8 px-4">
                <PostList
                  posts={posts() || []}
                  tab="latest"
                  handleReply={() => {}}
                  handleRetweet={() => {}}
                  handleQuote={() => {}}
                  handleLike={() => {}}
                  handleEdit={() => {}}
                  handleDelete={() => {}}
                  formatDate={formatDate}
                />
              </div>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
