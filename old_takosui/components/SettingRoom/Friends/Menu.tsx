import { useAtom } from "solid-jotai";
import { selectedFriendTabState } from "../../../utils/room/settingRoomState";
import { createSignal } from "solid-js";
import { NotificationToggle } from "../Common/Notification";
import { TakosFetch } from "../../../utils/TakosFetch";
import {
  isSelectRoomState,
  nickNameState,
  roomKeyState,
  selectedChannelState,
  selectedRoomState,
} from "../../../utils/room/roomState";
import {
  getIdentityKeys,
  getRoomKeyOrCreate,
} from "../../../utils/message/messageUtils";
import { deviceKeyState } from "../../../utils/state";
import { keyHash } from "@takos/takos-encrypt-ink";
import { callState } from "../../Call";

export function FriendSettingMenu() {
  const [selected, setSelected] = useAtom(selectedFriendTabState);
  const [notificationEnabled, setNotificationEnabled] = createSignal(true);
  const [showCallOptions, setShowCallOptions] = createSignal(false);
  const [selectedRoom] = useAtom(selectedRoomState);
  const [deviceKey] = useAtom(deviceKeyState);
  const [call, setCall] = useAtom(callState);
  return (
    <>
      {!selected() && (
        <div class="flex flex-col mt-4">
          {/* 上部アイコンメニュー */}
          <div class="flex justify-around items-center w-full px-4 py-6 mb-2">
            {/* 通知アイコン */}
            <NotificationToggle
              enabled={notificationEnabled()}
              setEnabled={setNotificationEnabled}
            />

            <div
              class="flex flex-col items-center hover:scale-105 transition-transform duration-200 cursor-pointer relative"
              onClick={() => {
                setShowCallOptions(!showCallOptions());
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 8V5z"
                />
              </svg>
              <span class="mt-2 text-sm text-white">通話</span>
              {showCallOptions() && (
                <div class="absolute top-full mt-2 bg-gray-800 rounded-lg shadow-lg p-2 z-10 w-32">
                  <div class="p-2 hover:bg-gray-700 rounded cursor-pointer text-center">
                    <span class="text-white">呼び出し</span>
                  </div>
                  <div
                    class="p-2 hover:bg-gray-700 rounded cursor-pointer text-center"
                    onClick={async () => {
                      console.log("call audio");
                      const roomInfo = selectedRoom();
                      if (!roomInfo) {
                        console.error("roomInfo is not found");
                        return;
                      }
                      if (roomInfo.type !== "friend") {
                        console.error("roomInfo is not friend");
                        return;
                      }
                      const mutch = roomInfo.roomid.match(
                        /^m\{([^}]+)\}@(.+)$/,
                      );
                      if (!mutch) {
                        console.error("roomInfo is not friend");
                        return;
                      }
                      const roomIdUserName = mutch[1];
                      const roomIdDomain = mutch[2];
                      const deviceKeyVal = deviceKey();
                      if (!deviceKeyVal) {
                        console.error("deviceKey is not found");
                        return;
                      }
                      const { decryptedIdentityKey, latestIdentityKey } =
                        await getIdentityKeys(
                          deviceKeyVal,
                        );
                      const roomKey = await getRoomKeyOrCreate(
                        {
                          room: { type: "friend", roomid: roomInfo.roomid },
                          deviceKeyVal,
                          decryptedIdentityKey,
                          latestIdentityKey,
                        },
                      );
                      if (!roomKey) {
                        console.error("roomKey is not found");
                        return;
                      }
                      const res = await TakosFetch(
                        "/api/v2/call/friend/audio/request",
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            friendId: roomIdUserName + "@" + roomIdDomain,
                            roomKeyHash: await keyHash(roomKey),
                          }),
                        },
                      );
                      if (res.status === 200) {
                        console.log("success");
                        setCall({
                          friendId: roomIdUserName + "@" + roomIdDomain,
                          isEncrypted: true,
                          mode: "audio",
                          roomId: roomInfo.roomid,
                          roomKeyHash: await keyHash(roomKey),
                          type: "friend",
                          status: "outgoing",
                          isCaller: true,
                        });
                      } else {
                        console.error("error");
                      }
                    }}
                  >
                    <span class="text-white">音声</span>
                  </div>
                  <div 
                    class="p-2 hover:bg-gray-700 rounded cursor-pointer text-center"
                    onClick={async () => {
                      console.log("call video");
                      const roomInfo = selectedRoom();
                      if (!roomInfo) {
                        console.error("roomInfo is not found");
                        return;
                      }
                      if (roomInfo.type !== "friend") {
                        console.error("roomInfo is not friend");
                        return;
                      }
                      const mutch = roomInfo.roomid.match(
                        /^m\{([^}]+)\}@(.+)$/,
                      );
                      if (!mutch) {
                        console.error("roomInfo is not friend");
                        return;
                      }
                      const roomIdUserName = mutch[1];
                      const roomIdDomain = mutch[2];
                      const deviceKeyVal = deviceKey();
                      if (!deviceKeyVal) {
                        console.error("deviceKey is not found");
                        return;
                      }
                      const { decryptedIdentityKey, latestIdentityKey } =
                        await getIdentityKeys(
                          deviceKeyVal,
                        );
                      const roomKey = await getRoomKeyOrCreate(
                        {
                          room: { type: "friend", roomid: roomInfo.roomid },
                          deviceKeyVal,
                          decryptedIdentityKey,
                          latestIdentityKey,
                        },
                      );
                      if (!roomKey) {
                        console.error("roomKey is not found");
                        return;
                      }
                      const res = await TakosFetch(
                        "/api/v2/call/friend/video/request",
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            friendId: roomIdUserName + "@" + roomIdDomain,
                            roomKeyHash: await keyHash(roomKey),
                          }),
                        },
                      );
                      if (res.status === 200) {
                        console.log("success");
                        setCall({
                          friendId: roomIdUserName + "@" + roomIdDomain,
                          isEncrypted: true,
                          mode: "video",
                          roomId: roomInfo.roomid,
                          roomKeyHash: await keyHash(roomKey),
                          type: "friend",
                          status: "outgoing",
                          isCaller: true,
                        });
                      } else {
                        console.error("error");
                      }
                    }}
                  >
                    <span class="text-white">ビデオ</span>
                  </div>
                </div>
              )}
            </div>

            {/* ブロックアイコン */}
            <div
              class="flex flex-col items-center hover:scale-105 transition-transform duration-200 cursor-pointer"
              onClick={() => alert("ブロックはまだ実装されていません")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                />
              </svg>
              <span class="mt-2 text-sm text-white">ブロック</span>
            </div>
          </div>

          {/* メニューセクションのヘッダー */}
          <div class="px-4 py-3 mb-1">
            <h3 class="text-gray-400 text-xs uppercase font-semibold">
              友達設定
            </h3>
          </div>

          {/* オプションセクション - 縦メニュー */}
          <div class="px-4 space-y-1">
            {/* チャット設定 */}
            <div
              class="flex items-center p-3 rounded hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
              onClick={() => setSelected("chat")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 mr-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              <span class="text-white">チャット設定</span>
            </div>

            {/* プライバシー */}
            <div
              class="flex items-center p-3 rounded hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
              onClick={() => setSelected("privacy")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 mr-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              <span class="text-white">プライバシー</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
