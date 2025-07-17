import { Component, createSignal, For, onMount, Show } from "solid-js";
import { Motion } from "@motionone/solid";
import { useAtom } from "solid-jotai";
import {
  addInstance as apiAddInstance,
  deleteInstance as apiDeleteInstance,
  fetchInstances,
  logout as apiLogout,
  restartInstance,
  updateInstancePassword,
} from "../api.ts";
import {
  hostState,
  instancesState,
  loggedInState,
  rootDomainState,
} from "../state.ts";

const UserPage: Component = () => {
  const [loggedIn, setLoggedIn] = useAtom(loggedInState);
  const [instances, setInstances] = useAtom(instancesState);
  const [host, setHost] = useAtom(hostState);
  const [rootDomain] = useAtom(rootDomainState);
  const [showAdd, setShowAdd] = createSignal(false);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [newPassword, setNewPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);

  const loadInstances = async () => {
    setInstances(await fetchInstances());
  };

  const openDetail = (h: string) => {
    if (selected() === h) {
      setSelected(null);
      return;
    }
    setNewPassword("");
    setSelected(h);
  };

  const addInstance = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    if (await apiAddInstance(host())) {
      setHost("");
      setShowAdd(false);
      await loadInstances();
    } else {
      setError("インスタンス追加に失敗しました");
    }
    setIsLoading(false);
  };

  const delInstance = async (h: string) => {
    if (!confirm(`${h} を削除します。よろしいですか？`)) return;
    setError("");
    setIsLoading(true);
    if (await apiDeleteInstance(h)) {
      await loadInstances();
      if (selected() === h) setSelected(null);
    } else {
      setError("削除に失敗しました");
    }
    setIsLoading(false);
  };

  const changePassword = async () => {
    if (!selected()) return;
    setError("");
    setIsLoading(true);
    if (await updateInstancePassword(selected()!, newPassword() || undefined)) {
      setNewPassword("");
      setError("");
    } else {
      setError("パスワード変更に失敗しました");
    }
    setIsLoading(false);
  };

  const restart = async () => {
    if (!selected()) return;
    setError("");
    setIsLoading(true);
    if (await restartInstance(selected()!)) {
      setError("");
    } else {
      setError("再起動に失敗しました");
    }
    setIsLoading(false);
  };

  const logout = async () => {
    setIsLoading(true);
    await apiLogout();
    setLoggedIn(false);
    globalThis.location.href = "/";
    setIsLoading(false);
  };

  onMount(async () => {
    if (loggedIn()) {
      await loadInstances();
    }
  });

  return (
    <div class="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-[#202020] via-[#181818] to-black text-gray-100 px-4">
      <div class="w-full flex flex-col items-center justify-center">
        {/* error banner */}
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

        {/* main card */}
        <main class="w-full max-w-md mx-auto flex flex-col gap-8 px-6 py-8">
          <Show when={loggedIn()} fallback={<a href="/auth">ログインしてください</a>}>
            <Motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              class="flex flex-col gap-6"
            >
              {/* modal for add instance */}
              <Show when={showAdd()}>
                <div class="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
                  <Motion.form
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    onSubmit={addInstance}
                    class="bg-[#232323] p-8 rounded-2xl shadow-xl w-full max-w-md space-y-6 border border-white/10"
                  >
                    <h3 class="text-lg font-bold text-center">インスタンス追加</h3>
                    <div class="flex items-center gap-2 justify-center">
                      <input
                        placeholder="サブドメイン名"
                        value={host()}
                        onInput={(e) => setHost(e.currentTarget.value)}
                        class="w-48 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        required
                        disabled={isLoading()}
                      />
                      <span class="text-gray-400">.{rootDomain()}</span>
                    </div>
                    <div class="flex justify-end gap-2">
                      <button
                        type="button"
                        class="px-4 py-2 bg-gray-600 rounded-md hover:bg-gray-500 text-white"
                        onClick={() => setShowAdd(false)}
                        disabled={isLoading()}
                      >
                        キャンセル
                      </button>
                      <button
                        type="submit"
                        class="px-4 py-2 bg-gradient-to-r from-green-500 to-teal-500 text-white rounded-md hover:from-green-400 hover:to-teal-400 font-semibold"
                        disabled={isLoading()}
                      >
                        追加
                        <Show when={isLoading()}>
                          <span class="ml-2 size-4 border-2 border-t-transparent border-white/80 rounded-full animate-spin inline-block align-middle" />
                        </Show>
                      </button>
                    </div>
                  </Motion.form>
                </div>
              </Show>

              {/* instance list (TauriLogin風カードUI) */}
              <div class="w-full flex flex-col gap-4 mb-2 items-center">
                <Show when={instances().length} fallback={<EmptyState />}>
                  <For each={instances()}>{(inst) => (
                    <Motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      class="relative w-full max-w-md overflow-hidden py-5 px-6 bg-[#232323]/80 backdrop-blur border border-white/10 rounded-xl text-lg font-medium text-white hover:bg-green-600/80 transition-all shadow-lg flex flex-col items-center"
                    >
                      <div class="w-full flex justify-between items-center">
                        <a
                          href={`${globalThis.location.protocol}//${inst.host}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="font-semibold hover:underline"
                        >
                          {inst.host}
                        </a>
                        <div class="flex gap-2">
                          <button
                            type="button"
                            class="text-sm text-green-400 hover:underline px-2 py-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
                            onClick={() => openDetail(inst.host)}
                            disabled={isLoading()}
                          >
                            詳細
                          </button>
                          <button
                            type="button"
                            class="text-sm text-red-400 hover:underline px-2 py-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                            onClick={() => delInstance(inst.host)}
                            disabled={isLoading()}
                          >
                            削除
                          </button>
                        </div>
                      </div>
                      <Show when={selected() === inst.host}>
                        <Motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2 }}
                          class="mt-4 space-y-6 w-full"
                        >
                          <div>
                            <label class="block text-sm font-medium mb-2">パスワード設定 / 変更</label>
                            <div class="flex gap-2">
                              <input
                                type="password"
                                class="flex-grow px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                value={newPassword()}
                                onInput={(e) => setNewPassword(e.currentTarget.value)}
                                disabled={isLoading()}
                              />
                              <button
                                type="button"
                                class="bg-gradient-to-r from-green-500 to-teal-500 text-white px-3 py-1 rounded-md hover:from-green-400 hover:to-teal-400 font-semibold"
                                onClick={changePassword}
                                disabled={isLoading()}
                              >
                                更新
                                <Show when={isLoading()}>
                                  <span class="ml-2 size-4 border-2 border-t-transparent border-white/80 rounded-full animate-spin inline-block align-middle" />
                                </Show>
                              </button>
                            </div>
                          </div>
                          <div class="flex gap-4">
                            <button
                              type="button"
                              class="bg-gray-600 text-white px-3 py-1 rounded-md hover:bg-gray-500 font-semibold"
                              onClick={restart}
                              disabled={isLoading()}
                            >
                              再起動
                              <Show when={isLoading()}>
                                <span class="ml-2 size-4 border-2 border-t-transparent border-white/80 rounded-full animate-spin inline-block align-middle" />
                              </Show>
                            </button>
                          </div>
                        </Motion.div>
                      </Show>
                    </Motion.div>
                  )}</For>
                </Show>
              </div>
            </Motion.div>
          </Show>
        </main>

        {/* インスタンス追加ボタンとログアウトボタンを下部中央に配置 */}
        <div class="fixed bottom-20 inset-x-0 flex flex-col items-center justify-center gap-4 z-50">
          <button
            type="button"
            class="group relative inline-flex items-center justify-center gap-2 w-72 py-4 bg-gradient-to-r from-green-500 to-teal-500 hover:from-green-400 hover:to-teal-400 active:scale-95 text-white font-semibold rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 transition-all"
            onClick={() => { setHost(""); setShowAdd(true); }}
            disabled={isLoading()}
          >
            <span class="i-lucide-plus-circle text-xl group-hover:rotate-90 transition-transform" />
            インスタンス追加
          </button>
          <button
            type="button"
            class="group relative inline-flex items-center justify-center gap-2 w-72 py-4 bg-gray-700 hover:bg-gray-600 active:scale-95 text-white font-semibold rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 transition-all"
            onClick={logout}
            disabled={isLoading()}
          >
            <span class="i-lucide-log-out text-xl group-hover:rotate-90 transition-transform" />
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
};

function EmptyState() {
  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      class="flex flex-col items-center gap-4 py-12 text-sm text-gray-400"
    >
      <span class="i-lucide-server size-8 text-gray-500" />
      まだインスタンスがありません
    </Motion.div>
  );
}

export default UserPage;
