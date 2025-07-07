import { createEffect, onMount, Setter } from "solid-js";
import { selectedRoomState } from "../../../utils/room/roomState";
import { useAtom } from "solid-jotai";
import {
  getNotificationSetting,
  saveNotificationSetting,
} from "../../../utils/storage/idb";

interface NotificationToggleProps {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
}

export function NotificationToggle(props: NotificationToggleProps) {
  const [selectedRoom, setSelectedRoom] = useAtom(selectedRoomState);

  onMount(async () => {
    const room = selectedRoom();
    if (room) {
      console.log(room);
      const isNotification = await getNotificationSetting({
        roomId: room.roomid,
      });
      props.setEnabled(isNotification);
    }
  });

  createEffect(async () => {
    const room = selectedRoom();
    if (room) {
      const isNotification = await getNotificationSetting({
        roomId: room.roomid,
      });
      props.setEnabled(isNotification);
    }
  });

  return (
    <div
      class="flex flex-col items-center hover:scale-105 transition-transform duration-200 cursor-pointer"
      onClick={async () => {
        const roomid = selectedRoom()!.roomid;
        const newValue = !props.enabled;
        props.setEnabled(newValue);
        await saveNotificationSetting({
          roomId: roomid,
          isNotification: newValue,
        });
      }}
    >
      <div class="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-8 w-8"
          fill="none"
          viewBox="0 0 24 24"
          stroke={props.enabled ? "#3b82f6" : "#6b7280"}
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {!props.enabled && (
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="w-0.5 h-10 bg-red-500 transform rotate-45 rounded-full">
            </div>
          </div>
        )}
      </div>
      <span class="mt-2 text-sm text-white">
        通知{props.enabled ? "オン" : "オフ"}
      </span>
    </div>
  );
}
