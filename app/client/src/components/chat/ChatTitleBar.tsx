import { Show } from "solid-js";
import type { Room } from "./types.ts";

interface ChatTitleBarProps {
  isMobile: boolean;
  selectedRoom: Room | null;
  onBack: () => void;
}

export function ChatTitleBar(props: ChatTitleBarProps) {
  return (
    <div
      class={`absolute w-full h-12 flex items-center font-bold text-[20px] border-b border-[#333333] bg-[rgba(30,30,30,0.85)] backdrop-blur-md shadow-[0_3px_18px_rgba(0,0,0,0.2)] text-white z-[2] md:px-[18px] ${
        props.selectedRoom ? "" : "hidden"
      }`}
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
