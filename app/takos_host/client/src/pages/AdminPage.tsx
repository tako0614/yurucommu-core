import { Component, For, onMount, Show } from "solid-js";
import type { Instance } from "../api.ts";

interface AdminPageProps {
  loggedIn: () => boolean;
  instances: () => Instance[];
  host: () => string;
  setHost: (v: string) => void;
  instPassword: () => string;
  setInstPassword: (v: string) => void;
  loadInstances: () => Promise<void>;
  addInstance: (e: SubmitEvent) => Promise<void>;
  delInstance: (host: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminPage: Component<AdminPageProps> = (props) => {
  onMount(async () => {
    if (props.loggedIn()) {
      await props.loadInstances();
    }
  });

  return (
    <div style={{ padding: "1rem", "font-family": "sans-serif" }}>
      <Show
        when={props.loggedIn()}
        fallback={<a href="/auth">ログインしてください</a>}
      >
        <div>
          <button type="button" onClick={props.logout}>
            ログアウト
          </button>
          <h2>インスタンス一覧</h2>
          <ul>
            <For each={props.instances()}>
              {(inst) => (
                <li>
                  {inst.host}
                  <button
                    type="button"
                    onClick={() => props.delInstance(inst.host)}
                  >
                    削除
                  </button>
                </li>
              )}
            </For>
          </ul>
          <h3>追加</h3>
          <form onSubmit={props.addInstance}>
            <div>
              <input
                placeholder="ホスト名"
                value={props.host()}
                onInput={(e) => props.setHost(e.currentTarget.value)}
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="パスワード"
                value={props.instPassword()}
                onInput={(e) => props.setInstPassword(e.currentTarget.value)}
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
