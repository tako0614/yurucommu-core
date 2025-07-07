import { useAtom } from "solid-jotai";
import { selectedRoomState } from "../../../utils/room/roomState";
import {
  groupDescriptionState,
  groupIconState,
  groupIsPrivateState,
  groupNameState,
  selectedTabState,
  updatedGroupDescriptionState,
  updatedGroupIconState,
  updatedGroupIsPrivateState,
  updatedGroupNameState,
} from "../../../utils/room/settingRoomState";
import { TakosFetch } from "../../../utils/TakosFetch";

export function GroupSettingDetail() {
  const [selectedRoom] = useAtom(selectedRoomState);
  const [selected, setSelected] = useAtom(selectedTabState);
  const [groupName, setGroupName] = useAtom(groupNameState);
  const [groupDescription, setGroupDescription] = useAtom(
    groupDescriptionState,
  );
  const [groupIcon, setGroupIcon] = useAtom(groupIconState);
  const [groupIsPrivate, setGroupIsPrivate] = useAtom(groupIsPrivateState);
  const [updatedGroupName, setUpdatedGroupName] = useAtom(
    updatedGroupNameState,
  );
  const [updatedGroupDescription, setUpdatedGroupDescription] = useAtom(
    updatedGroupDescriptionState,
  );
  const [updatedGroupIcon, setUpdatedGroupIcon] = useAtom(
    updatedGroupIconState,
  );
  const [updatedGroupIsPrivate, setUpdatedGroupIsPrivate] = useAtom(
    updatedGroupIsPrivateState,
  );

  return (
    <>
      {selected() === "detail" && (
        <>
          <div class="flex flex-col w-full p-4">
            {/* 戻るボタン */}
            <div
              class="flex items-center cursor-pointer mb-6 text-blue-400 hover:text-blue-300 transition-colors"
              onClick={() => setSelected(false)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 mr-1"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                  clip-rule="evenodd"
                />
              </svg>
              <span class="font-medium">戻る</span>
            </div>

            {/* ヘッダー */}
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-xl font-bold text-white">詳細設定</h3>
            </div>

            {/* 説明テキスト */}
            <p class="text-gray-400 text-sm mb-4">
              グループの基本情報や参加条件などの設定を変更できます。
            </p>

            {/* 設定フォーム */}
            <div class="space-y-6">
              {/* グループアイコン設定 */}
              <div class="bg-gray-800 p-4 rounded-lg">
                <label class="block text-white font-medium mb-2">
                  グループアイコン
                </label>
                <div class="flex items-center space-x-4">
                  <div class="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-2xl font-bold overflow-hidden">
                    <img
                      src={"data:image/png;base64," +
                        updatedGroupIcon()}
                      alt="グループアイコン"
                      class="w-full h-full object-cover"
                    />
                  </div>
                  <button
                    class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors flex items-center"
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/*";
                      input.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement)
                          .files?.[0];
                        if (!file) {
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = async (e) => {
                          const base64 = e.target?.result as string;
                          setUpdatedGroupIcon(base64.split(",")[1]);
                        };
                        reader.readAsDataURL(file);
                      };
                      input.click();
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5 mr-1"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z"
                        clip-rule="evenodd"
                      />
                    </svg>
                    アップロード
                  </button>
                </div>
              </div>

              {/* グループ名設定 */}
              <div class="bg-gray-800 p-4 rounded-lg">
                <label class="block text-white font-medium mb-2">
                  グループ名
                </label>
                <input
                  type="text"
                  value={updatedGroupName()}
                  onInput={(e) => setUpdatedGroupName(e.currentTarget.value)}
                  class="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
                  placeholder="グループ名を入力"
                />
              </div>

              {/* グループ説明設定 */}
              <div class="bg-gray-800 p-4 rounded-lg">
                <label class="block text-white font-medium mb-2">
                  グループ説明
                </label>
                <textarea
                  class="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none min-h-[80px]"
                  placeholder="グループの説明を入力（任意）"
                  value={updatedGroupDescription()}
                  onInput={(e) =>
                    setUpdatedGroupDescription(e.currentTarget.value)}
                >
                </textarea>
              </div>

              {/* 参加条件設定 */}
              <div class="bg-gray-800 p-4 rounded-lg">
                <label class="block text-white font-medium mb-2">
                  参加条件
                </label>
                <div class="space-y-2">
                  <label class="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="joinType"
                      class="mr-2"
                      checked={!updatedGroupIsPrivate()}
                      onChange={() => setUpdatedGroupIsPrivate(false)}
                    />
                    <span>申請制（管理者の承認が必要）</span>
                  </label>
                  <label class="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="joinType"
                      class="mr-2"
                      checked={updatedGroupIsPrivate()}
                      onChange={() => setUpdatedGroupIsPrivate(true)}
                    />
                    <span>自由参加（誰でも参加可能）</span>
                  </label>
                </div>
              </div>

              {/* 保存ボタン */}
              <div class="flex justify-end">
                <button
                  class="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-md transition-colors"
                  onClick={async () => {
                    // 実際の保存処理はここに実装します
                    const match = selectedRoom()?.roomid.match(
                      /^g\{([^}]+)\}@(.+)$/,
                    );
                    if (!match) {
                      return;
                    }
                    const friendUserName = match[1];
                    const domainFromRoom = match[2];

                    // 変更されたもののみを含む更新データを作成
                    interface GroupUpdateData {
                      groupId: string;
                      name?: string;
                      description?: string;
                      allowJoin?: boolean;
                      icon?: string;
                    }

                    // updateDataの定義を修正
                    const updateData: GroupUpdateData = {
                      groupId: friendUserName + "@" + domainFromRoom,
                    };

                    // 各項目が変更されている場合のみ追加
                    if (groupName() !== updatedGroupName()) {
                      updateData.name = updatedGroupName();
                    }

                    if (
                      groupDescription() !== updatedGroupDescription()
                    ) {
                      updateData.description = updatedGroupDescription();
                    }

                    if (
                      groupIsPrivate() !== updatedGroupIsPrivate()
                    ) {
                      updateData.allowJoin = updatedGroupIsPrivate();
                    }

                    if (groupIcon() !== updatedGroupIcon()) {
                      updateData.icon = updatedGroupIcon();
                    }

                    // 変更がない場合は処理を終了
                    if (Object.keys(updateData).length <= 1) {
                      alert("変更はありません");
                      return;
                    }

                    // 更新データを送信
                    const res = await TakosFetch(
                      "/api/v2/group/settings",
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify(updateData),
                      },
                    );

                    if (res.ok) {
                      // 保存成功時に現在の値を更新
                      setGroupName(updatedGroupName());
                      setGroupDescription(updatedGroupDescription());
                      setGroupIsPrivate(updatedGroupIsPrivate());
                      setGroupIcon(updatedGroupIcon());
                      alert("設定を保存しました");
                    } else {
                      alert("設定の保存に失敗しました");
                    }
                  }}
                >
                  変更を保存
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
