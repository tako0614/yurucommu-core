import { useAtom } from "solid-jotai";
import {
  friendListState,
  roleColorState,
  roleIdState,
  roleNameState,
  rolePermissionsState,
  selectedTabState,
  showCreateRoleState,
  showDeleteRoleConfirmState,
  showEditRoleState,
} from "../../../utils/room/settingRoomState.ts";
import { selectedRoomState } from "../../../utils/room/roomState.ts";
import { For } from "solid-js";
import { groupChannelState } from "../../sidebar/SideBar.tsx";
import { PopUpFrame } from "../../utils/popUpFrame.tsx";
import { availablePermissions } from "./Group.tsx";
import { uuidv7 } from "uuidv7";
import { TakosFetch } from "../../../utils/TakosFetch.ts";

export function GroupSettingRole() {
  const [selected, setSelected] = useAtom(selectedTabState);
  const [friendList, setFriendList] = useAtom(friendListState);
  const [selectedRoom] = useAtom(selectedRoomState);
  const [showDeleteRoleConfirm, setShowDeleteRoleConfirm] = useAtom(
    showDeleteRoleConfirmState,
  );

  // createSignalがあったところを全てuseAtomに置き換える
  const [showCreateRole, setShowCreateRole] = useAtom(showCreateRoleState);
  const [showEditRole, setShowEditRole] = useAtom(showEditRoleState);
  const [roleName, setRoleName] = useAtom(roleNameState);
  const [roleColor, setRoleColor] = useAtom(roleColorState);
  const [rolePermissions, setRolePermissions] = useAtom(rolePermissionsState);
  const [roleId, setRoleId] = useAtom(roleIdState);
  const [groupChannel, setGroupChannel] = useAtom(groupChannelState);
  return (
    <>
      {selected() === "role" && (
        <>
          <div class="flex flex-col w-full p-4">
            {/* 戻るボタン - 改善されたデザイン */}
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

            {/* ヘッダーとロール追加ボタン */}
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-xl font-bold text-white">ロール管理</h3>
              <button
                class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded flex items-center transition-colors"
                onClick={() => {
                  setShowCreateRole(true);
                  // 新規作成時は初期値をリセット
                  setRoleName("");
                  setRoleColor("#6366f1"); // インディゴ色をデフォルトに
                  setRolePermissions([]);
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 mr-1"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
                    clip-rule="evenodd"
                  />
                </svg>
                新規ロール
              </button>
            </div>

            {/* ロール説明 */}
            <p class="text-gray-400 text-sm mb-4">
              ロールを使用してメンバーに権限を付与したり、グループを整理したりできます。
            </p>

            {/* ロールリスト - 改善されたデザイン */}
            <div class="mt-2 w-full max-h-80 overflow-y-auto pr-1 custom-scrollbar">
              <For each={groupChannel()!.roles}>
                {(role) => (
                  <div class="bg-gray-800 rounded-lg mb-3 overflow-hidden hover:bg-gray-750 transition-colors">
                    <div class="p-3 flex justify-between items-center">
                      {/* ロール情報 */}
                      <div class="flex items-center space-x-3 flex-1 min-w-0">
                        {/* カラーインジケーター */}
                        <div
                          class="w-6 h-6 flex-shrink-0 rounded-md border border-gray-600 mr-2 shadow-sm"
                          style={{
                            "background-color": role.color ||
                              "#6366f1",
                            "box-shadow": `0 0 5px ${
                              role.color || "#6366f1"
                            }40`,
                          }}
                          title={role.name}
                        >
                        </div>

                        {/* ロール名と権限 */}
                        <div class="flex-1 min-w-0">
                          <div class="text-white font-medium mb-1 break-all">
                            {role.name}
                          </div>
                          <div class="text-xs text-gray-400 truncate">
                            {role.permissions &&
                                role.permissions.length > 0
                              ? role.permissions.join(", ")
                              : "権限なし"}
                          </div>
                        </div>
                      </div>

                      {/* アクションボタン */}
                      <div class="flex space-x-2">
                        <button
                          class="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded flex items-center transition-colors"
                          onClick={() => {
                            console.log(role);
                            setRolePermissions(
                              role.permissions || [],
                            );
                            setShowEditRole(role.id);
                            setRoleName(role.name);
                            setRoleColor(role.color);
                            setRoleId(role.id);
                          }}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 mr-1"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                          編集
                        </button>

                        {/* 削除ボタン - 新規追加 */}
                        <button
                          class="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded flex items-center transition-colors"
                          onClick={() => {
                            setRoleId(role.id);
                            setRoleName(role.name);
                            setShowDeleteRoleConfirm(true);
                          }}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 mr-1"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                              clip-rule="evenodd"
                            />
                          </svg>
                          削除
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </For>

              {/* ロールがない場合の表示 */}
              {groupChannel()!.roles.length === 0 && (
                <div class="flex flex-col items-center justify-center py-8 text-gray-400 bg-gray-800 rounded-lg">
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
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                  <p>
                    ロールがありません。新しいロールを作成しましょう
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ロール作成ポップアップ - デザイン改善 */}
          {showCreateRole() && (
            <PopUpFrame
              // @ts-ignore
              closeScript={setShowCreateRole}
            >
              <div class="p-5">
                <h3 class="text-xl font-bold text-white mb-4">
                  新規ロールの作成
                </h3>
                <div class="space-y-4">
                  <div>
                    <label class="block text-white text-sm font-medium mb-2">
                      ロール名
                    </label>
                    <input
                      type="text"
                      value={roleName()}
                      onInput={(e) => setRoleName(e.currentTarget.value)}
                      class="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring focus:ring-blue-500 focus:ring-opacity-50"
                      placeholder="ロール名を入力"
                    />
                  </div>

                  <div>
                    <label class="block text-white text-sm font-medium mb-2">
                      色
                    </label>
                    <div class="flex items-center space-x-3">
                      <input
                        type="color"
                        value={roleColor()}
                        onInput={(e) => setRoleColor(e.currentTarget.value)}
                        class="h-10 w-10 rounded cursor-pointer"
                      />
                      <span class="text-white">{roleColor()}</span>
                    </div>
                  </div>

                  <div>
                    <label class="block text-white text-sm font-medium mb-2">
                      権限
                    </label>
                    <div class="bg-gray-800 p-3 rounded-md max-h-40 overflow-y-auto grid grid-cols-2 gap-2">
                      {availablePermissions.map((perm) => (
                        <label class="inline-flex items-center p-2 hover:bg-gray-700 rounded">
                          <input
                            type="checkbox"
                            checked={rolePermissions().includes(perm)}
                            onChange={(e) => {
                              if (e.currentTarget.checked) {
                                setRolePermissions([
                                  ...rolePermissions(),
                                  perm,
                                ]);
                              } else {
                                setRolePermissions(
                                  rolePermissions().filter((p) => p !== perm),
                                );
                              }
                            }}
                            class="mr-2"
                          />
                          <span class="text-white text-sm">
                            {perm}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div class="flex justify-end mt-6 space-x-3">
                  <button
                    class="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded transition-colors"
                    onClick={() => setShowCreateRole(false)}
                  >
                    キャンセル
                  </button>
                  <button
                    class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded transition-colors"
                    onClick={async () => {
                      if (!roleName().trim()) {
                        alert("ロール名を入力してください");
                        return;
                      }

                      const match = selectedRoom()?.roomid.match(
                        /^g\{([^}]+)\}@(.+)$/,
                      );
                      if (!match) return;

                      const res = await TakosFetch(
                        "/api/v2/group/role/add",
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                          },
                          body: JSON.stringify({
                            groupId: match![1] + "@" + match![2],
                            name: roleName(),
                            color: roleColor(),
                            permissions: rolePermissions(),
                            id: uuidv7(),
                          }),
                        },
                      );

                      if (res.status !== 200) {
                        alert("エラーが発生しました");
                        return;
                      }

                      const friendUserName = match[1]!;
                      const domainFromRoom = match[2];
                      const baseUrl =
                        `https://${domainFromRoom}/_takos/v1/group`;

                      setTimeout(async () => {
                        const role = await TakosFetch(
                          `${baseUrl}/role/${
                            friendUserName + "@" + domainFromRoom
                          }`,
                        ).then((res) => res.json());
                        setGroupChannel((pre) => {
                          return {
                            ...pre!,
                            roles: role.roles,
                          };
                        });
                      }, 100);
                      setShowCreateRole(false);
                    }}
                  >
                    作成
                  </button>
                </div>
              </div>
            </PopUpFrame>
          )}

          {/* ロール編集ポップアップ - デザイン改善 */}
          {showEditRole() && (
            <PopUpFrame
              // @ts-ignore
              closeScript={setShowEditRole}
            >
              <div class="p-5">
                <h3 class="text-xl font-bold text-white mb-4">
                  ロールの編集
                </h3>
                <div class="space-y-4">
                  <div>
                    <label class="block text-white text-sm font-medium mb-2">
                      ロール名
                    </label>
                    <input
                      type="text"
                      value={roleName()}
                      onInput={(e) => setRoleName(e.currentTarget.value)}
                      class="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring focus:ring-blue-500 focus:ring-opacity-50"
                      placeholder="ロール名を入力"
                    />
                  </div>

                  <div>
                    <label class="block text-white text-sm font-medium mb-2">
                      色
                    </label>
                    <div class="flex items-center space-x-3">
                      <input
                        type="color"
                        value={roleColor()}
                        onInput={(e) => setRoleColor(e.currentTarget.value)}
                        class="h-10 w-10 rounded cursor-pointer"
                      />
                      <span class="text-white">{roleColor()}</span>
                    </div>
                  </div>

                  <div>
                    <label class="block text-white text-sm font-medium mb-2">
                      権限
                    </label>
                    <div class="bg-gray-800 p-3 rounded-md max-h-40 overflow-y-auto grid grid-cols-2 gap-2">
                      {availablePermissions.map((perm) => (
                        <label class="inline-flex items-center p-2 hover:bg-gray-700 rounded">
                          <input
                            type="checkbox"
                            checked={rolePermissions().includes(perm)}
                            onChange={(e) => {
                              if (e.currentTarget.checked) {
                                setRolePermissions([
                                  ...rolePermissions(),
                                  perm,
                                ]);
                              } else {
                                setRolePermissions(
                                  rolePermissions().filter((p) => p !== perm),
                                );
                              }
                            }}
                            class="mr-2"
                          />
                          <span class="text-white text-sm">
                            {perm}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div class="flex justify-end mt-6 space-x-3">
                  <button
                    class="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded transition-colors"
                    onClick={() => setShowEditRole(false)}
                  >
                    キャンセル
                  </button>
                  <button
                    class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors"
                    onClick={async () => {
                      if (!roleName().trim()) {
                        alert("ロール名を入力してください");
                        return;
                      }

                      const match = selectedRoom()?.roomid.match(
                        /^g\{([^}]+)\}@(.+)$/,
                      );
                      if (!match) return;
                      console.log({
                        groupId: match![1] + "@" + match![2],
                        name: roleName(),
                        color: roleColor(),
                        permissions: rolePermissions(),
                        id: roleId(),
                      });
                      await TakosFetch("/api/v2/group/role/add", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          groupId: match![1] + "@" + match![2],
                          name: roleName(),
                          color: roleColor(),
                          permissions: rolePermissions(),
                          id: roleId(),
                        }),
                      });

                      const friendUserName = match[1];
                      const domainFromRoom = match[2];
                      const baseUrl =
                        `https://${domainFromRoom}/_takos/v1/group`;

                      setTimeout(async () => {
                        const role = await TakosFetch(
                          `${baseUrl}/role/${
                            friendUserName + "@" + domainFromRoom
                          }`,
                        ).then((res) => res.json());
                        setGroupChannel((pre) => {
                          return {
                            ...pre!,
                            roles: role.roles,
                          };
                        });
                      }, 100);
                      setShowEditRole(false);
                    }}
                  >
                    保存
                  </button>
                </div>
              </div>
            </PopUpFrame>
          )}

          {/* ロール削除確認ポップアップ - 新規追加 */}
          {showDeleteRoleConfirm() && (
            <PopUpFrame
              // @ts-ignore
              closeScript={setShowDeleteRoleConfirm}
            >
              <div class="p-5">
                <h3 class="text-xl font-bold text-white mb-2">
                  ロールの削除
                </h3>
                <div class="mb-5">
                  <div class="flex items-start">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-6 w-6 text-red-500 mr-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <p class="text-white">
                      <span class="font-medium">"{roleName()}"</span>{" "}
                      ロールを削除しますか？この操作は元に戻せません。
                    </p>
                  </div>
                  <div class="mt-3 text-gray-400 text-sm">
                    このロールを持つメンバーからは、このロールによって付与された権限が削除されます。
                  </div>
                </div>

                <div class="flex justify-end space-x-3">
                  <button
                    class="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded transition-colors"
                    onClick={() => setShowDeleteRoleConfirm(false)}
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
                          "/api/v2/group/role/delete",
                          {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              groupId: match[1] + "@" + match[2],
                              roleId: roleId(),
                            }),
                          },
                        );

                        if (res.status !== 200) {
                          alert(
                            "ロールの削除中にエラーが発生しました",
                          );
                          return;
                        }

                        const friendUserName = match[1];
                        const domainFromRoom = match[2];
                        const baseUrl =
                          `https://${domainFromRoom}/_takos/v1/group`;

                        setTimeout(async () => {
                          const role = await TakosFetch(
                            `${baseUrl}/role/${
                              friendUserName + "@" + domainFromRoom
                            }`,
                          ).then((res) => res.json());

                          setGroupChannel((pre) => ({
                            ...pre!,
                            roles: role.roles,
                          }));
                        }, 100);

                        setShowDeleteRoleConfirm(false);
                      } catch (err) {
                        console.error(
                          "ロール削除中にエラーが発生しました",
                          err,
                        );
                        alert("ロール削除中にエラーが発生しました");
                      }
                    }}
                  >
                    削除する
                  </button>
                </div>
              </div>
            </PopUpFrame>
          )}
        </>
      )}
    </>
  );
}
