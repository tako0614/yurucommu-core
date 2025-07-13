import { createSignal, Match, onMount, Switch } from "solid-js";
import LoginPage from "./pages/LoginPage.tsx";
import AdminPage from "./pages/AdminPage.tsx";
import WelcomePage from "./pages/WelcomePage.tsx";
import {
  addInstance as apiAddInstance,
  deleteInstance as apiDeleteInstance,
  fetchInstances,
  fetchStatus,
  Instance,
  login as apiLogin,
  logout as apiLogout,
} from "./api.ts";

export default function App() {
  const [loggedIn, setLoggedIn] = createSignal(false);
  const [userName, setUserName] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [instances, setInstances] = createSignal<Instance[]>([]);
  const [host, setHost] = createSignal("");
  const [instPassword, setInstPassword] = createSignal("");

  const path = globalThis.location.pathname.replace(/\/$/, "");

  const loadStatus = async () => {
    setLoggedIn(await fetchStatus());
  };

  const loadInstances = async () => {
    setInstances(await fetchInstances());
  };

  onMount(async () => {
    await loadStatus();
    if (path === "/admin" && loggedIn()) {
      await loadInstances();
    }
  });

  const login = async (e: SubmitEvent) => {
    e.preventDefault();
    if (await apiLogin(userName(), password())) {
      setLoggedIn(true);
      globalThis.location.href = "/admin";
    } else {
      alert("login failed");
    }
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

  return (
    <Switch fallback={<WelcomePage loggedIn={loggedIn} />}>
      <Match when={path === "/auth"}>
        <LoginPage
          userName={userName}
          setUserName={setUserName}
          password={password}
          setPassword={setPassword}
          login={login}
        />
      </Match>
      <Match when={path === "/admin"}>
        <AdminPage
          loggedIn={loggedIn}
          instances={instances}
          host={host}
          setHost={setHost}
          instPassword={instPassword}
          setInstPassword={setInstPassword}
          loadInstances={loadInstances}
          addInstance={addInstance}
          delInstance={delInstance}
          logout={logout}
        />
      </Match>
    </Switch>
  );
}
