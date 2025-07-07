import { createEffect, createSignal, For, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { getEncryptSetting } from "../../../utils/storage/idb";
import { selectedTabState } from "../../../utils/room/settingRoomState";
import { selectedRoomState } from "../../../utils/room/roomState";

export function GroupSettingEncryption() {
  const [selected, setSelected] = useAtom(selectedTabState);

  // 内部の暗号化設定状態
  const [localIsEncrypted, setLocalIsEncrypted] = createSignal<boolean>();
  const [localExcludedUsers, setLocalExcludedUsers] = createSignal<string[]>(
    [],
  );
  const [selectedRoom] = useAtom(selectedRoomState);

  createEffect(() => {
    const roomId = selectedRoom()?.roomid!;
    if (!roomId) return;
    getEncryptSetting({ roomId }).then((setting) => {
      setLocalIsEncrypted(setting || false);
    });
  });

  const [newUser, setNewUser] = createSignal("");

  const addExcludedUser = () => {
    const user = newUser().trim();
    if (user && !localExcludedUsers().includes(user)) {
      setLocalExcludedUsers([...localExcludedUsers(), user]);
      setNewUser("");
    }
  };

  const removeExcludedUser = (user: string) => {
    setLocalExcludedUsers(localExcludedUsers().filter((u) => u !== user));
  };

  const saveSettings = () => {
    // 保存処理の実装
  };

  return (
    <Show when={selected() === "privacy"}>
      <div class="p-4">
        <div class="flex items-center mb-4">
          <button
            class="text-white hover:text-gray-300 mr-2"
            onClick={() => setSelected(false)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
          </button>
          <h2 class="text-lg font-medium text-white">暗号化設定</h2>
        </div>

        <div class="space-y-4">
          <div class="bg-gray-800 rounded-lg p-4">
            <div class="flex items-center justify-between py-2">
              <span class="text-gray-200">メッセージの暗号化</span>
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  class="sr-only peer"
                  checked={localIsEncrypted()}
                  onChange={() => setLocalIsEncrypted(!localIsEncrypted())}
                />
                <div class="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600">
                </div>
              </label>
            </div>

            <Show when={localIsEncrypted()}>
              <div class="mt-4 text-sm text-gray-400">
                <p>
                  暗号化を有効にすると、メッセージはエンドツーエンドで暗号化されます。
                </p>
                <p class="mt-2">
                  チャット参加者のみがメッセージを閲覧できます。
                </p>

                <div class="mt-4 border-t border-gray-700 pt-4">
                  <h3 class="font-medium text-gray-200 mb-2">
                    暗号化から除外するユーザー
                  </h3>
                  <p class="mb-2">
                    指定したユーザーに対しては暗号化されず、解読できません。
                  </p>

                  <div class="flex items-center mt-3">
                    <input
                      type="text"
                      class="flex-grow bg-gray-800 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="ユーザー名を入力"
                      value={newUser()}
                      onInput={(e) => setNewUser(e.currentTarget.value)}
                      onKeyPress={(e) => e.key === "Enter" && addExcludedUser()}
                    />
                    <button
                      class="ml-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded"
                      onClick={addExcludedUser}
                    >
                      追加
                    </button>
                  </div>

                  <div class="mt-3">
                    <Show when={localExcludedUsers().length > 0}>
                      <ul class="space-y-1">
                        <For each={localExcludedUsers()}>
                          {(user) => (
                            <li class="flex justify-between items-center bg-gray-800 rounded px-3 py-2">
                              <span>{user}</span>
                              <button
                                class="text-red-400 hover:text-red-300"
                                onClick={() => removeExcludedUser(user)}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="18"
                                  height="18"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                >
                                  <line x1="18" y1="6" x2="6" y2="18"></line>
                                  <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                              </button>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                    <Show when={localExcludedUsers().length === 0}>
                      <p class="text-gray-500 italic">
                        除外するユーザーがいません
                      </p>
                    </Show>
                  </div>
                </div>
              </div>
            </Show>
            <Show when={!localIsEncrypted()}>
              <div class="mt-4 text-sm text-orange-400">
                <p>
                  警告:
                  暗号化を無効にすると、メッセージは暗号化されずに送信されます。
                </p>
                <p class="mt-2">
                  サーバー管理者や中間者がメッセージの内容を閲覧できる可能性があります。
                </p>
              </div>
            </Show>
          </div>

          <div class="flex justify-end space-x-3">
            <button
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white"
              onClick={saveSettings}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export default GroupSettingEncryption;
