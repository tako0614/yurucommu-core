import { SideBer } from "./sidebar/SideBar.tsx";
import { SetUp } from "./encrypted/SetUp.tsx";
import { EncryptSession } from "./encrypted/EncryptSession.tsx";
import ChatSend from "./talk/send/send.tsx";
import ChatTalkTitle from "./talk/header/ChatTalkTitle.tsx";
import ChatTalkContent from "./talk/Content.tsx";
import ChatTalkTitleContent from "./talk/header/ChatTalkTitleContent.tsx";
import { isSelectRoomState } from "../utils/room/roomState.ts";
import { atom, useAtom } from "solid-jotai";
import { SettingRoom } from "./SettingRoom/SettingRoom.tsx";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import TalkListHeader from "./sidebar/talkListHeader.tsx";
import ChatHeader from "./header/header.tsx";

export const openConfig = atom(false);

export function Chat() {
  const [isSelectRoom] = useAtom(isSelectRoomState);
  const [open, setOpen] = useAtom(openConfig);
  const [isMobile, setIsMobile] = createSignal(window.innerWidth <= 768);
  const [viewportHeight, setViewportHeight] = createSignal(window.innerHeight);

  // 画面サイズの変更とリサイズを検知
  onMount(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
      setViewportHeight(window.innerHeight);
    };

    // リサイズイベントを監視
    window.addEventListener("resize", handleResize);

    // モバイル向けのビューポート高さ更新
    window.addEventListener("orientationchange", handleResize);
    window.addEventListener("focusin", handleResize);
    window.addEventListener("focusout", handleResize);

    // 初期値設定
    setViewportHeight(window.innerHeight);

    // iOSデバイスでのキーボード表示時の対応
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
      document.documentElement.style.height = `${window.innerHeight}px`;
      document.body.style.height = `${window.innerHeight}px`;
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      window.removeEventListener("focusin", handleResize);
      window.removeEventListener("focusout", handleResize);
    };
  });

  return (
    <>
      <ChatHeader />
      <SetUp />
      <EncryptSession />
      <div class="wrapper w-full">
        <main
          class={`p-talk ${isSelectRoom() ? "is-inview" : ""} flex`}
          id="chatmain"
        >
          <div class="p-talk-list min-h-screen">
            <TalkListHeader />
            <div class="p-talk-list-rooms pb-14 scrollbar">
              <ul class="p-talk-list-rooms__ul h-[calc(100vh-120px)] pb-[70px] scrollbar">
                <SideBer />
              </ul>
            </div>
          </div>
          <div class="p-talk-chat">
            <div class="p-talk-chat-container min-h-dvh flex flex-col">
              {/* チャットヘッダー */}
              <div
                class={`p-talk-chat-title ${isSelectRoom() ? "" : "hidden"}`}
                id="chatHeader"
              >
                <div class="flex items-center gap-2 p-4">
                  <ChatTalkTitle />
                  <ChatTalkTitleContent />
                </div>
                {isMobile() && !open() && isSelectRoom() && (
                  <div
                    class="absolute right-7 cursor-pointer hover:scale-105 transition-transform duration-200"
                    onClick={() => setOpen(true)}
                  >
                    <span class="block w-7 h-0.5 bg-white mb-[5px]"></span>
                    <span class="block w-7 h-0.5 bg-white mb-[5px]"></span>
                    <span class="block w-7 h-0.5 bg-white"></span>
                  </div>
                )}
              </div>
              {/* メッセージ表示エリア - 高さを動的に調整 */}
              <div
                class="flex-grow overflow-hidden"
                style={{
                  height: isMobile()
                    ? `calc(${viewportHeight()}px - 170px)`
                    : "calc(100vh - 148px)",
                }}
              >
                <ChatTalkContent />
              </div>

              {/* メッセージ送信エリア - 固定表示 */}
              <div class="flex-shrink-0 w-full">
                <ChatSend />
              </div>
            </div>
          </div>
          {/* デスクトップでは設定パネルを常に表示、モバイルでは別のコンポーネントで表示 */}
          {!isMobile() && <SettingRoom />}
        </main>
      </div>
      {/* モバイル版でのみ表示されるポップアップ */}
      {isMobile() && <SettingRoom />}
    </>
  );
}
