import { Component, For, onMount, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import {
  addInstance as apiAddInstance,
  deleteInstance as apiDeleteInstance,
  fetchInstances,
  logout as apiLogout,
} from "../api.ts";
import {
  hostState,
  instancesState,
  instPasswordState,
  loggedInState,
} from "../state.ts";

const AdminPage: Component = () => {
  const [loggedIn, setLoggedIn] = useAtom(loggedInState);
  const [instances, setInstances] = useAtom(instancesState);
  const [host, setHost] = useAtom(hostState);
  const [instPassword, setInstPassword] = useAtom(instPasswordState);

  const loadInstances = async () => {
    setInstances(await fetchInstances());
  };

  const addInstance = async (e: SubmitEvent) => {
    e.preventDefault();
    if (await apiAddInstance(host(), instPassword())) {
      setHost("");
      setInstPassword("");
      await loadInstances();
    } else {
      alert("failed");
    }
  };

  const delInstance = async (h: string) => {
    if (!confirm(`delete ${h}?`)) return;
    if (await apiDeleteInstance(h)) {
      await loadInstances();
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
    <div style={{ padding: "1rem", "font-family": "sans-serif" }}>
      <Show
        when={loggedIn()}
        fallback={<a href="/auth">ログインしてください</a>}
      >
        <div>
          <button type="button" onClick={logout}>
            ログアウト
          </button>
          <h2>インスタンス一覧</h2>
          <ul>
            <For each={instances()}>
              {(inst) => (
                <li>
                  {inst.host}
                  <button
                    type="button"
                    onClick={() => delInstance(inst.host)}
                  >
                    削除
                  </button>
                </li>
              )}
            </For>
          </ul>
          <h3>追加</h3>
          <form onSubmit={addInstance}>
            <div>
              <input
                placeholder="ホスト名"
                value={host()}
                onInput={(e) => setHost(e.currentTarget.value)}
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="パスワード"
                value={instPassword()}
                onInput={(e) => setInstPassword(e.currentTarget.value)}
              />
            </div>
            <button type="submit">追加</button>
          </form>
        </div>
      </Show>
    </div>
  );
};

export default AdminPage;
