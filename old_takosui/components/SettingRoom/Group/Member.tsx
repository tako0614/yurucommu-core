import { useAtom } from "solid-jotai";
import {
  editMemberState,
  pendingMemberRolesState,
  selectedNewRoleState,
  selectedTabState,
  showAddRoleState,
  showBanConfirmState,
  showKickConfirmState,
  showTimeoutModalState,
  timeoutDurationState,
} from "../../../utils/room/settingRoomState";
import { selectedRoomState } from "../../../utils/room/roomState";
import { groupChannelState } from "../../sidebar/SideBar";
import { For } from "solid-js";
import { PopUpFrame } from "../../utils/popUpFrame";
import { TakosFetch } from "../../../utils/TakosFetch";

export function GroupSettingMember() {
  const [selected, setSelected] = useAtom(selectedTabState);
  const [selectedRoom] = useAtom(selectedRoomState);
  const [groupChannel, setGroupChannel] = useAtom(groupChannelState);
  const [editMember, setEditMember] = useAtom(editMemberState);

  // 残りの変数も同様に置き換え
  const [showAddRole, setShowAddRole] = useAtom(showAddRoleState);
  const [selectedNewRole, setSelectedNewRole] = useAtom(selectedNewRoleState);
  const [pendingMemberRoles, setPendingMemberRoles] = useAtom(
    pendingMemberRolesState,
  );
  const [showKickConfirm, setShowKickConfirm] = useAtom(showKickConfirmState);
  const [showBanConfirm, setShowBanConfirm] = useAtom(showBanConfirmState);
  const [showTimeoutModal, setShowTimeoutModal] = useAtom(
    showTimeoutModalState,
  );
  const [timeoutDuration, setTimeoutDuration] = useAtom(timeoutDurationState);
  return (
    <>
      {selected() === "member" && (
        <>
          {/*戻るボタン*/}
          <div class="flex flex-col w-full p-4">
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

            {/* メンバー管理ヘッダー */}
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-xl font-bold text-white">
                メンバー管理
              </h3>
              <span class="bg-gray-700 text-gray-300 px-2 py-1 rounded text-sm">
                {groupChannel()?.members.length || 0} 人
              </span>
            </div>

            {/* 検索バー（オプション） */}
            <div class="mb-4">
              <div class="relative">
                <input
                  type="text"
                  placeholder="メンバーを検索..."
                  class="w-full bg-gray-700 text-white px-4 py-2 pl-10 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5 absolute left-3 top-2.5 text-gray-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
            </div>

            {/* メンバーリスト */}
            <div class="mt-4 w-full max-h-80 overflow-y-auto pr-1 custom-scrollbar">
              <For each={groupChannel()!.members}>
                {(member) => (
                  <div class="bg-gray-800 rounded-lg mb-3 overflow-hidden hover:bg-gray-750 transition-colors">
                    <div class="flex justify-between items-center p-3">
                      <div class="flex items-center space-x-3">
                        {/* ユーザーアバタープレースホルダー */}
                        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
                          {member.userId.charAt(0).toUpperCase()}
                        </div>

                        {/* ユーザー情報 */}
                        <div class="flex flex-col">
                          <span class="text-white font-medium break-all">
                            {member.userId}
                          </span>
                          <div class="flex items-center">
                            {/* ロールバッジ表示（最大2つ） */}
                            {member.role && member.role.length > 0
                              ? (
                                <div class="flex space-x-1">
                                  {member.role.slice(0, 2).map(
                                    (roleId) => {
                                      const role = groupChannel()
                                        ?.roles
                                        .find((r) => r.id === roleId);
                                      return role
                                        ? (
                                          <span
                                            class="text-xs px-1.5 py-0.5 rounded"
                                            style={{
                                              "background-color":
                                                `${role.color}20`,
                                              "color": role.color,
                                              "border":
                                                `1px solid ${role.color}`,
                                            }}
                                          >
                                            {role.name}
                                          </span>
                                        )
                                        : null;
                                    },
                                  )}
                                  {member.role.length > 2 && (
                                    <span class="text-xs text-gray-400">
                                      +{member.role.length - 2}
                                    </span>
                                  )}
                                </div>
                              )
                              : (
                                <span class="text-xs text-gray-400">
                                  ロールなし
                                </span>
                              )}
                          </div>
                        </div>
                      </div>

                      {/* アクションボタン */}
                      <button
                        class="bg-gray-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded-md transition-colors flex items-center space-x-1"
                        onClick={() => {
                          setEditMember(member.userId);
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                        <span>編集</span>
                      </button>
                    </div>
                  </div>
                )}
              </For>

              {/* メンバーがいない場合 */}
              {groupChannel()!.members.length === 0 && (
                <div class="flex flex-col items-center justify-center py-8 text-gray-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-12 w-12 mb-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                  </svg>
                  <p>メンバーがいません</p>
                </div>
              )}
            </div>
          </div>
          {editMember() && (
            <>
              <PopUpFrame
                // @ts-ignore
                closeScript={setEditMember}
              >
                <div class="p-4">
                  <h3 class="text-lg font-bold text-white mb-4 border-b border-gray-700 pb-2">
                    メンバーの編集
                  </h3>

                  {/* ユーザー情報セクション */}
                  <div class="mb-6 bg-gray-800 p-3 rounded-lg">
                    <div class="flex items-center mb-2">
                      <div class="w-10 h-10 bg-gray-600 rounded-full flex items-center justify-center mr-3">
                        <span class="text-lg text-white">
                          {(editMember() as string).charAt(0)
                            ?.toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <label class="block text-white font-medium">
                          {editMember()}
                        </label>
                        <span class="text-gray-400 text-sm">
                          {groupChannel()?.members.find((m) =>
                            m.userId === editMember()
                          )?.role.length || 0} ロール
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* ロールセクション */}
                  <div class="mb-6">
                    <div class="flex items-center justify-between mb-3">
                      <label class="block text-white font-medium">
                        ロール管理
                      </label>
                      <button
                        class="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded-md flex items-center text-sm transition-colors"
                        onClick={() => setShowAddRole(true)}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4 mr-1"
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
                        ロール追加
                      </button>
                    </div>

                    {pendingMemberRoles().length > 0
                      ? (
                        <div class="bg-gray-800 p-2 rounded-md max-h-40 overflow-y-auto">
                          {pendingMemberRoles().map((role) => {
                            console.log(role);
                            return (
                              <div class="flex items-center justify-between mb-2 p-2 hover:bg-gray-700 rounded transition-colors">
                                <span class="text-white flex-1">
                                  {(() => {
                                    const role2 = groupChannel()
                                      ?.roles
                                      .find((r) => r.id === role);
                                    return role2?.name ||
                                      "不明なロール";
                                  })()}
                                </span>
                                <button
                                  class="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-sm transition-colors"
                                  onClick={() => {
                                    setPendingMemberRoles((pre) =>
                                      pre.filter((r) => r !== role)
                                    );
                                  }}
                                >
                                  削除
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )
                      : (
                        <div class="text-gray-400 text-center p-3 bg-gray-800 rounded-md">
                          このユーザーにはロールが割り当てられていません
                        </div>
                      )}
                  </div>

                  {/* セーブボタン */}
                  <div class="flex justify-end mb-6">
                    <button
                      class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md transition-colors"
                      onClick={() => {
                        const match = selectedRoom()?.roomid.match(
                          /^g\{([^}]+)\}@(.+)$/,
                        );
                        if (!match) {
                          return;
                        }
                        const friendUserName = match[1];
                        const domainFromRoom = match[2];

                        TakosFetch("/api/v2/group/user/role", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            userId: editMember(),
                            groupId: friendUserName + "@" +
                              domainFromRoom,
                            roleId: pendingMemberRoles(),
                          }),
                        }).then(async (res) => {
                          if (res.status !== 200) {
                            alert("エラーが発生しました");
                            return;
                          }

                          const baseUrl =
                            `https://${domainFromRoom}/_takos/v1/group`;
                          const role = await TakosFetch(
                            `${baseUrl}/members/${
                              friendUserName + "@" + domainFromRoom
                            }`,
                          ).then((res) => res.json());

                          setGroupChannel((pre) => ({
                            ...pre!,
                            members: role.members,
                          }));
                          alert("ロールを保存しました");
                        });
                      }}
                    >
                      ロールを保存
                    </button>
                  </div>

                  {/* モデレーションアクションセクション */}
                  <div class="border-t border-gray-700 pt-4">
                    <h4 class="text-md text-white mb-3">
                      モデレーションアクション
                    </h4>
                    <div class="grid grid-cols-3 gap-3">
                      <button
                        class="bg-yellow-600 hover:bg-yellow-700 text-white py-2 px-3 rounded-md flex flex-col items-center transition-colors"
                        onClick={() => setShowKickConfirm(true)}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-5 w-5 mb-1"
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
                        キック
                      </button>
                      <button
                        class="bg-red-600 hover:bg-red-700 text-white py-2 px-3 rounded-md flex flex-col items-center transition-colors"
                        onClick={() => setShowBanConfirm(true)}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-5 w-5 mb-1"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L5.636 5.636m12.728 12.728L5.636 18.364"
                          />
                        </svg>
                        バン
                      </button>
                      <button
                        class="bg-blue-600 hover:bg-blue-700 text-white py-2 px-3 rounded-md flex flex-col items-center transition-colors"
                        onClick={() => setShowTimeoutModal(true)}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-5 w-5 mb-1"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        タイムアウト
                      </button>
                    </div>
                  </div>
                </div>
              </PopUpFrame>

              {/* キック確認モーダル */}
              {showKickConfirm() && (
                <PopUpFrame closeScript={setShowKickConfirm}>
                  <div class="p-4">
                    <h3 class="text-lg font-bold text-white mb-2">
                      キック確認
                    </h3>
                    <p class="text-white mb-4">
                      ユーザー <span class="font-medium">{editMember()}</span>
                      {" "}
                      をグループからキックします。
                      このユーザーは再度招待または参加することができます。
                    </p>
                    <div class="flex justify-end gap-2">
                      <button
                        class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded transition-colors"
                        onClick={() =>
                          setShowKickConfirm(false)}
                      >
                        キャンセル
                      </button>
                      <button
                        class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                        onClick={async () => {
                          const match = selectedRoom()?.roomid.match(
                            /^g\{([^}]+)\}@(.+)$/,
                          );
                          if (!match) return;

                          try {
                            const res = await TakosFetch(
                              "/api/v2/group/kick",
                              {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  userId: editMember(),
                                  groupId: match[1] + "@" + match[2],
                                }),
                              },
                            );

                            if (res.status === 200) {
                              // 成功の場合、メンバーリストを更新
                              const friendUserName = match[1];
                              const domainFromRoom = match[2];
                              const baseUrl =
                                `https://${domainFromRoom}/_takos/v1/group`;

                              const members = await TakosFetch(
                                `${baseUrl}/members/${
                                  friendUserName + "@" +
                                  domainFromRoom
                                }`,
                              ).then((res) => res.json());

                              setGroupChannel((pre) => ({
                                ...pre!,
                                members: members.members,
                              }));
                              setShowKickConfirm(false);
                              setEditMember(false);
                              alert(
                                `${editMember()}をキックしました`,
                              );
                            } else {
                              alert("キックに失敗しました");
                            }
                          } catch (err) {
                            console.error(
                              "キック処理中にエラーが発生しました",
                              err,
                            );
                            alert(
                              "キック処理中にエラーが発生しました",
                            );
                          }
                        }}
                      >
                        キックする
                      </button>
                    </div>
                  </div>
                </PopUpFrame>
              )}

              {/* バン確認モーダル */}
              {showBanConfirm() && (
                <PopUpFrame closeScript={setShowBanConfirm}>
                  <div class="p-4">
                    <h3 class="text-lg font-bold text-white mb-2">
                      バン確認
                    </h3>
                    <p class="text-white mb-4">
                      ユーザー <span class="font-medium">{editMember()}</span>
                      {" "}
                      をグループからバンします。
                      このユーザーは二度とグループに参加できなくなります。
                    </p>
                    <div class="flex justify-end gap-2">
                      <button
                        class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded transition-colors"
                        onClick={() => setShowBanConfirm(false)}
                      >
                        キャンセル
                      </button>
                      <button
                        class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
                        onClick={async () => {
                          const match = selectedRoom()?.roomid.match(
                            /^g\{([^}]+)\}@(.+)$/,
                          );
                          if (!match) return;

                          try {
                            const res = await TakosFetch(
                              "/api/v2/group/ban",
                              {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  userId: editMember(),
                                  groupId: match[1] + "@" + match[2],
                                }),
                              },
                            );

                            if (res.status === 200) {
                              // 成功の場合、メンバーリストを更新
                              const friendUserName = match[1];
                              const domainFromRoom = match[2];
                              const baseUrl =
                                `https://${domainFromRoom}/_takos/v1/group`;

                              const members = await TakosFetch(
                                `${baseUrl}/members/${
                                  friendUserName + "@" +
                                  domainFromRoom
                                }`,
                              ).then((res) => res.json());

                              setGroupChannel((pre) => ({
                                ...pre!,
                                members: members.members,
                              }));
                              setShowBanConfirm(false);
                              setEditMember(false);
                              alert(`${editMember()}をバンしました`);
                            } else {
                              alert("バンに失敗しました");
                            }
                          } catch (err) {
                            console.error(
                              "バン処理中にエラーが発生しました",
                              err,
                            );
                            alert("バン処理中にエラーが発生しました");
                          }
                        }}
                      >
                        バンする
                      </button>
                    </div>
                  </div>
                </PopUpFrame>
              )}

              {/* タイムアウトモーダル */}
              {showTimeoutModal() && (
                <PopUpFrame closeScript={setShowTimeoutModal}>
                  <div class="p-4">
                    <h3 class="text-lg font-bold text-white mb-2">
                      タイムアウト設定
                    </h3>
                    <p class="text-white mb-4">
                      ユーザー <span class="font-medium">{editMember()}</span>
                      {" "}
                      を一時的にタイムアウトします。
                      タイムアウト中のユーザーはメッセージを送信できなくなります。
                    </p>
                    <div class="mb-4">
                      <label class="block text-white mb-2">
                        タイムアウト期間
                      </label>
                      <div class="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          max="43200" // 30日分の分数
                          value={timeoutDuration()}
                          onInput={(e) =>
                            setTimeoutDuration(
                              parseInt(e.currentTarget.value) || 0,
                            )}
                          class="w-full p-2 rounded text-black"
                        />
                        <span class="text-white whitespace-nowrap">
                          分
                        </span>
                      </div>
                      <div class="text-gray-400 text-xs mt-1">
                        {timeoutDuration() > 0
                          ? `約 ${Math.floor(timeoutDuration() / 60)} 時間 ${
                            timeoutDuration() % 60
                          } 分`
                          : ""}
                      </div>
                    </div>
                    <div class="flex justify-end gap-2">
                      <button
                        class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded transition-colors"
                        onClick={() => setShowTimeoutModal(false)}
                      >
                        キャンセル
                      </button>
                      <button
                        class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors"
                        onClick={async () => {
                          if (timeoutDuration() <= 0) {
                            alert(
                              "タイムアウト期間を入力してください",
                            );
                            return;
                          }

                          const match = selectedRoom()?.roomid.match(
                            /^g\{([^}]+)\}@(.+)$/,
                          );
                          if (!match) return;

                          try {
                            const res = await TakosFetch(
                              "/api/v2/group/timeout",
                              {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  userId: editMember(),
                                  groupId: match[1] + "@" + match[2],
                                  duration: timeoutDuration(), // 分単位
                                }),
                              },
                            );

                            if (res.status === 200) {
                              setShowTimeoutModal(false);
                              alert(
                                `${editMember()}を${timeoutDuration()}分間タイムアウトしました`,
                              );
                            } else {
                              alert("タイムアウト設定に失敗しました");
                            }
                          } catch (err) {
                            console.error(
                              "タイムアウト処理中にエラーが発生しました",
                              err,
                            );
                            alert(
                              "タイムアウト処理中にエラーが発生しました",
                            );
                          }
                        }}
                      >
                        タイムアウト設定
                      </button>
                    </div>
                  </div>
                </PopUpFrame>
              )}

              {/* ロール追加モーダル */}
              {showAddRole() && (
                <PopUpFrame closeScript={setShowAddRole}>
                  <div class="p-4">
                    <h3 class="text-lg font-bold text-white mb-3">
                      ロールを追加
                    </h3>
                    <div class="mb-4">
                      <label class="block text-white mb-2">
                        追加するロールを選択
                      </label>
                      <select
                        class="w-full p-2 rounded bg-gray-800 text-white border border-gray-700"
                        value={selectedNewRole()}
                        onChange={(e) =>
                          setSelectedNewRole(e.currentTarget.value)}
                      >
                        <option value="" disabled>
                          ロールを選択してください
                        </option>
                        {groupChannel()?.roles
                          .filter((role) =>
                            !pendingMemberRoles().includes(role.id)
                          )
                          .filter((role) => role.id !== "everyone")
                          .map((role) => (
                            <option value={role.id}>
                              {role.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div class="flex justify-end gap-2">
                      <button
                        class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded transition-colors"
                        onClick={() => setShowAddRole(false)}
                      >
                        キャンセル
                      </button>
                      <button
                        class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded transition-colors"
                        onClick={() => {
                          if (!selectedNewRole()) {
                            alert("ロールを選択してください");
                            return;
                          }
                          setPendingMemberRoles([
                            ...pendingMemberRoles(),
                            selectedNewRole(),
                          ]);
                          setSelectedNewRole("");
                          setShowAddRole(false);
                        }}
                        disabled={!selectedNewRole()}
                      >
                        追加
                      </button>
                    </div>
                  </div>
                </PopUpFrame>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
