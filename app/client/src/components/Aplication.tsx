import { Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { selectedAppState } from "../states/app.ts";
import { Dashboard } from "./DashBoard.tsx";
import { Setting } from "./Setting/index.tsx";

export function Aplication() {
  const [selectedApp] = useAtom(selectedAppState);

  return (
    <>
      <Show when={selectedApp() === "dashboard"}>
        <Dashboard />
      </Show>
      <Show when={selectedApp() === "settings"}>
        <Setting />
      </Show>
    </>
  );
}
