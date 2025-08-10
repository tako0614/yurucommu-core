import { Component, createResource, createSignal, For, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import {
  fetchActivityPubObjects,
  fetchUserProfile,
  followUser,
  unfollowUser,
} from "./microblog/api.ts";
import { PostList } from "./microblog/Post.tsx";
import { UserAvatar } from "./microblog/UserAvatar.tsx";
import { addRoom } from "./e2ee/api.ts";
import {
  accounts as accountsAtom,
  activeAccount,
  activeAccountId,
} from "../states/account.ts";
import { profileUserState } from "../states/router.ts";
import { selectedAppState } from "../states/app.ts";
import { selectedRoomState } from "../states/chat.ts";
import { apiFetch, getDomain } from "../utils/config.ts";
import { isDataUrl } from "./home/types.ts";

export default function Profile() {
  const [username, setUsername] = useAtom(profileUserState);
  const [account] = useAtom(activeAccount);
  const [accounts, setAccounts] = useAtom(accountsAtom);
  const [activeId, setActiveId] = useAtom(activeAccountId);
  const [, setApp] = useAtom(selectedAppState);
  const [, setRoom] = useAtom(selectedRoomState);

  const isOwnProfile = () =>
    account() && `${account()!.userName}@${getDomain()}` === username();

  const [info, { mutate: mutateInfo }] = createResource(
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

  // プロフィール編集用の状態
  const [isEditing, setIsEditing] = createSignal(false);
  const [editingDisplayName, setEditingDisplayName] = createSignal("");
  const [editingIcon, setEditingIcon] = createSignal("");
  const [hasChanges, setHasChanges] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);

  const checkForChanges = () => {
    const data = info();
    if (!data) return;
    const hasDisplayNameChange = editingDisplayName() !== data.displayName;
    const hasIconChange = editingIcon() !== data.avatarInitial;
    setHasChanges(hasDisplayNameChange || hasIconChange);
  };

  const handleFileChange = (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setEditingIcon(event.target?.result as string);
        checkForChanges();
      };
      reader.readAsDataURL(files[0]);
    }
  };

  const handleSave = async () => {
    if (!isOwnProfile() || !info() || !hasChanges() || isLoading()) return;
    setIsLoading(true);
    try {
      const id = activeId();
      const currentAccount = accounts().find((a) => a.id === id);
      if (!id || !currentAccount) return;
      const payload: Record<string, unknown> = {};
      if (editingDisplayName() !== currentAccount.displayName) {
        payload.displayName = editingDisplayName();
      }
      if (editingIcon() !== currentAccount.avatarInitial) {
        if (isDataUrl(editingIcon())) {
          payload.avatarInitial = editingIcon();
        } else {
          const baseName = editingDisplayName() || currentAccount.displayName;
          payload.avatarInitial = (baseName.charAt(0).toUpperCase() || "?")
            .substring(0, 2);
        }
      } else if (
        editingDisplayName() !== currentAccount.displayName &&
        !isDataUrl(currentAccount.avatarInitial)
      ) {
        payload.avatarInitial =
          (editingDisplayName().charAt(0).toUpperCase() || "?").substring(
            0,
            2,
          );
      }
      if (Object.keys(payload).length === 0) return;
      const res = await apiFetch(`/api/accounts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.id) {
        setAccounts(
          accounts().map((a) =>
            a.id === id
              ? {
                ...a,
                displayName: editingDisplayName(),
                avatarInitial: payload.avatarInitial
                  ? payload.avatarInitial as string
                  : a.avatarInitial,
              }
              : a
          ),
        );
        mutateInfo({
          ...info()!,
          displayName: editingDisplayName(),
          avatarInitial: payload.avatarInitial
            ? payload.avatarInitial as string
            : info()!.avatarInitial,
        });
        setIsEditing(false);
        setHasChanges(false);
      } else {
        console.error("Update failed:", result);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // アイコンプレビューコンポーネント
  const IconPreview: Component<
    { iconValue: string; displayNameValue: string; class?: string }
  > = (p) => {
    const displayIcon = () => {
      const icon = p.iconValue?.trim();
      if (icon && isDataUrl(icon)) {
        return (
          <img
            src={icon}
            alt="icon"
            class="h-full w-full object-cover rounded-full"
          />
        );
      }
      const initials = p.displayNameValue?.charAt(0).toUpperCase() || "?";
      return initials.substring(0, 2);
    };
    return <div class={p.class}>{displayIcon()}</div>;
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
    await addRoom(user.id, { id: handle, name: handle, members: [handle] });
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
                    <Show
                      when={isOwnProfile()}
                      fallback={
                        <UserAvatar
                          avatarUrl={info()?.avatarInitial}
                          username={info()?.userName}
                          size="w-32 h-32"
                          className="border-4 border-black"
                        />
                      }
                    >
                      <button
                        type="button"
                        onClick={() =>
                          isEditing() &&
                          document.getElementById("profile-file")?.click()}
                        class="relative group focus:outline-none block"
                        disabled={!isEditing()}
                      >
                        <IconPreview
                          iconValue={editingIcon() || info()?.avatarInitial ||
                            ""}
                          displayNameValue={editingDisplayName() ||
                            info()?.displayName || ""}
                          class="h-32 w-32 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center text-3xl font-bold border-4 border-black"
                        />
                        <Show when={isEditing()}>
                          <div class="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                            <svg
                              class="w-8 h-8 text-white"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                              />
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                            </svg>
                          </div>
                        </Show>
                      </button>
                      <input
                        id="profile-file"
                        type="file"
                        accept="image/*"
                        class="absolute opacity-0 pointer-events-none"
                        onInput={handleFileChange}
                      />
                    </Show>
                  </div>
                </div>
                <div class="max-w-4xl mx-auto px-4 md:px-8 pt-20 pb-8">
                  <Show when={!isEditing()}>
                    <div class="flex items-center justify-between">
                      <div>
                        <h2 class="text-2xl font-bold">
                          {info()?.displayName}
                        </h2>
                        <p class="text-gray-400">
                          {info()?.userName}@{info()?.domain}
                        </p>
                      </div>
                      <Show when={isOwnProfile()}>
                        <div class="flex space-x-2">
                          <select
                            value={activeId() || ""}
                            onChange={(e) =>
                              handleSwitch(e.currentTarget.value)}
                            class="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
                          >
                            <For each={accounts()}>
                              {(a) => (
                                <option value={a.id}>{a.displayName}</option>
                              )}
                            </For>
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDisplayName(info()?.displayName || "");
                              setEditingIcon(info()?.avatarInitial || "");
                              setIsEditing(true);
                            }}
                            class="px-4 py-2 bg-white text-black rounded-full font-medium hover:bg-gray-200 transition-colors duration-200 text-sm"
                          >
                            プロフィールを編集
                          </button>
                        </div>
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
                  </Show>
                  <Show when={isEditing()}>
                    <div class="space-y-4 max-w-md">
                      <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">
                          表示名
                        </label>
                        <input
                          type="text"
                          class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="表示名を入力"
                          value={editingDisplayName()}
                          onInput={(e) => {
                            setEditingDisplayName(e.currentTarget.value);
                            checkForChanges();
                          }}
                        />
                      </div>
                      <div>
                        <label class="block text-sm font-medium text-gray-300 mb-2">
                          アイコン
                        </label>
                        <div class="flex items-center space-x-4">
                          <button
                            type="button"
                            onClick={() =>
                              document.getElementById("profile-file")?.click()}
                            class="relative group focus:outline-none"
                          >
                            <IconPreview
                              iconValue={editingIcon()}
                              displayNameValue={editingDisplayName()}
                              class="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center text-xl font-bold"
                            />
                            <div class="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                              <svg
                                class="w-6 h-6 text-white"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                                />
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                                />
                              </svg>
                            </div>
                          </button>
                          <p class="text-sm text-gray-400">
                            画像をアップロードしてアイコンを変更
                          </p>
                        </div>
                      </div>
                      <div class="flex space-x-3 mt-6">
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditing(false);
                            setEditingDisplayName(info()?.displayName || "");
                            setEditingIcon(info()?.avatarInitial || "");
                            setHasChanges(false);
                          }}
                          class="px-4 py-2 bg-gray-800 text-white rounded-lg font-medium hover:bg-gray-700 transition-colors duration-200 text-sm border border-gray-600"
                        >
                          キャンセル
                        </button>
                        <button
                          type="button"
                          onClick={handleSave}
                          disabled={!hasChanges() || isLoading()}
                          class={`px-4 py-2 rounded-lg font-medium transition-colors duration-200 text-sm ${
                            hasChanges() && !isLoading()
                              ? "bg-blue-500 text-white hover:bg-blue-600"
                              : "bg-gray-700 text-gray-400 cursor-not-allowed"
                          }`}
                        >
                          {isLoading() ? "保存中..." : "保存"}
                        </button>
                      </div>
                    </div>
                  </Show>
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
