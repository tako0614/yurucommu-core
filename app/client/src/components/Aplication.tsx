import { Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { selectedAppState } from "../states/app.ts";
import { Home } from "./Home.tsx";
import { Microblog } from "./Microblog.tsx";
import { Chat } from "./Chat.tsx";
import { Videos } from "./Videos.tsx";
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
        <Show when={selectedApp() === "microblog"}>
          <Microblog />
        </Show>
        <Show when={selectedApp() === "chat"}>
          <Chat />
        </Show>
        <Show when={selectedApp() === "videos"}>
          <Videos />
        </Show>
      </main>
    </>
  );
}
