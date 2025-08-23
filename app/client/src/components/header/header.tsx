import { JSX } from "solid-js/jsx-runtime";
import { type Accessor, createSignal, onMount, Show } from "solid-js";
// Import atom state for navigation
import { useAtom } from "solid-jotai";
import { AppPage, selectedAppState } from "../../states/app.ts";
import { selectedRoomState } from "../../states/chat.ts";
import { loginState } from "../../states/session.ts";

const HeaderButton = (
  props: {
    page: AppPage;
    isMobile: Accessor<boolean>;
    children: (active: boolean) => JSX.Element;
  },
) => {
  const [selectedApp, setSelectedApp] = useAtom(selectedAppState);
  const isActive = () => selectedApp() === props.page;

  return (
    <li
      class={`relative rounded-md transition-colors duration-200 hover:bg-[#3c3c3c] ${
        props.isMobile() ? "h-12 aspect-square" : "w-full"
      }`}
    >
      <button
        type="button"
        class="block w-full p-3"
        aria-current={isActive() ? "page" : undefined}
        onClick={() => setSelectedApp(props.page)}
      >
        {props.children(isActive())}
      </button>
    </li>
  );
};

export default function ChatHeader() {
  const [selectedApp] = useAtom(selectedAppState);
  const [selectedRoom] = useAtom(selectedRoomState);
  const [isLoggedIn] = useAtom(loginState);
  const [isMobile, setIsMobile] = createSignal(false);

  // モバイルかどうかを判定
  onMount(() => {
    const checkMobile = () => {
      setIsMobile(globalThis.innerWidth <= 768);
    };

    checkMobile();
    globalThis.addEventListener("resize", checkMobile);

    return () => globalThis.removeEventListener("resize", checkMobile);
  });

  // チャットページでヘッダーを非表示にするかどうかを判定
  // スマホ版かつチャットページかつチャンネルが選択されている場合のみヘッダーを非表示
  const shouldHideHeader = () => {
    return selectedApp() === "chat" && isMobile() && selectedRoom() !== null;
  };

  return (
    <Show when={!shouldHideHeader()}>
      <header
        class={`bg-[#252526] fixed transition-transform duration-200 ease-[cubic-bezier(0.11,0.91,0.4,0.94)] ${
          isMobile()
            ? "w-full h-16 p-2 bottom-0 left-0 right-0 flex"
            : "w-[78px] h-full py-[50px] px-[14px] top-0 left-0 right-0"
        }`}
        style={{ "z-index": 4 }}
        id="header"
      >
        <ul
          class={`flex gap-3 ${
            isMobile()
              ? "w-full justify-evenly overflow-x-auto whitespace-nowrap"
              : "flex-col overflow-y-auto max-h-[calc(100vh_-_100px_-_40px_-_25px)]"
          }`}
          style={{ "scrollbar-width": "none", "-ms-overflow-style": "none" }}
        >
          <HeaderButton page="home" isMobile={isMobile}>
            {(active) => (
              <svg
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                aria-labelledby="homeAltIconTitle"
                class={`w-full h-full stroke-white ${
                  active ? "fill-[#ff6060]" : ""
                }`}
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              >
                <title id="homeAltIconTitle">Home</title>{" "}
                <path d="M3 10.182V22h18V10.182L12 2z" />{" "}
                <rect width="6" height="8" x="9" y="14" />
              </svg>
            )}
          </HeaderButton>
          <HeaderButton page="chat" isMobile={isMobile}>
            {(active) => (
              <svg
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                aria-labelledby="chatIconTitle"
                class={`w-full h-full stroke-white ${
                  active ? "fill-[#ff6060]" : ""
                }`}
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              >
                <title id="chatIconTitle">Chat</title>
                <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            )}
          </HeaderButton>

          <HeaderButton page="tools" isMobile={isMobile}>
            {(active) => (
              <svg
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                aria-labelledby="searchIconTitle"
                class={`w-full h-full stroke-white ${
                  active ? "fill-[#ff6060]" : ""
                }`}
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              >
                <title id="searchIconTitle">Search</title>
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            )}
          </HeaderButton>

          <HeaderButton page="microblog" isMobile={isMobile}>
            {(active) => (
              <svg
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                aria-labelledby="microblogIconTitle"
                class={`w-full h-full stroke-white ${
                  active ? "fill-[#ff6060]" : ""
                }`}
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              >
                <title id="microblogIconTitle">Microblog</title>
                <path d="M4 21h16" />
                <path d="M15.232 5.232l3.536 3.536L9 18.536H5.464V15L15.232 5.232z" />
              </svg>
            )}
          </HeaderButton>

          <HeaderButton page="notifications" isMobile={isMobile}>
            {(active) => (
              <svg
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                aria-labelledby="notificationsIconTitle"
                class={`w-full h-full stroke-white ${
                  active ? "fill-[#ff6060]" : ""
                }`}
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              >
                <title id="notificationsIconTitle">Notifications</title>
                <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 01-3.46 0" />
              </svg>
            )}
          </HeaderButton>
          <Show when={isLoggedIn()}>
            <HeaderButton page="admin" isMobile={isMobile}>
              {(active) => (
                <svg
                  role="img"
                  xmlns="http://www.w3.org/2000/svg"
                  width="100%"
                  height="100%"
                  viewBox="0 0 24 24"
                  aria-labelledby="adminIconTitle"
                  class={`w-full h-full stroke-white ${
                    active ? "fill-[#ff6060]" : ""
                  }`}
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill="none"
                >
                  <title id="adminIconTitle">Admin</title>
                  <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .7.4 1.34 1.03 1.64z" />
                </svg>
              )}
            </HeaderButton>
          </Show>
        </ul>
      </header>
    </Show>
  );
}
