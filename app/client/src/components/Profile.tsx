import { createResource, For, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import {
  fetchActivityPubObjects,
  fetchUserProfile,
  followUser,
  unfollowUser,
} from "./microblog/api.ts";
import { PostList } from "./microblog/Post.tsx";
import { UserAvatar } from "./microblog/UserAvatar.tsx";
import { addDm } from "./e2ee/api.ts";
import {
  accounts as accountsAtom,
  activeAccount,
  activeAccountId,
} from "../states/account.ts";
import { profileUserState } from "../states/router.ts";
import { selectedAppState } from "../states/app.ts";
import { selectedRoomState } from "../states/chat.ts";
import { getDomain } from "../utils/config.ts";

export default function Profile() {
  const [username, setUsername] = useAtom(profileUserState);
  const [account] = useAtom(activeAccount);
  const [accounts, setAccounts] = useAtom(accountsAtom);
  const [activeId, setActiveId] = useAtom(activeAccountId);
  const [, setApp] = useAtom(selectedAppState);
  const [, setRoom] = useAtom(selectedRoomState);

  const isOwnProfile = () =>
    account() && `${account()!.userName}@${getDomain()}` === username();

  const [info] = createResource(
    () => username(),
    (name) => (name ? fetchUserProfile(name) : null),
  );
  const [posts] = createResource(
    () => username(),
    async (name) => {
      if (!name) return [];
      const localName = name.includes("@") ? name.split("@")[0] : name;
      const objs = await fetchActivityPubObjects(localName, "Note");
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
    if (acc) setUsername(`${acc.userName}@${getDomain()}`);
  };

  const followTarget = () =>
    info() ? `https://${info()!.domain}/users/${info()!.userName}` : "";

  const followIdentifier = () =>
    info()
      ? info()!.domain === getDomain()
        ? info()!.userName
        : `${info()!.userName}@${info()!.domain}`
      : "";

  const isFollowing = () => {
    const user = account();
    if (!user) return false;
    const target = followTarget();
    return user.following.includes(target);
  };

  const handleFollow = async () => {
    if (!account() || !info()) return;
    const ok = await followUser(followIdentifier(), account()!.userName);
    if (ok) {
      const target = followTarget();
      setAccounts(
        accounts().map((a) =>
          a.id === activeId()
            ? { ...a, following: [...a.following, target] }
            : a
        ),
      );
    }
  };

  const handleUnfollow = async () => {
    if (!account() || !info()) return;
    const ok = await unfollowUser(followIdentifier(), account()!.userName);
    if (ok) {
      const target = followTarget();
      setAccounts(
        accounts().map((a) =>
          a.id === activeId()
            ? { ...a, following: a.following.filter((f) => f !== target) }
            : a
        ),
      );
    }
  };

  const normalizeActor = (actor: string): string => {
    if (actor.startsWith("http")) {
      try {
        const url = new URL(actor);
        const name = url.pathname.split("/").pop()!;
        return `${name}@${url.hostname}`;
      } catch {
        return actor;
      }
    }
    return actor;
  };

  const openDM = async () => {
    const name = username();
    const user = account();
    if (!name || !user) return;
    const handle = normalizeActor(name);
    const ok = await addDm(user.id, handle);
    if (!ok) {
      alert("DMの追加に失敗しました");
      return;
    }
    setRoom(handle);
    setApp("chat");
  };

  return (
    <div class="min-h-screen text-white">
      <div>
        <Show
          when={!info.loading}
          fallback={<div class="p-4">Loading...</div>}
        >
          <Show
            when={info()}
            fallback={<div class="p-4">ユーザーが見つかりません</div>}
          >
            {(info) => (
              <>
                <div class="relative">
                  <div class="h-48 md:h-64 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500" />
                  <div class="absolute -bottom-16 max-w-4xl mx-auto left-0 right-0 px-4 md:px-8">
                    <UserAvatar
                      avatarUrl={info()?.avatarInitial}
                      username={info()?.userName}
                      size="w-32 h-32"
                      className="border-4 border-black"
                    />
                  </div>
                </div>
                <div class="max-w-4xl mx-auto px-4 md:px-8 pt-20 pb-8">
                  <div class="flex items-center justify-between">
                    <div>
                      <h2 class="text-2xl font-bold">{info()?.displayName}</h2>
                      <p class="text-gray-400">
                        {info()?.userName}@{info()?.domain}
                      </p>
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
                    <Show when={!isOwnProfile()}>
                      <div class="flex space-x-2">
                        <button
                          type="button"
                          onClick={openDM}
                          class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm transition-all duration-200"
                        >
                          DM
                        </button>
                        <Show when={isFollowing()}>
                          <button
                            type="button"
                            onClick={handleUnfollow}
                            class="px-4 py-2 bg-gray-600 hover:bg-red-600 text-white rounded-lg text-sm transition-all duration-200"
                          >
                            フォロー中
                          </button>
                        </Show>
                        <Show when={!isFollowing()}>
                          <button
                            type="button"
                            onClick={handleFollow}
                            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-all duration-200"
                          >
                            フォロー
                          </button>
                        </Show>
                      </div>
                    </Show>
                  </div>
                  <div class="flex space-x-6 mt-4 text-gray-400 text-sm">
                    <span>投稿 {info()?.postCount ?? 0}</span>
                    <span>フォロー中 {info()?.followingCount ?? 0}</span>
                    <span>フォロワー {info()?.followersCount ?? 0}</span>
                  </div>
                </div>
                <div class="mt-8 max-w-4xl mx-auto px-4 md:px-8">
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
    </div>
  );
}
