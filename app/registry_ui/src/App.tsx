import { createSignal, onMount, Show } from "solid-js";
import { req } from "./api.ts";
import LoginFormModal from "./components/LoginFormModal.tsx";
import NavHeader from "./components/NavHeader.tsx";
import PublicNavHeader from "./components/PublicNavHeader.tsx";
import DomainSection from "./components/DomainSection.tsx";
import PackageSection from "./components/PackageSection.tsx";
import PackageBrowser from "./components/PackageBrowser.tsx";
import Footer from "./components/Footer.tsx";

export default function App() {
  const [authed, setAuthed] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<"packages" | "domains">(
    "packages",
  );
  const [showLoginModal, setShowLoginModal] = createSignal(false);

  onMount(async () => {
    try {
      await req("/api/domains");
      setAuthed(true);
    } catch {
      setAuthed(false);
    }
  });

  const handleLogin = () => {
    setShowLoginModal(true);
  };

  const handleLogout = async () => {
    try {
      await req("/api/logout", "POST");
    } catch (err) {
      console.error(err);
    } finally {
      setAuthed(false);
      setActiveTab("packages");
    }
  };

  const handleLoginSuccess = () => {
    setAuthed(true);
    setShowLoginModal(false);
  };

  const handlePublish = () => {
    // パッケージ公開モーダルを開く処理
    console.log("Open publish modal");
  };

  return (
    <div class="min-h-screen bg-gray-900 flex flex-col">
      {/* パブリックビュー（ログインしていない場合） */}
      <Show when={!authed()}>
        <PublicNavHeader onLogin={handleLogin} />{" "}
        {/* パブリックパッケージブラウザー */}
        <main class="flex-1 w-3/4 mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PackageBrowser />
        </main>

        {/* ログインモーダル */}
        <Show when={showLoginModal()}>
          <LoginFormModal
            onClose={() => setShowLoginModal(false)}
            onSuccess={handleLoginSuccess}
          />
        </Show>
      </Show>

      {/* 認証済みビュー */}
      <Show when={authed()}>
        <NavHeader
          isAuthenticated
          onLogout={handleLogout}
          onPublish={handlePublish}
        />

        <main class="flex-1">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* タブナビゲーション */}
            <div class="mb-8">
              <nav class="flex space-x-8 border-b border-gray-700">
                <button
                  type="button"
                  onClick={() => setActiveTab("packages")}
                  class={`py-4 px-1 border-b-2 font-medium text-sm transition-colors duration-200 ${
                    activeTab() === "packages"
                      ? "border-purple-500 text-purple-400"
                      : "border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300"
                  }`}
                >
                  <div class="flex items-center space-x-2">
                    <svg
                      class="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M20 7l-8-4-8 4m16 0l-8 4-8-4m16 0v10l-8 4-8-4V7"
                      />
                    </svg>
                    <span>パッケージ</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("domains")}
                  class={`py-4 px-1 border-b-2 font-medium text-sm transition-colors duration-200 ${
                    activeTab() === "domains"
                      ? "border-purple-500 text-purple-400"
                      : "border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300"
                  }`}
                >
                  <div class="flex items-center space-x-2">
                    <svg
                      class="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9"
                      />
                    </svg>
                    <span>ドメイン</span>
                  </div>
                </button>
              </nav>
            </div>

            {/* コンテンツエリア */}
            <div class="animate-fade-in">
              <Show when={activeTab() === "packages"}>
                <PackageSection />
              </Show>
              <Show when={activeTab() === "domains"}>
                <DomainSection />
              </Show>
            </div>
          </div>
        </main>
      </Show>

      {/* フッター */}
      <Footer />
    </div>
  );
}
