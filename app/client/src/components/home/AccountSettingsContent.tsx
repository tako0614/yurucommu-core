import {
  Component,
  createEffect,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";
import { Account, isDataUrl } from "./types.ts";
import {
  fetchActivityPubObjects,
  fetchFollowers,
  fetchFollowing,
  fetchUserProfile,
} from "../microblog/api.ts";
import { PostList, UserAvatar } from "../microblog/Post.tsx";

const AccountSettingsContent: Component<{
  accounts: Account[];
  selectedAccountId: string;
  setSelectedAccountId: (id: string) => void;
  addNewAccount: (
    username: string,
    displayName?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  deleteAccount: (id: string) => void;
}> = (props) => {
  const selectedAccount = () =>
    props.accounts.find((account) => account.id === props.selectedAccountId);

  // ローカル編集状態
  const [editingDisplayName, setEditingDisplayName] = createSignal("");
  const [editingUserName, setEditingUserName] = createSignal("");
  const [editingIcon, setEditingIcon] = createSignal(""); // データURLまたはサーバーからの初期値
  const [hasChanges, setHasChanges] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);

  // 投稿数やフォロワー数などの統計情報
  const [postCount, setPostCount] = createSignal(0);
  const [followingCount, setFollowingCount] = createSignal(0);
  const [followerCount, setFollowerCount] = createSignal(0);

  const [activeView, setActiveView] = createSignal<
    "profile" | "posts" | "following" | "followers"
  >("profile");

  const [posts] = createResource(
    () => selectedAccount()?.userName,
    async (username) => {
      if (!username) return [];
      const objs = await fetchActivityPubObjects(username, "Note");
      return objs.map((o) => ({
        id: o.id,
        content: o.content ?? "",
        userName: username,
        displayName: selectedAccount()?.displayName || username,
        authorAvatar: selectedAccount()?.avatarInitial || "",
        createdAt: o.published,
        likes: (o.extra as Record<string, unknown>)?.likes ?? 0,
        retweets: (o.extra as Record<string, unknown>)?.retweets ?? 0,
        replies: (o.extra as Record<string, unknown>)?.replies ?? 0,
      }));
    },
  );

  const [followers] = createResource(
    () => selectedAccount()?.userName,
    async (username) => {
      if (!username) return [];
      return await fetchFollowers(username);
    },
  );

  const [followingList] = createResource(
    () => selectedAccount()?.userName,
    async (username) => {
      if (!username) return [];
      return await fetchFollowing(username);
    },
  );

  // 選択されたアカウントが変更されたときにローカル状態を更新
  createEffect(() => {
    const account = selectedAccount();
    if (account) {
      setActiveView("profile");
      setEditingDisplayName(account.displayName);
      setEditingUserName(account.userName);
      setEditingIcon(account.avatarInitial); // avatarInitialはデータURLまたはサーバーからの初期値
      setHasChanges(false);
      // ユーザー統計情報を取得
      fetchUserProfile(account.userName).then((data) => {
        if (data) {
          setPostCount(data.postCount ?? 0);
          setFollowingCount(data.followingCount ?? 0);
          setFollowerCount(data.followersCount ?? 0);
        } else {
          setPostCount(0);
          setFollowingCount(0);
          setFollowerCount(0);
        }
      }).catch((err) => {
        console.error("failed to load profile", err);
        setPostCount(0);
        setFollowingCount(0);
        setFollowerCount(0);
      });
    }
  });

  const handleSave = async () => {
    const account = selectedAccount();
    if (!account || !hasChanges() || isLoading()) return;

    setIsLoading(true);
    try {
      const updates: Partial<Account> = {};
      if (editingDisplayName() !== account.displayName) {
        updates.displayName = editingDisplayName();
      }
      // userName is immutable after creation - removed from update logic
      if (editingIcon() !== account.avatarInitial) {
        updates.avatarInitial = editingIcon();
      }

      if (Object.keys(updates).length > 0) {
        await props.updateAccount(props.selectedAccountId, updates);
        setHasChanges(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = () => {
    const account = selectedAccount();
    if (!account) return;

    props.deleteAccount(props.selectedAccountId);
    setShowDeleteConfirm(false);
  };

  const checkForChanges = () => {
    const account = selectedAccount();
    if (!account) return;

    const hasDisplayNameChange = editingDisplayName() !== account.displayName;
    const hasIconChange = editingIcon() !== account.avatarInitial;
    setHasChanges(hasDisplayNameChange || hasIconChange);
  };

  // アイコンプレビュー用の関数
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
      // データURLでない場合は、表示名からイニシャルを生成
      const initials = p.displayNameValue?.charAt(0).toUpperCase() || "?";
      return initials.substring(0, 2);
    };
    return <div class={p.class}>{displayIcon()}</div>;
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

  // 編集モード用の状態
  const [isEditing, setIsEditing] = createSignal(false);
  const [showNewAccountModal, setShowNewAccountModal] = createSignal(false);
  const [newAccountForm, setNewAccountForm] = createSignal({
    username: "",
    displayName: "",
    error: "",
  });

  const handleCreateNewAccount = async () => {
    const form = newAccountForm();
    if (!form.username.trim()) {
      setNewAccountForm({ ...form, error: "ユーザー名は必須です" });
      return;
    }

    const result = await props.addNewAccount(form.username, form.displayName);
    if (result.success) {
      setShowNewAccountModal(false);
      setNewAccountForm({ username: "", displayName: "", error: "" });
    } else {
      setNewAccountForm({
        ...form,
        error: result.error || "アカウント作成に失敗しました",
      });
    }
  };

  return (
    <div class="min-h-screen">
      <Show when={selectedAccount()}>
        {/* SNS風のプロフィールレイアウト */}
        <div>
          {/* カバー画像エリア */}
          <div class="relative">
            <div class="h-48 md:h-64 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500">
            </div>

            {/* プロフィール画像 */}
            <div class="absolute -bottom-16 max-w-4xl mx-auto left-0 right-0 px-4 md:px-8">
              <button
                type="button"
                onClick={() =>
                  isEditing() && document.getElementById("file-input")?.click()}
                class="relative group focus:outline-none block"
                disabled={!isEditing()}
              >
                <IconPreview
                  iconValue={editingIcon()}
                  displayNameValue={editingDisplayName()}
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
                id="file-input"
                type="file"
                accept="image/*"
                class="absolute opacity-0 pointer-events-none"
                onInput={handleFileChange}
              />
            </div>
          </div>

          {/* プロフィール情報 */}
          <div class="max-w-4xl mx-auto px-4 md:px-8 pt-20 pb-8">
            {/* 名前・ユーザー名エリア */}
            <div class="mb-6">
              <Show when={!isEditing()}>
                <div class="flex items-center justify-between mb-1">
                  <h2 class="text-2xl md:text-3xl font-bold text-white">
                    {editingDisplayName() || "名前未設定"}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    class="px-4 py-2 bg-white text-black rounded-full font-medium hover:bg-gray-200 transition-colors duration-200 text-sm"
                  >
                    プロフィールを編集
                  </button>
                </div>
                <p class="text-gray-400 text-base md:text-lg">
                  @{editingUserName() || "ユーザー名未設定"}
                </p>
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
                      ユーザー名（変更不可）
                    </label>
                    <div class="relative">
                      <span class="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                        @
                      </span>
                      <div class="w-full bg-gray-800/50 border border-gray-600 rounded-lg pl-8 pr-4 py-3 text-gray-400 cursor-not-allowed">
                        {editingUserName() || "ユーザー名未設定"}
                      </div>
                    </div>
                    <p class="text-xs text-gray-500 mt-1">
                      ユーザー名はアカウント作成後は変更できません
                    </p>
                  </div>

                  {/* 編集時のボタン */}
                  <div class="flex space-x-3 mt-6">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
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
            </div>

            {/* ステータス・統計情報 */}
            <div class="flex items-center space-x-6 text-gray-400 mb-8 text-sm">
              <div class="flex items-center space-x-2">
                <div class="w-2 h-2 bg-green-400 rounded-full"></div>
                <span>オンライン</span>
              </div>
              <span>•</span>
              <span>参加日: 2024年1月</span>
            </div>

            {/* フォロー/フォロワー統計（SNS風） */}
            <div class="flex space-x-6 mb-8">
              <button
                type="button"
                onClick={() => setActiveView("posts")}
                class="text-center"
              >
                <div class="text-xl font-bold text-white">{postCount()}</div>
                <div class="text-sm text-gray-400">投稿</div>
              </button>
              <button
                type="button"
                onClick={() => setActiveView("following")}
                class="text-center"
              >
                <div class="text-xl font-bold text-white">
                  {followingCount()}
                </div>
                <div class="text-sm text-gray-400">フォロー中</div>
              </button>
              <button
                type="button"
                onClick={() => setActiveView("followers")}
                class="text-center"
              >
                <div class="text-xl font-bold text-white">
                  {followerCount()}
                </div>
                <div class="text-sm text-gray-400">フォロワー</div>
              </button>
            </div>

            {/* バイオ/自己紹介エリア */}
            <div class="mb-8">
              <Show when={!isEditing()}>
                <p class="text-gray-300 leading-relaxed">
                  こんにちは！このプラットフォームを楽しんでいます 🚀
                  <br />
                  テクノロジーと創造性を愛する人です。
                </p>
              </Show>
              <Show when={isEditing()}>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    自己紹介
                  </label>
                  <textarea
                    class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder="自己紹介を書いてみましょう..."
                    rows={4}
                  >
                  </textarea>
                </div>
              </Show>
            </div>

            {/* 投稿・フォロー一覧表示 */}
            <Show when={activeView() === "posts"}>
              <div class="mb-8">
                <PostList
                  posts={posts() || []}
                  tab="recommend"
                  handleReply={() => {}}
                  handleRetweet={() => {}}
                  handleLike={() => {}}
                  handleEdit={() => {}}
                  handleDelete={() => {}}
                  formatDate={(d) => new Date(d).toLocaleString("ja-JP")}
                />
              </div>
            </Show>
            <Show when={activeView() === "following"}>
              <div class="space-y-2 mb-8">
                <For each={followingList() || []}>
                  {(u) => (
                    <div class="flex items-center space-x-3">
                      <UserAvatar
                        avatarUrl={u.avatarInitial}
                        username={u.userName}
                        size="w-8 h-8"
                      />
                      <span class="text-sm text-white">{u.displayName}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={activeView() === "followers"}>
              <div class="space-y-2 mb-8">
                <For each={followers() || []}>
                  {(u) => (
                    <div class="flex items-center space-x-3">
                      <UserAvatar
                        avatarUrl={u.avatarInitial}
                        username={u.userName}
                        size="w-8 h-8"
                      />
                      <span class="text-sm text-white">{u.displayName}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* 削除確認（編集時のみ） */}
            <Show when={isEditing() && showDeleteConfirm()}>
              <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3 mb-6">
                <div class="flex items-center space-x-2">
                  <svg
                    class="w-5 h-5 text-red-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                  <h4 class="font-medium text-red-400">
                    アカウントを削除しますか？
                  </h4>
                </div>
                <p class="text-sm text-red-300">
                  この操作は取り消せません。すべてのデータが失われます。
                </p>
                <div class="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    class="flex-1 py-2 px-4 text-sm bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    class="flex-1 py-2 px-4 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    削除する
                  </button>
                </div>
              </div>
            </Show>

            {/* 削除ボタン（編集時のみ） */}
            <Show when={isEditing() && !showDeleteConfirm()}>
              <div class="pt-6 border-t border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  class="text-red-400 hover:text-red-300 text-sm transition-colors duration-200"
                >
                  アカウントを削除
                </button>
              </div>
            </Show>
          </div>

          {/* アカウント切り替えセクション */}
          <div class="border-t border-gray-800/30 mt-12">
            <div class="max-w-4xl mx-auto px-4 md:px-8 py-8">
              <details class="group">
                <summary class="flex items-center justify-between cursor-pointer text-gray-400 hover:text-gray-300 transition-colors duration-200 text-sm font-medium">
                  <div class="flex items-center space-x-2">
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                      />
                    </svg>
                    <span>アカウントを切り替え ({props.accounts.length})</span>
                  </div>
                  <svg
                    class="w-4 h-4 transition-transform duration-200 group-open:rotate-180"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </summary>

                <div class="mt-4 space-y-2">
                  <For
                    each={props.accounts.filter((a) =>
                      a.id !== props.selectedAccountId
                    )}
                  >
                    {(account) => (
                      <button
                        type="button"
                        onClick={() => props.setSelectedAccountId(account.id)}
                        class="w-full flex items-center space-x-3 p-3 rounded-lg bg-gray-900/30 hover:bg-gray-800/50 text-left transition-all duration-200 group border border-gray-800/50 hover:border-gray-700/50"
                      >
                        <IconPreview
                          iconValue={account.avatarInitial}
                          displayNameValue={account.displayName}
                          class="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0"
                        />
                        <div class="min-w-0 flex-1">
                          <p class="text-sm font-medium text-gray-300 group-hover:text-white transition-colors duration-200 truncate">
                            {account.displayName}
                          </p>
                          <p class="text-xs text-gray-500 truncate">
                            @{account.userName}
                          </p>
                        </div>
                        <svg
                          class="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors duration-200"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>
                    )}
                  </For>
                  <button
                    type="button"
                    onClick={() => setShowNewAccountModal(true)}
                    class="w-full flex items-center space-x-3 p-3 rounded-lg border border-dashed border-gray-700/50 hover:border-gray-600/50 hover:bg-gray-800/20 text-left transition-all duration-200 group"
                  >
                    <div class="h-8 w-8 rounded-full bg-gray-800/50 group-hover:bg-gray-700/50 flex items-center justify-center flex-shrink-0 transition-all duration-200">
                      <svg
                        class="h-4 w-4 text-gray-500 group-hover:text-gray-400 transition-colors duration-200"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                        />
                      </svg>
                    </div>
                    <div>
                      <p class="text-sm font-medium text-gray-400 group-hover:text-gray-300 transition-colors duration-200">
                        新しいアカウントを追加
                      </p>
                      <p class="text-xs text-gray-600">
                        別のアカウントでログイン
                      </p>
                    </div>
                  </button>
                </div>
              </details>
            </div>
          </div>
        </div>
      </Show>

      {/* 新しいアカウント作成モーダル */}
      <Show when={showNewAccountModal()}>
        <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div class="bg-gray-900 rounded-lg max-w-md w-full p-6 space-y-4">
            <h3 class="text-xl font-bold text-white">新しいアカウントを作成</h3>

            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  ユーザー名 *
                </label>
                <div class="relative">
                  <span class="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                    @
                  </span>
                  <input
                    type="text"
                    class="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="ユーザー名を入力"
                    value={newAccountForm().username}
                    onInput={(e) =>
                      setNewAccountForm({
                        ...newAccountForm(),
                        username: e.currentTarget.value,
                        error: "",
                      })}
                  />
                </div>
                <p class="text-xs text-gray-500 mt-1">
                  ユーザー名は作成後変更できません
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  表示名
                </label>
                <input
                  type="text"
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="表示名を入力（省略可）"
                  value={newAccountForm().displayName}
                  onInput={(e) =>
                    setNewAccountForm({
                      ...newAccountForm(),
                      displayName: e.currentTarget.value,
                      error: "",
                    })}
                />
              </div>

              <Show when={newAccountForm().error}>
                <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p class="text-sm text-red-400">{newAccountForm().error}</p>
                </div>
              </Show>
            </div>

            <div class="flex space-x-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowNewAccountModal(false);
                  setNewAccountForm({
                    username: "",
                    displayName: "",
                    error: "",
                  });
                }}
                class="flex-1 py-2 px-4 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleCreateNewAccount}
                disabled={!newAccountForm().username.trim()}
                class={`flex-1 py-2 px-4 rounded-lg transition-colors ${
                  newAccountForm().username.trim()
                    ? "bg-blue-500 text-white hover:bg-blue-600"
                    : "bg-gray-700 text-gray-400 cursor-not-allowed"
                }`}
              >
                作成
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default AccountSettingsContent;
