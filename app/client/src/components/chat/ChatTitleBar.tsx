import { Show } from "solid-js";
import type { ChatRoom } from "./types.ts";

interface ChatTitleBarProps {
  isMobile: boolean;
  selectedRoom: ChatRoom | null;
  onBack: () => void;
}

export function ChatTitleBar(props: ChatTitleBarProps) {
  return (
    <div
      class={`p-talk-chat-title ${props.selectedRoom ? "" : "hidden"}`}
      id="chatHeader"
    >
      <div class="flex items-center gap-2 p-4">
        <Show when={props.isMobile}>
          <button type="button" class="h-full" onClick={props.onBack}>
            <svg
              role="img"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              stroke="#ffffff"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              fill="none"
              class="w-5 h-5"
            >
              <polyline points="14 18 8 12 14 6" />
            </svg>
          </button>
        </Show>
        <h2>{props.selectedRoom?.name}</h2>
      </div>
    </div>
  );
}
