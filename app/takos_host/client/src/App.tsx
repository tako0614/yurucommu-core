import { createSignal, onMount } from "solid-js";
import LoginPage from "./pages/LoginPage.tsx";
import AdminPage from "./pages/AdminPage.tsx";
import WelcomePage from "./pages/WelcomePage.tsx";

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

  const path = globalThis.location.pathname.replace(/\/$/, "");

  const fetchStatus = async () => {
    const res = await fetch("/auth/status");
    if (res.ok) {
      const data = await res.json();
      setLoggedIn(data.login);
    } else {
      setLoggedIn(false);
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
    if (path === "/admin" && loggedIn()) {
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
      globalThis.location.href = "/admin";
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
    globalThis.location.href = "/";
  };

  if (path === "/auth") {
    return (
      <LoginPage
        userName={userName}
        setUserName={setUserName}
        password={password}
        setPassword={setPassword}
        login={login}
      />
    );
  }

  if (path === "/admin") {
    return (
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
    );
  }

  return <WelcomePage loggedIn={loggedIn} />;
}
