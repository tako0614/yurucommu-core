import { Match, onMount, Switch } from "solid-js";
import { useAtom } from "solid-jotai";
import LoginPage from "./pages/LoginPage.tsx";
import RegisterPage from "./pages/RegisterPage.tsx";
import AdminPage from "./pages/AdminPage.tsx";
import UserPage from "./pages/UserPage.tsx";
import WelcomePage from "./pages/WelcomePage.tsx";
import { fetchInstances, fetchStatus } from "./api.ts";
import { instancesState, loggedInState } from "./state.ts";
import "./index.css";

export default function App() {
  const [loggedIn, setLoggedIn] = useAtom(loggedInState);
  const [, setInstances] = useAtom(instancesState);

  const path = globalThis.location.pathname.replace(/\/$/, "");

  const loadStatus = async () => {
    setLoggedIn(await fetchStatus());
  };

  const loadInstances = async () => {
    setInstances(await fetchInstances());
  };

  onMount(async () => {
    await loadStatus();
    if ((path === "/admin" || path === "/user") && loggedIn()) {
      await loadInstances();
    }
  });

  return (
    <Switch fallback={<WelcomePage />}>
      <Match when={path === "/auth"}>
        <LoginPage />
      </Match>
      <Match when={path === "/signup"}>
        <RegisterPage />
      </Match>
      <Match when={path === "/admin"}>
        <AdminPage />
      </Match>
      <Match when={path === "/user"}>
        <UserPage />
      </Match>
    </Switch>
  );
}
