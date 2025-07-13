import { createSignal, For, onMount, Show } from "solid-js";

interface Instance {
  host: string;
}

export default function App() {
  const [loggedIn, setLoggedIn] = createSignal(false);
  const [userName, setUserName] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [instances, setInstances] = createSignal<Instance[]>([]);
  const [host, setHost] = createSignal("");
  const [instPassword, setInstPassword] = createSignal("");

  const fetchStatus = async () => {
    const res = await fetch("/auth/status");
    if (res.ok) {
      const data = await res.json();
      setLoggedIn(data.login);
    }
  };

  const loadInstances = async () => {
    const res = await fetch("/admin/instances");
    if (res.ok) {
      const data = await res.json();
      setInstances(data);
    }
  };

  onMount(async () => {
    await fetchStatus();
    if (loggedIn()) {
      await loadInstances();
    }
  });

  const login = async (e: Event) => {
    e.preventDefault();
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: userName(), password: password() }),
    });
    if (res.ok) {
      setLoggedIn(true);
      await loadInstances();
    } else {
      alert("login failed");
    }
  };

  const addInstance = async (e: Event) => {
    e.preventDefault();
    const res = await fetch("/admin/instances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: host(), password: instPassword() }),
    });
    if (res.ok) {
      setHost("");
      setInstPassword("");
      await loadInstances();
    } else {
      alert("failed");
    }
  };

  const delInstance = async (h: string) => {
    if (!confirm(`delete ${h}?`)) return;
    const res = await fetch(`/admin/instances/${h}`, { method: "DELETE" });
    if (res.ok) {
      await loadInstances();
    }
  };

  const logout = async () => {
    await fetch("/auth/logout", { method: "DELETE" });
    setLoggedIn(false);
  };

  return (
    <div style={{ padding: "1rem", "font-family": "sans-serif" }}>
      <Show
        when={loggedIn()}
        fallback={
          <form onSubmit={login}>
            <div>
              <input
                placeholder="ユーザー名"
                value={userName()}
                onInput={(e) => setUserName(e.currentTarget.value)}
              />
            </div>
            <div>
              <input
                type="password"
                placeholder="パスワード"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
            </div>
            <button type="submit">ログイン</button>
          </form>
        }
      >
        <div>
          <button type="button" onClick={logout}>ログアウト</button>
          <h2>インスタンス一覧</h2>
          <ul>
            <For each={instances()}>
              {(inst) => (
                <li>
                  {inst.host}
                  <button type="button" onClick={() => delInstance(inst.host)}>
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
}
