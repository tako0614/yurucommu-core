import { createEffect, createSignal, onMount, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { selectedAppState } from "../states/app.ts";
import { selectedRoomState } from "../states/chat.ts";
import { activeAccount } from "../states/account.ts";
import { Home } from "./Home.tsx";
import Profile from "./Profile.tsx";
import { Microblog } from "./Microblog.tsx";
import { Chat } from "./Chat.tsx";
import { Videos } from "./Videos.tsx";
import UnifiedToolsContent from "./home/UnifiedToolsContent.tsx";
import Header from "./header/header.tsx";
import { connectWebSocket, registerUser } from "../utils/ws.ts";
import { getDomain } from "../utils/config.ts";

interface ApplicationProps {
  onShowEncryptionKeyForm?: () => void;
}

export function Application(props: ApplicationProps) {
  const [selectedApp] = useAtom(selectedAppState);
  const [selectedRoom] = useAtom(selectedRoomState);
  const [account] = useAtom(activeAccount);
  const [isMobile, setIsMobile] = createSignal(false);

  // モバイルかどうかを判定
  onMount(() => {
    const checkMobile = () => {
      setIsMobile(globalThis.innerWidth <= 768);
    };

    checkMobile();
    globalThis.addEventListener("resize", checkMobile);
    connectWebSocket();

    return () => globalThis.removeEventListener("resize", checkMobile);
  });

  createEffect(() => {
    const user = account();
    if (user) {
      registerUser(`${user.userName}@${getDomain()}`);
    }
  });

  // チャットページかつスマホ版かつチャンネルが選択されている場合にヘッダーが非表示の場合のクラス名を生成
  const wrapperClass = () => {
    const headerHidden = selectedApp() === "chat" && isMobile() &&
      selectedRoom() !== null;
    return [
      "flex flex-col flex-1 box-border overflow-y-auto min-h-dvh h-dvh",
      isMobile() ? "p-0 pb-16 overflow-x-clip" : "pl-[78px]",
      headerHidden && "pb-0",
    ]
      .filter(Boolean)
      .join(" ");
  };

  return (
    <>
      <Header />
      <main class={wrapperClass()}>
        <Show when={selectedApp() === "home"}>
          <Home onShowEncryptionKeyForm={props.onShowEncryptionKeyForm} />
        </Show>
        <Show when={selectedApp() === "profile"}>
          <Profile />
        </Show>
        <Show when={selectedApp() === "microblog"}>
          <Microblog />
        </Show>
        <Show when={selectedApp() === "chat"}>
          <Chat onShowEncryptionKeyForm={props.onShowEncryptionKeyForm} />
        </Show>
        <Show when={selectedApp() === "tools"}>
          <div class="text-gray-100">
            <div class="p-6">
              <UnifiedToolsContent />
            </div>
          </div>
        </Show>
        <Show when={selectedApp() === "videos"}>
          <Videos />
        </Show>
      </main>
    </>
  );
}
