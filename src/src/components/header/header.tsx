import HeaderButton from "./headerButton.tsx";
import { useAtom, useSetAtom } from "solid-jotai";
import { selectedAppState } from "../../states/app.ts";
const headerButtons = [
  {
    page: "home",
    icon: (
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
    ),
  },
  {
    page: "talk",
    icon: (
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
        <title id="chatIconTitle">Chat</title>{" "}
        <path d="M8.82388455,18.5880577 L4,21 L4.65322944,16.4273939 C3.00629211,15.0013 2,13.0946628 2,11 C2,6.581722 6.4771525,3 12,3 C17.5228475,3 22,6.581722 22,11 C22,15.418278 17.5228475,19 12,19 C10.8897425,19 9.82174472,18.8552518 8.82388455,18.5880577 Z" />
      </svg>
    ),
  },
  {
    page: "sns",
    icon: (
      <svg
        role="img"
        xmlns="http://www.w3.org/2000/svg"
        width="100%"
        height="100%"
        viewBox="0 0 24 24"
        aria-labelledby="snsIconTitle"
        stroke="#ffffff"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      >
        <title id="snsIconTitle">Social Media</title>
        <circle cx="12" cy="5" r="3" />
        <circle cx="5" cy="19" r="3" />
        <circle cx="19" cy="19" r="3" />
        <line x1="12" y1="8" x2="5" y2="16" />
        <line x1="12" y1="8" x2="19" y2="16" />
        <line x1="5" y1="19" x2="19" y2="19" />
      </svg>
    ),
  },
  {
    page: "notification",
    icon: (
      <svg
        role="img"
        xmlns="http://www.w3.org/2000/svg"
        width="100%"
        height="100%"
        viewBox="0 0 24 24"
        aria-labelledby="notificationIconTitle"
        stroke="#ffffff"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
      >
        <title id="notificationIconTitle">Notification</title>
        <path d="M12 22C13.6569 22 15 20.6569 15 19H9C9 20.6569 10.3431 22 12 22Z" />
        <path d="M18 10V16L21 19H3L6 16V10C6 6.68629 8.68629 4 12 4C15.3137 4 18 6.68629 18 10Z" />
      </svg>
    ),
  },
];

export default function ChatHeader() {
  const setSelectedApp = useSetAtom(selectedAppState);
  return (
    <>
      <header class="l-header " id="header">
        <ul class="l-header__ul">
          <div
            onClick={() => {
              setSelectedApp("jp.takos.app");
            }}
          >
            <img
              src={`https://pbs.twimg.com/profile_images/1708867532067893248/1MRc43B5_400x400.jpg`} // ロゴ画像データは現状維持
              alt="takos"
              class="rounded-full h-9 w-9 m-auto" // ロゴ画像の高さがCSSで指定されていないため、仮に40pxとして計算
            />
          </div>
          {headerButtons.map((buttonInfo) => (
            <HeaderButton page={buttonInfo.page}>
              <a>{buttonInfo.icon}</a>
            </HeaderButton>
          ))}
        </ul>
      </header>
    </>
  );
}
