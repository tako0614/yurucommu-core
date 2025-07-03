import { useSetAtom } from "solid-jotai";
import { selectedAppState } from "../../states/app.ts";

export default function ChatHeader() {
  const setSelectedApp = useSetAtom(selectedAppState);

  return (
    <>
      <header class="l-header " id="header">
        <ul class="l-header__ul">
          <div
            onClick={() => {
              setSelectedApp("home");
            }}
            class="l-header__ul-item"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="m-auto h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
              />
            </svg>
          </div>
          <div
            onClick={() => {
              setSelectedApp("microblog");
            }}
            class="l-header__ul-item"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="m-auto h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
        </ul>
      </header>
    </>
  );
}
