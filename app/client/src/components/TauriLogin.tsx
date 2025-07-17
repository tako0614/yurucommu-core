import { createSignal, For, onMount, Show } from "solid-js";
import { Motion } from "@motionone/solid";
import { AddServerForm } from "./AddServerForm.tsx";
import {
  addServer,
  apiFetch,
  setActiveServer,
  setApiBase,
} from "../utils/config.ts";

interface TauriLoginProps {
  onLoginSuccess: () => void;
}

type ServerInfo = { url: string; password: string };

/**
 * A polished, accessible login screen for the Tauri desktop build.
 * - Radial gradient background for visual depth
 * - Keyboard-friendly (tab order & focus-ring)
 * - Animated feedback (spinner, subtle fade/scale)
 * - Graceful error banners & empty-state illustration
 * TailwindCSS classes keep the markup terse while MotionOne handles micro-animations.
 */
export function TauriLogin(props: TauriLoginProps) {
  const [servers, setServers] = createSignal<ServerInfo[]>([]);
  const [showAdd, setShowAdd] = createSignal(false);
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);

  /* --- hydrate saved servers ------------------------------------------------ */
  onMount(() => {
    const saved = localStorage.getItem("servers");
    setServers(saved ? (JSON.parse(saved) as ServerInfo[]) : []);
  });

  /* --- handlers ------------------------------------------------------------- */
  const loginToServer = async (url: string, password: string) => {
    setError("");
    if (!url.trim()) {
      setError("サーバーURLを入力してください");
      return;
    }
    if (!password) {
      setError("ログイン用パスワードを入力してください");
      return;
    }

    setApiBase(url);
    addServer(url);
    setActiveServer(url);
    setIsLoading(true);

    try {
      const res = await apiFetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const results = await res.json();
      if (results.success) {
        props.onLoginSuccess();
      } else {
        setError(results.error || "ログインに失敗しました");
      }
    } catch (_err) {
      setError("通信エラーが発生しました");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddServer = (
    url: string,
    password: string,
  ): Promise<void> => {
    const newServer = { url: url.trim(), password };
    const updated = [...servers(), newServer];
    setServers(updated);
    localStorage.setItem("servers", JSON.stringify(updated));
    setShowAdd(false);
  };

  /* --- view ----------------------------------------------------------------- */
  return (
    <div class="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-[#202020] via-[#181818] to-black text-gray-100 px-4">
      {/* header -------------------------------------------------------------- */}
      <Motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        class="text-center mb-10 select-none"
      >
        <h1 class="text-3xl font-bold tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-green-400 to-teal-300">
          Takos
        </h1>
        <p class="text-sm text-gray-400 mt-2">
          ログインするサーバーを選択 / 追加してください
        </p>
      </Motion.div>

      {/* error banner -------------------------------------------------------- */}
      <Show when={error()}>
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          class="w-full max-w-md bg-red-500/20 text-red-200 border border-red-400 rounded-lg px-4 py-3 mb-6 shadow-md"
          role="alert"
        >
          <p class="text-sm font-medium flex items-start gap-2">
            <span class="i-lucide-alert-circle text-lg shrink-0" />
            {error()}
          </p>
        </Motion.div>
      </Show>

      {/* server list --------------------------------------------------------- */}
      <div class="w-full max-w-md flex flex-col gap-4 mb-16">
        <Show when={servers().length} fallback={<EmptyState />}>
          {/** empty state uses its own component */}
          <For each={servers()}>
            {(s) => (
              <ServerButton
                {...s}
                onClick={loginToServer}
                loading={isLoading()}
              />
            )}
          </For>
        </Show>
      </div>

      {/* add server button --------------------------------------------------- */}
      <div class="fixed bottom-6 inset-x-0 flex justify-center">
        <button
          type="button"
          class="group relative inline-flex items-center justify-center gap-2 w-72 py-4 bg-gradient-to-r from-green-500 to-teal-500 hover:from-green-400 hover:to-teal-400 active:scale-95 text-white font-semibold rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 transition-all"
          onClick={() => setShowAdd(true)}
        >
          <span class="i-lucide-plus-circle text-xl group-hover:rotate-90 transition-transform" />
          サーバー追加
        </button>
      </div>

      {/* modal -------------------------------------------------------------- */}
      <Show when={showAdd()}>
        <AddServerForm
          onAdd={handleAddServer}
          onClose={() => setShowAdd(false)}
        />
      </Show>
    </div>
  );
}

/* -------------------------------------------------------------------------*/
function ServerButton(
  props: ServerInfo & {
    onClick: (url: string, pw: string) => void;
    loading: boolean;
  },
) {
  return (
    <button
      type="button"
      disabled={props.loading}
      class="relative w-full overflow-hidden py-5 px-6 bg-[#232323]/80 backdrop-blur border border-white/10 rounded-xl text-lg font-medium text-white hover:bg-green-600/80 disabled:opacity-60 disabled:pointer-events-none transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
      onClick={() => props.onClick(props.url, props.password)}
    >
      {props.url}
      <Show when={props.loading}>
        <span class="absolute right-5 top-1/2 -translate-y-1/2 size-5 border-2 border-t-transparent border-white/80 rounded-full animate-spin">
        </span>
      </Show>
    </button>
  );
}

function EmptyState() {
  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      class="flex flex-col items-center gap-4 py-12 text-sm text-gray-400"
    >
      <span class="i-lucide-server size-8 text-gray-500" />
      まだサーバーが追加されていません
    </Motion.div>
  );
}
