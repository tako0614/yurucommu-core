import { createSignal, Setter } from "solid-js";
import { PopUpFrame } from "../../utils/popUpFrame";
import { useAtom } from "solid-jotai";
import { groupChannelState } from "../../sidebar/SideBar";
import { selectedRoomState } from "../../../utils/room/roomState";
import { TakosFetch } from "../../../utils/TakosFetch";

export function ChannelEditModal(props: {
  channel: string;
  onClose: Setter<boolean>;
  type: "channel" | "category";
}) {
  const [groupChannel] = useAtom(groupChannelState);
  const channelInfo = props.type === "channel"
    ? groupChannel()?.channels?.find((channel) => channel.id === props.channel)
    : groupChannel()?.categories?.find((category) =>
      category.id === props.channel
    );
  const [selectedRoom] = useAtom(selectedRoomState);
  const [channelName, setChannelName] = createSignal(channelInfo?.name || "");
  const [channelCategory, setChannelCategory] = createSignal(
    //@ts-ignore
    props ? channelInfo?.category || "" : "",
  );
  // permissions の permission を string[] に変更
  const initialPermissions = channelInfo?.permissions
    ? [...channelInfo.permissions]
    : [];
  const [permissions, setPermissions] = createSignal<
    { roleId: string; permissions: string[] }[]
  >(initialPermissions);
  const handlePermissionChange = (
    index: number,
    field: "roleId" | "permissions",
    value: string | string[],
  ) => {
    setPermissions((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const roomId = selectedRoom()?.roomid;
    const much = roomId?.match(/^g\{([^}]+)\}@(.+)$/);
    if (!much) return console.error("Invalid roomid");
    const groupId = much[1] + "@" + much[2];
    if (props.type === "channel") {
      const res = await TakosFetch("/api/v2/group/channel/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          groupId: groupId,
          name: channelName(),
          id: props.channel,
          categoryId: channelCategory(),
          permissions: permissions(),
        }),
      });
      if (!res.ok) {
        console.error("Failed to edit channel");
        return;
      }
      alert("チャンネルを編集しました");
    } else {
      const res = await TakosFetch("/api/v2/group/category/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          groupId: groupId,
          name: channelName(),
          id: props.channel,
          permissions: permissions().map((perm) => ({
            roleId: perm.roleId,
            permissions: perm.permissions,
          })),
        }),
      });
      if (!res.ok) {
        console.error("Failed to edit category");
        return;
      }
      alert("カテゴリーを編集しました");
    }
  };
  const [collapsedStates, setCollapsedStates] = createSignal<boolean[]>(
    permissions().map(() => true),
  );

  const toggleCollapsed = (index: number) => {
    const newStates = [...collapsedStates()];
    newStates[index] = !newStates[index];
    setCollapsedStates(newStates);
  };

  const addPermission = () => {
    setPermissions((prev) => {
      const updated = [...prev, { roleId: "", permissions: [] }];
      // 新たな項目は折りたたみ状態で追加
      setCollapsedStates(updated.map(() => true));
      return updated;
    });
  };
  const removeRole = (index: number) => {
    setPermissions((prev) => {
      const updated = [...prev];
      updated.splice(index, 1);
      return updated;
    });
    setCollapsedStates((prev) => {
      const updated = [...prev];
      updated.splice(index, 1);
      return updated;
    });
  };
  return (
    <PopUpFrame closeScript={props.onClose}>
      <form onSubmit={handleSubmit} class="p-4">
        <h2 class="text-xl font-bold mb-4">チャンネル編集</h2>
        <div class="mb-4">
          <label class="block mb-1">チャンネル名</label>
          <input
            type="text"
            value={channelName()}
            onChange={(e) => setChannelName(e.currentTarget.value)}
            class="w-full p-2 border rounded text-black"
          />
        </div>
        {props.type === "channel" && (
          <div class="mb-4">
            <label class="block mb-1">カテゴリー</label>
            <select
              value={channelCategory()}
              onChange={(e) => setChannelCategory(e.currentTarget.value)}
              class="w-full p-2 border rounded text-black"
            >
              <option value="">カテゴリーなし</option>
              {groupChannel()?.categories?.map((category) => (
                <option value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>
        )}
        <div class="mb-4">
          <label class="block mb-1">権限設定 (roleId と permission)</label>
          {permissions().map((perm, index) => (
            <div class="border border-gray-300 rounded mb-2">
              <div
                class="flex justify-between items-center bg-gray-200 p-2 cursor-pointer text-black"
                onClick={() => toggleCollapsed(index)}
              >
                <span>{perm.roleId || "新しい権限"}</span>
                <span>{collapsedStates()[index] ? "▼" : "▲"}</span>
              </div>
              {!collapsedStates()[index] && (
                <div class="p-2">
                  <div class="flex justify-between items-center mb-2">
                    <input
                      type="text"
                      value={perm.roleId}
                      placeholder="roleId"
                      onChange={(e) =>
                        handlePermissionChange(
                          index,
                          "roleId",
                          e.currentTarget.value,
                        )}
                      class="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRole(index);
                      }}
                      class="ml-2 bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-3 rounded transition-colors duration-200"
                    >
                      削除
                    </button>
                  </div>
                  <div class="mb-2">
                    {[
                      "SEND_MESSAGE",
                      "VIEW_MESSAGE",
                      "MENTION_USER",
                      "MANAGE_MESSAGE",
                    ].map((permission) => (
                      <label class="inline-flex items-center mr-2">
                        <input
                          type="checkbox"
                          checked={perm.permissions.includes(permission)}
                          onChange={(e) => {
                            const newPermissions = [...perm.permissions];
                            if (e.currentTarget.checked) {
                              if (!newPermissions.includes(permission)) {
                                newPermissions.push(permission);
                              }
                            } else {
                              const idx = newPermissions.indexOf(permission);
                              if (idx > -1) {
                                newPermissions.splice(idx, 1);
                              }
                            }
                            handlePermissionChange(
                              index,
                              "permissions",
                              newPermissions,
                            );
                          }}
                          class="mr-1"
                        />
                        {permission}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addPermission}
            class="mt-2 px-4 py-2 bg-gray-300 rounded"
          >
            + 追加
          </button>
        </div>
        <div class="flex justify-end">
          <button
            type="button"
            onClick={() => props.onClose(false)}
            class="mr-2 px-4 py-2 border rounded"
          >
            キャンセル
          </button>
          <button
            type="submit"
            class="px-4 py-2 bg-blue-500 text-white rounded"
          >
            保存
          </button>
        </div>
      </form>
    </PopUpFrame>
  );
}
