import { useAtom } from "solid-jotai";
import { selectedTabState } from "../../../utils/room/settingRoomState";
import {
  getNotificationSetting,
  saveEncryptSetting,
} from "../../../utils/storage/idb";
import { createSignal } from "solid-js";
import { NotificationToggle } from "../Common/Notification";

export function GroupSettingMenu() {
  const [selected, setSelected] = useAtom(selectedTabState);
  const [notificationEnabled, setNotificationEnabled] = createSignal<boolean>();
  const [showCallOptions, setShowCallOptions] = createSignal(false);

  return (
    <>
      {!selected() && (
        <div class="flex flex-col mt-4">
          {/* 上部アイコンメニュー */}
          <div class="flex justify-around items-center w-full px-4 py-6 mb-2">
            <NotificationToggle
              enabled={notificationEnabled() || false}
              setEnabled={setNotificationEnabled}
            />
            
            {/* 通話アイコン */}
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
                  <div
                    class="p-2 hover:bg-gray-700 rounded cursor-pointer text-center"
                    onClick={() => alert("グループ呼び出しはまだ実装されていません")}
                  >
                    <span class="text-white">呼び出し</span>
                  </div>
                  <div
                    class="p-2 hover:bg-gray-700 rounded cursor-pointer text-center"
                    onClick={() => alert("グループ音声通話はまだ実装されていません")}
                  >
                    <span class="text-white">音声</span>
                  </div>
                  <div
                    class="p-2 hover:bg-gray-700 rounded cursor-pointer text-center"
                    onClick={() => alert("グループビデオ通話はまだ実装されていません")}
                  >
                    <span class="text-white">ビデオ</span>
                  </div>
                </div>
              )}
            </div>
            
            {/* 退出アイコン */}
            <div
              class="flex flex-col items-center hover:scale-105 transition-transform duration-200 cursor-pointer"
              onClick={() => setSelected("leave")}
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
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              <span class="mt-2 text-sm text-white">退出</span>
            </div>
          </div>

          {/* メニューセクションのヘッダー */}
          <div class="px-4 py-3 mb-1">
            <h3 class="text-gray-400 text-xs uppercase font-semibold">
              グループ設定
            </h3>
          </div>

          {/* オプションセクション - 縦メニュー */}
          <div class="px-4 space-y-1">
            {/* メンバーボタン */}
            <div
              class="flex items-center p-3 rounded hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
              onClick={() => setSelected("member")}
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
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a9 9 0 00-9 9h18a9 9 0 00-9-9z"
                />
              </svg>
              <span class="text-white">メンバー</span>
            </div>

            {/* 招待ボタン */}
            <div
              class="flex items-center p-3 rounded hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
              onClick={() => setSelected("invite")}
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span class="text-white">招待</span>
            </div>
            
            {/* ロールボタン */}
            <div
              class="flex items-center p-3 rounded hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
              onClick={() => setSelected("role")}
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
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                />
              </svg>
              <span class="text-white">ロール</span>
            </div>

            {/* 参加リクエストボタン */}
            <div
              class="flex items-center p-3 rounded hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
              onClick={() => setSelected("request")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 mr-3"
                fill="none"
                viewBox="0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
              </svg>
              <span class="text-white">参加リクエスト</span>
            </div>

            {/* BANリスト */}
            <div
              class="flex items-center p-3 rounded hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
              onClick={() => setSelected("ban")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 mr-3"
                fill="none"
                viewBox="0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                />
              </svg>
              <span class="text-white">BANリスト</span>
            </div>

            {/* プライバシー設定 */}
            <div
              class="flex items-center p-3 rounded hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
              onClick={() => setSelected("privacy")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 mr-3"
                fill="none"
                viewBox="0 24 24"
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

            {/* 詳細設定 */}
            <div
              class="flex items-center p-3 rounded hover:bg-gray-700 transition-colors duration-200 cursor-pointer"
              onClick={() => setSelected("detail")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6 mr-3"
                fill="none"
                viewBox="0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span class="text-white">詳細設定</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
