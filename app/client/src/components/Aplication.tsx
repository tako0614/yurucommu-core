import { Show, createSignal, onMount } from "solid-js";
import { useAtom } from "solid-jotai";
import { selectedAppState } from "../states/app.ts";
import { selectedRoomState } from "../states/chat.ts";
import { Home } from "./Home.tsx";
import { Microblog } from "./Microblog.tsx";
import { Chat } from "./Chat.tsx";
import { Videos } from "./Videos.tsx";
import Header from "./header/header.tsx";

export function Aplication() {
  const [selectedApp] = useAtom(selectedAppState);
  const [selectedRoom] = useAtom(selectedRoomState);
  const [isMobile, setIsMobile] = createSignal(false);

  // モバイルかどうかを判定
  onMount(() => {
    const checkMobile = () => {
      setIsMobile(globalThis.innerWidth <= 768);
    };
    
    checkMobile();
    globalThis.addEventListener('resize', checkMobile);
    
    return () => globalThis.removeEventListener('resize', checkMobile);
  });

  // チャットページかつスマホ版かつチャンネルが選択されている場合にヘッダーが非表示の場合のクラス名を生成
  const wrapperClass = () => {
    const baseClass = "wrapper";
    const isHeaderHidden = selectedApp() === "chat" && isMobile() && selectedRoom() !== null;
    return isHeaderHidden ? `${baseClass} no-header` : baseClass;
  };

  return (
    <>
      <Header />
      <main class={wrapperClass()}>
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
