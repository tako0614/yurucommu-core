import { Match, onMount, Switch } from "solid-js";
import { useAtom } from "solid-jotai";
import LoginPage from "./pages/LoginPage.tsx";
import AdminPage from "./pages/AdminPage.tsx";
import WelcomePage from "./pages/WelcomePage.tsx";
import { fetchInstances, fetchStatus } from "./api.ts";
import { instancesState, loggedInState } from "./state.ts";

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
    if (path === "/admin" && loggedIn()) {
      await loadInstances();
    }
  });

  return (
    <Switch fallback={<WelcomePage />}>
      <Match when={path === "/auth"}>
        <LoginPage />
      </Match>
      <Match when={path === "/admin"}>
        <AdminPage />
      </Match>
    </Switch>
  );
}
