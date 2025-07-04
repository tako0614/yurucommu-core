import { createSignal, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { darkModeState, languageState } from "../states/settings.ts";

export function Settings() {
  const [darkMode, setDarkMode] = useAtom(darkModeState);
  const [language, setLanguage] = useAtom(languageState);
  const [activeTab, setActiveTab] = createSignal<"profile" | "appearance" | "privacy" | "notifications" | "account">("profile");
  
  const [profileData, setProfileData] = createSignal({
    username: "user123",
    displayName: "太郎 田中",
    bio: "ActivityPubでつながる一人用SNSを楽しんでいます！",
    location: "東京, 日本",
    website: "https://example.com",
    avatar: "👤"
  });

  const [notificationSettings, setNotificationSettings] = createSignal({
    mentions: true,
    likes: true,
    reposts: false,
    follows: true,
    messages: true,
    email: false
  });

  const saveProfile = () => {
    // プロフィール保存ロジック
    alert("プロフィールを保存しました！");
  };

  const exportData = () => {
    // データエクスポートロジック
    alert("データのエクスポートを開始します");
  };

  const tabs = [
    { id: "profile", name: "プロフィール", icon: "👤" },
    { id: "appearance", name: "外観", icon: "🎨" },
    { id: "privacy", name: "プライバシー", icon: "🔒" },
    { id: "notifications", name: "通知", icon: "🔔" },
    { id: "account", name: "アカウント", icon: "⚙️" }
  ] as const;

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div class="max-w-6xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <div class="mb-6">
          <h1 class="text-3xl font-bold text-gray-900 dark:text-white">設定</h1>
          <p class="mt-2 text-gray-600 dark:text-gray-400">アカウントと環境設定を管理</p>
        </div>

        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
          <div class="flex border-b border-gray-200 dark:border-gray-700">
            {/* タブナビゲーション */}
            <div class="w-64 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
              <nav class="p-4 space-y-2">
                {tabs.map((tab) => (
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    class={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      activeTab() === tab.id
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                  >
                    <span class="text-xl">{tab.icon}</span>
                    <span class="font-medium">{tab.name}</span>
                  </button>
                ))}
              </nav>
            </div>

            {/* メインコンテンツ */}
            <div class="flex-1 p-6">
              <Show when={activeTab() === "profile"}>
                <div class="space-y-6">
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">プロフィール設定</h2>
                  </div>

                  <div class="flex items-center space-x-6 mb-6">
                    <div class="w-20 h-20 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-3xl font-bold">
                      {profileData().avatar}
                    </div>
                    <div>
                      <button type="button" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium transition-colors">
                        アバターを変更
                      </button>
                      <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">
                        JPG、PNG、またはGIF (最大 2MB)
                      </p>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        ユーザー名
                      </label>
                      <input
                        type="text"
                        value={profileData().username}
                        onInput={(e) => setProfileData(prev => ({ ...prev, username: e.target.value }))}
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        表示名
                      </label>
                      <input
                        type="text"
                        value={profileData().displayName}
                        onInput={(e) => setProfileData(prev => ({ ...prev, displayName: e.target.value }))}
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>

                    <div class="md:col-span-2">
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        自己紹介
                      </label>
                      <textarea
                        value={profileData().bio}
                        onInput={(e) => setProfileData(prev => ({ ...prev, bio: e.target.value }))}
                        rows="3"
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        場所
                      </label>
                      <input
                        type="text"
                        value={profileData().location}
                        onInput={(e) => setProfileData(prev => ({ ...prev, location: e.target.value }))}
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        ウェブサイト
                      </label>
                      <input
                        type="url"
                        value={profileData().website}
                        onInput={(e) => setProfileData(prev => ({ ...prev, website: e.target.value }))}
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>

                  <div class="flex justify-end">
                    <button
                      type="button"
                      onClick={saveProfile}
                      class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                    >
                      変更を保存
                    </button>
                  </div>
                </div>
              </Show>

              <Show when={activeTab() === "appearance"}>
                <div class="space-y-6">
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">外観設定</h2>
                  </div>

                  <div class="space-y-4">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                        テーマ
                      </label>
                      <div class="grid grid-cols-2 gap-4">
                        <button
                          type="button"
                          onClick={() => setDarkMode(false)}
                          class={`p-4 border-2 rounded-lg transition-colors ${
                            !darkMode()
                              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                              : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                        >
                          <div class="w-full h-16 bg-white rounded-lg mb-3 border shadow-sm"></div>
                          <span class="text-sm font-medium text-gray-900 dark:text-white">ライトモード</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDarkMode(true)}
                          class={`p-4 border-2 rounded-lg transition-colors ${
                            darkMode()
                              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                              : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                        >
                          <div class="w-full h-16 bg-gray-800 rounded-lg mb-3 border"></div>
                          <span class="text-sm font-medium text-gray-900 dark:text-white">ダークモード</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        言語設定
                      </label>
                      <select
                        value={language()}
                        onChange={(e) => setLanguage(e.target.value)}
                        class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="ja">日本語</option>
                        <option value="en">English</option>
                        <option value="ko">한국어</option>
                        <option value="zh">中文</option>
                      </select>
                    </div>
                  </div>
                </div>
              </Show>

              <Show when={activeTab() === "notifications"}>
                <div class="space-y-6">
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">通知設定</h2>
                  </div>

                  <div class="space-y-4">
                    {Object.entries(notificationSettings()).map(([key, value]) => (
                      <div class="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                        <div>
                          <h4 class="text-sm font-medium text-gray-900 dark:text-white">
                            {key === "mentions" && "メンション"}
                            {key === "likes" && "いいね"}
                            {key === "reposts" && "リポスト"}
                            {key === "follows" && "フォロー"}
                            {key === "messages" && "メッセージ"}
                            {key === "email" && "メール通知"}
                          </h4>
                          <p class="text-sm text-gray-500 dark:text-gray-400">
                            {key === "mentions" && "あなたがメンションされたとき"}
                            {key === "likes" && "投稿にいいねがついたとき"}
                            {key === "reposts" && "投稿がリポストされたとき"}
                            {key === "follows" && "新しいフォロワー"}
                            {key === "messages" && "新しいダイレクトメッセージ"}
                            {key === "email" && "重要な通知をメールで受信"}
                          </p>
                        </div>
                        <label class="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={value}
                            onChange={(e) => setNotificationSettings(prev => ({ ...prev, [key]: e.target.checked }))}
                            class="sr-only peer"
                          />
                          <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </Show>

              <Show when={activeTab() === "account"}>
                <div class="space-y-6">
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">アカウント管理</h2>
                  </div>

                  <div class="space-y-6">
                    <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                      <h3 class="text-lg font-medium text-blue-900 dark:text-blue-100 mb-2">データのエクスポート</h3>
                      <p class="text-blue-700 dark:text-blue-300 mb-4">
                        すべての投稿、設定、データをダウンロードできます
                      </p>
                      <button
                        type="button"
                        onClick={exportData}
                        class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                      >
                        データをエクスポート
                      </button>
                    </div>

                    <div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                      <h3 class="text-lg font-medium text-yellow-900 dark:text-yellow-100 mb-2">パスワード変更</h3>
                      <p class="text-yellow-700 dark:text-yellow-300 mb-4">
                        定期的なパスワード変更をお勧めします
                      </p>
                      <button
                        type="button"
                        class="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                      >
                        パスワードを変更
                      </button>
                    </div>

                    <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                      <h3 class="text-lg font-medium text-red-900 dark:text-red-100 mb-2">アカウント削除</h3>
                      <p class="text-red-700 dark:text-red-300 mb-4">
                        アカウントを削除すると、すべてのデータが永久に失われます
                      </p>
                      <button
                        type="button"
                        class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                      >
                        アカウントを削除
                      </button>
                    </div>
                  </div>
                </div>
              </Show>

              <Show when={activeTab() === "privacy"}>
                <div class="space-y-6">
                  <div>
                    <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">プライバシー設定</h2>
                  </div>

                  <div class="space-y-4">
                    <div class="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                      <div>
                        <h4 class="text-sm font-medium text-gray-900 dark:text-white">プロフィールの公開</h4>
                        <p class="text-sm text-gray-500 dark:text-gray-400">他のユーザーがあなたのプロフィールを表示できます</p>
                      </div>
                      <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked class="sr-only peer" />
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    <div class="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
                      <div>
                        <h4 class="text-sm font-medium text-gray-900 dark:text-white">検索での表示</h4>
                        <p class="text-sm text-gray-500 dark:text-gray-400">検索結果にあなたのプロフィールが表示されます</p>
                      </div>
                      <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={false} class="sr-only peer" />
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    <div class="flex items-center justify-between py-3">
                      <div>
                        <h4 class="text-sm font-medium text-gray-900 dark:text-white">アクティビティ状況</h4>
                        <p class="text-sm text-gray-500 dark:text-gray-400">最後にオンラインだった時間を表示</p>
                      </div>
                      <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked class="sr-only peer" />
                        <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
