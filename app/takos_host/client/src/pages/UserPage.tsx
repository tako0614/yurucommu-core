import { Component, createSignal, For, onMount, Show } from "solid-js";
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
    if (await apiAddInstance(host())) {
      setHost("");
      setShowAdd(false);
      await loadInstances();
    } else {
      alert("追加に失敗しました");
    }
  };

  const delInstance = async (h: string) => {
    if (!confirm(`${h} を削除します。よろしいですか？`)) return;
    if (await apiDeleteInstance(h)) {
      await loadInstances();
      if (selected() === h) setSelected(null);
    }
  };

  const changePassword = async () => {
    if (!selected()) return;
    if (await updateInstancePassword(selected()!, newPassword() || undefined)) {
      alert("パスワードを変更しました");
      setNewPassword("");
    } else {
      alert("失敗しました");
    }
  };

  const restart = async () => {
    if (!selected()) return;
    if (await restartInstance(selected()!)) {
      alert("再起動しました");
    }
  };

  const logout = async () => {
    await apiLogout();
    setLoggedIn(false);
    globalThis.location.href = "/";
  };

  onMount(async () => {
    if (loggedIn()) {
      await loadInstances();
    }
  });

  return (
    <div class="min-h-screen flex flex-col bg-[#181818] text-gray-100">
      <header class="border-b border-gray-700 p-4">
        <div class="max-w-5xl mx-auto flex justify-between items-center">
          <h1 class="text-xl font-semibold">
            takos host ユーザーダッシュボード
          </h1>
          <button
            type="button"
            class="px-3 py-1 bg-gray-700 rounded-md hover:bg-gray-600"
            onClick={logout}
          >
            ログアウト
          </button>
        </div>
      </header>
      <main class="flex-grow max-w-5xl mx-auto w-full p-6 space-y-12">
        <Show
          when={loggedIn()}
          fallback={<a href="/auth">ログインしてください</a>}
        >
          <section>
            <div class="flex justify-between items-center mb-4">
              <h2 class="text-lg font-bold">インスタンス一覧</h2>
              <button
                type="button"
                class="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                onClick={() => {
                  setHost("");
                  setShowAdd(true);
                }}
              >
                新規追加
              </button>
            </div>
            <Show when={showAdd()}>
              <div class="fixed inset-0 flex items-center justify-center bg-black/50">
                <form
                  onSubmit={addInstance}
                  class="bg-[#212121] p-6 rounded-lg space-y-4"
                >
                  <h3 class="text-lg font-bold">インスタンス追加</h3>
                  <input
                    placeholder={`*.${rootDomain()}`}
                    value={host()}
                    onInput={(e) => setHost(e.currentTarget.value)}
                    class="w-64 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                  <div class="flex justify-end gap-2">
                    <button
                      type="button"
                      class="px-4 py-2 bg-gray-600 rounded-md hover:bg-gray-500"
                      onClick={() => setShowAdd(false)}
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      追加
                    </button>
                  </div>
                </form>
              </div>
            </Show>
            <ul class="space-y-4">
              <For each={instances()}>
                {(inst) => (
                  <li class="bg-[#212121] p-4 rounded-lg shadow">
                    <div class="flex justify-between items-center">
                      <span class="font-semibold">{inst.host}</span>
                      <div class="space-x-2">
                        <button
                          type="button"
                          class="text-sm text-blue-400 hover:underline"
                          onClick={() => openDetail(inst.host)}
                        >
                          詳細
                        </button>
                        <button
                          type="button"
                          class="text-sm text-red-400 hover:underline"
                          onClick={() => delInstance(inst.host)}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    <Show when={selected() === inst.host}>
                      <div class="mt-4 space-y-6">
                        <div>
                          <label class="block text-sm font-medium mb-2">
                            パスワード設定 / 変更
                          </label>
                          <div class="flex gap-2">
                            <input
                              type="password"
                              class="flex-grow px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              value={newPassword()}
                              onInput={(e) =>
                                setNewPassword(e.currentTarget.value)}
                            />
                            <button
                              type="button"
                              class="bg-blue-600 text-white px-3 py-1 rounded-md hover:bg-blue-700"
                              onClick={changePassword}
                            >
                              更新
                            </button>
                          </div>
                        </div>
                        <div class="flex gap-4">
                          <button
                            type="button"
                            class="bg-gray-600 text-white px-3 py-1 rounded-md hover:bg-gray-500"
                            onClick={restart}
                          >
                            再起動
                          </button>
                        </div>
                      </div>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
      </main>
      <footer class="py-6 border-t border-gray-700 text-center">
        <a href="/" class="text-gray-400 hover:text-gray-200">戻る</a>
      </footer>
    </div>
  );
};

export default UserPage;
