import { JSX } from "solid-js/jsx-runtime";
import { Show, createSignal, onMount } from "solid-js";
// Import atom state for navigation
import { useAtom } from "solid-jotai";
import { selectedAppState, AppPage } from "../../states/app.ts";
import { selectedRoomState } from "../../states/chat.ts";

const HeaderButton = (props: { page: AppPage; children: JSX.Element }) => {
  const [selectedApp, setSelectedApp] = useAtom(selectedAppState);

  return (
    <li
      class={`l-header__ul-item ${selectedApp() === props.page ? 'is-active' : ''}`}
      onClick={() => setSelectedApp(props.page)}
    >
      {props.children}
    </li>
  );
}

export default function ChatHeader() {
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

  // チャットページでヘッダーを非表示にするかどうかを判定
  // スマホ版かつチャットページかつチャンネルが選択されている場合のみヘッダーを非表示
  const shouldHideHeader = () => {
    return selectedApp() === "chat" && isMobile() && selectedRoom() !== null;
  };

  return (
    <Show when={!shouldHideHeader()}>
      <header
        class={`l-header ${isMobile() ? 'l-header--mobile' : 'l-header--desktop'}`}
        id="header"
      >
        <ul class="l-header__ul">
          <HeaderButton
            page="home"
          >
            <a>
              <svg
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                aria-labelledby="homeAltIconTitle"
                stroke="#ffffff"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              >
                <title id="homeAltIconTitle">Home</title>{" "}
                <path d="M3 10.182V22h18V10.182L12 2z" />{" "}
                <rect width="6" height="8" x="9" y="14" />
              </svg>
            </a>
          </HeaderButton>
                    <HeaderButton
            page="chat"
          >
            <a>
              <svg
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                aria-labelledby="chatIconTitle"
                stroke="#ffffff"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              >
                <title id="chatIconTitle">Chat</title>
                <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </a>
          </HeaderButton>
          <HeaderButton
            page="microblog"
          >
            <a>
              <svg
              role="img"
              xmlns="http://www.w3.org/2000/svg"
              width="100%"
              height="100%"
              viewBox="0 0 24 24"
              aria-labelledby="microblogIconTitle"
              stroke="#ffffff"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
              >
              <title id="microblogIconTitle">Microblog</title>
              <path d="M4 21h16" />
              <path d="M15.232 5.232l3.536 3.536L9 18.536H5.464V15L15.232 5.232z" />
              </svg>
            </a>
          </HeaderButton>

          <HeaderButton
            page="videos"
          >
            <a>
              <svg
                role="img"
                xmlns="http://www.w3.org/2000/svg"
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                aria-labelledby="videosIconTitle"
                stroke="#ffffff"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              >
                <title id="videosIconTitle">Videos</title>
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </a>
          </HeaderButton>
        </ul>
      </header>
    </Show>
  );
}
