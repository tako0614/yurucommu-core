import { Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { selectedAppState } from "../states/app.ts";
import { Home } from "./Home.tsx";
import Header from "./header/header.tsx";

export function Aplication() {
  const [selectedApp] = useAtom(selectedAppState);

  return (
    <>
      <Header />
      <main class="wrapper">
        <Show when={selectedApp() === "home"}>
          <Home />
        </Show>
      </main>
    </>
  );
}
