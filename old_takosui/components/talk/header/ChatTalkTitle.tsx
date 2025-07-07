import { useAtom } from "solid-jotai";
import {
  isSelectRoomState,
  selectedRoomState,
} from "../../../utils/room/roomState";

export default function ChatTalkTitle() {
  const [isSelectRoom, setIsSelectedRoom] = useAtom(isSelectRoomState);
  const [selectedRoom, setSelectedRoom] = useAtom(selectedRoomState);
  return (
    <button
      class="p-talk-chat-prev items-center justify-center w-8 h-8 rounded-full hover:bg-gray-700 transition-colors lg:hidden flex"
      onClick={() => {
        setIsSelectedRoom(false);
        setSelectedRoom(null);
        const url = new URL(window.location.href);
        const pathSegments = url.pathname.split("/").filter(Boolean);
        if (pathSegments.length >= 2) {
          const newPath = "/" + pathSegments[0]; // domain/:page
          window.history.pushState({}, "", newPath);
        }
      }}
    >
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
        <polyline points="14 18 8 12 14 6 14 6" />
      </svg>
    </button>
  );
}
