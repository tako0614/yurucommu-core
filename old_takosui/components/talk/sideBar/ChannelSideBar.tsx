import { useAtom, useSetAtom } from "solid-jotai";
import {
  contextMenuPositionState,
  messagesState,
  messageTimeLineState,
  processedMessageIdsState,
  showCreateChannelModalState,
  showEditChannelModalState,
} from "../Content";
import { createSignal, JSX, onCleanup, onMount } from "solid-js";
import {
  selectedChannelState,
  selectedRoomState,
} from "../../../utils/room/roomState";
import { groupChannelState } from "../../sidebar/SideBar";
import { messageListState } from "../../../utils/state";
import { TakosFetch } from "../../../utils/TakosFetch";

export function ChannelSideBar() {
  const [showCreateChannelModal, setShowCreateChannelModal] = useAtom(
    showCreateChannelModalState,
  );
  const [processedMessageIds, setProcessedMessageIds] = useAtom(
    processedMessageIdsState,
  );
  const setContextMenuPosition = useSetAtom(contextMenuPositionState);
  const [selectedChannel, setSelectedChannel] = useAtom(selectedChannelState);
  const [isOpenChannel, setIsOpenChannel] = createSignal(false);
  const [isSelectRoom] = useAtom(selectedRoomState);
  const [groupChannel] = useAtom(groupChannelState);
  const [showContextMenu, setShowContextMenu] = createSignal(false);
  const [contextMenuTarget, setContextMenuTarget] = createSignal<
    { id: string; type: "channel" | "category" | null }
  >({ id: "", type: null });
  const [menuPosition, setMenuPosition] = createSignal({ x: 0, y: 0 });
  const [sellectedRoom] = useAtom(selectedRoomState);
  const setMessageList = useSetAtom(messageListState);
  const setShowEditChannelModal = useSetAtom(showEditChannelModalState);
  // クリックでコンテキストメニューを閉じる
  onMount(() => {
    const clickHandler = (_e: MouseEvent) => {
      setShowContextMenu(false);
    };
    document.addEventListener("click", clickHandler);
    onCleanup(() => {
      document.removeEventListener("click", clickHandler);
    });
  });
  // サイドバーの空き領域に対する右クリックメニュー用のハンドラー
  const handleSidebarContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // スクロール位置を考慮した位置計算
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setMenuPosition({ x, y });
    setContextMenuTarget({ id: "sidebar", type: null });
    setShowContextMenu(true);
  };
  function createChannel() {
    setShowCreateChannelModal(true);
  }
  const handleContextMenu = (e: MouseEvent, id: string, type: string) => {
    e.preventDefault();
    e.stopPropagation(); // 親要素へのイベント伝播を防止

    // スクロール位置を考慮した位置計算
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setMenuPosition({ x, y });
    setContextMenuTarget({
      id,
      type: type as "channel" | "category",
    });
    setShowContextMenu(true);
  };
  const handleMenuItemClick = (item: string) => {
    console.log(item + " clicked");
    setShowContextMenu(false);
  };
  const setMessages = useSetAtom(messagesState);
  const [messageTimeLine, setMessageTimeLine] = useAtom(messageTimeLineState);
  return (
    <>
      {isSelectRoom()?.type === "group" && (
        <>
          {isOpenChannel() === true && (
            <>
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 0,
                  transform: "translateY(-50%)",
                  "background-color": "rgba(32, 34, 37, 0.85)", // より濃い背景色で視認性向上
                  "box-shadow": "0 4px 12px rgba(0, 0, 0, 0.15)", // シャドウ追加
                }}
                class="z-[99] border-t border-r border-b border-solid border-gray-600 rounded-r-lg h-4/5 max-w-[400px] w-full transition-all duration-200"
                onContextMenu={handleSidebarContextMenu}
              >
                <div class="flex items-center justify-between border-b border-gray-700 px-5 py-3 bg-gray-800 rounded-tr-lg">
                  <h2 class="text-xl font-semibold text-white">チャンネル</h2>
                  <button
                    onClick={() => setIsOpenChannel(!isOpenChannel())}
                    aria-label="閉じる"
                    class="text-gray-400 hover:text-white text-2xl transition-colors focus:outline-none"
                  >
                    &times;
                  </button>
                </div>
                <div class="overflow-y-auto h-[calc(100%-54px)]">
                  <ul class="p-talk-list-rooms__ul py-2">
                    {(() => {
                      const groupInfo = groupChannel();
                      if (!groupInfo) return <></>;
                      function ChannelCompornent({
                        name,
                        id,
                      }: {
                        name: string;
                        id: string;
                      }) {
                        return (
                          <li class="hover:bg-gray-700 rounded relative">
                            <button
                              class={`w-full text-left py-2 px-4 text-white transition-colors ${
                                selectedChannel() === id
                                  ? "bg-[#181818] border-l-2 border-blue-500 rounded-lg"
                                  : "hover:bg-gray-600"
                              }`}
                              onClick={async () => {
                                setSelectedChannel(id);
                                const match = sellectedRoom()?.roomid.match(
                                  /^g\{([^}]+)\}@(.+)$/,
                                );
                                if (!match) {
                                  return console.error("Invalid roomid");
                                }

                                try {
                                  const messages = await TakosFetch(
                                    "/api/v2/message/group/" +
                                      sellectedRoom()?.roomid + "/" + id,
                                  );

                                  if (!messages.ok) {
                                    console.error(
                                      "Failed to TakosFetch messages",
                                    );
                                    return;
                                  }

                                  const messagesJson =
                                    (((await messages.json()).messages) as {
                                      userName: string;
                                      messageid: string;
                                      timestamp: string;
                                    }[]).sort((a, b) =>
                                      new Date(a.timestamp).getTime() -
                                      new Date(b.timestamp).getTime()
                                    );

                                  // 新しいチャンネルを選択したとき、メッセージリストとキャッシュをリセット
                                  setProcessedMessageIds(() =>
                                    new Set<string>()
                                  );
                                  setMessages([]);
                                  setMessageTimeLine([]);

                                  // 遅延してセットすることで状態が正しく更新されるようにする
                                  setTimeout(() => {
                                    setMessageList(messagesJson);
                                  }, 10);
                                } catch (error) {
                                  console.error(
                                    "Error TakosFetching messages:",
                                    error,
                                  );
                                }
                              }}
                              onContextMenu={(e) =>
                                handleContextMenu(e, id, "channel")}
                            >
                              {name}
                            </button>

                            {/* チャンネルのコンテキストメニュー */}
                            {showContextMenu() &&
                              contextMenuTarget().id === id &&
                              contextMenuTarget().type === "channel" && (
                              <div
                                class="absolute bg-gray-800 text-white rounded-lg shadow-lg p-2 animate-fadeIn z-50"
                                style={{
                                  left: `${menuPosition().x}px`,
                                  top: `${menuPosition().y}px`,
                                  position: "fixed",
                                }}
                              >
                                <ul>
                                  <li
                                    class="cursor-pointer p-2 hover:bg-gray-700 rounded transition-colors duration-200"
                                    onClick={() => {
                                      handleMenuItemClick("編集");
                                      setContextMenuPosition({
                                        x: 0,
                                        y: 0,
                                        type: "channel",
                                        id: id,
                                      });
                                      setShowEditChannelModal(true);
                                    }}
                                  >
                                    編集
                                  </li>
                                  <li
                                    class="cursor-pointer p-2 hover:bg-gray-700 rounded transition-colors duration-200"
                                    onClick={async () => {
                                      const match = sellectedRoom()?.roomid
                                        .match(
                                          /^g\{([^}]+)\}@(.+)$/,
                                        );
                                      if (!match) {
                                        return console.error("Invalid roomid");
                                      }

                                      const res = await TakosFetch(
                                        "/api/v2/group/channel/delete",
                                        {
                                          method: "POST",
                                          headers: {
                                            "Content-Type": "application/json",
                                          },
                                          body: JSON.stringify({
                                            groupId: match[1] + "@" + match[2],
                                            channelId: id,
                                          }),
                                        },
                                      );
                                      if (!res.ok) {
                                        console.error(
                                          "Failed to delete channel",
                                        );
                                      }
                                      alert("チャンネルを削除しました");
                                      setShowContextMenu(false);
                                    }}
                                  >
                                    削除
                                  </li>
                                  <li
                                    class="cursor-pointer p-2 hover:bg-gray-700 rounded transition-colors duration-200"
                                    onClick={async () => {
                                      const match = sellectedRoom()?.roomid
                                        .match(
                                          /^g\{([^}]+)\}@(.+)$/,
                                        );
                                      if (!match) {
                                        return console.error("Invalid roomid");
                                      }

                                      const res = await TakosFetch(
                                        "/api/v2/group/channel/default",
                                        {
                                          method: "POST",
                                          headers: {
                                            "Content-Type": "application/json",
                                          },
                                          body: JSON.stringify({
                                            groupId: match[1] + "@" + match[2],
                                            channelId: id,
                                          }),
                                        },
                                      );
                                      if (!res.ok) {
                                        return console.error(
                                          "Failed to set default channel",
                                        );
                                      }
                                      alert(
                                        "チャンネルをデフォルトに設定しました",
                                      );
                                      setShowContextMenu(false);
                                    }}
                                  >
                                    デフォルトに設定
                                  </li>
                                </ul>
                              </div>
                            )}
                          </li>
                        );
                      }
                      function ChannelCategory({
                        name,
                        children,
                        id,
                      }: {
                        name: string;
                        id: string;
                        children: JSX.Element;
                      }) {
                        return (
                          <li class="mt-2 hover:bg-gray-700 relative">
                            <div
                              class="px-4 py-2"
                              onContextMenu={(e) =>
                                handleContextMenu(e, id, "category")}
                            >
                              <span class="block text-gray-300 font-semibold">
                                {name}
                              </span>
                              {children}
                            </div>

                            {/* カテゴリーのコンテキストメニュー */}
                            {showContextMenu() &&
                              contextMenuTarget().id === id &&
                              contextMenuTarget().type === "category" && (
                              <div
                                class="absolute bg-gray-800 text-white rounded-lg shadow-lg p-2 animate-fadeIn z-50"
                                style={{
                                  left: `${menuPosition().x}px`,
                                  top: `${menuPosition().y}px`,
                                  position: "fixed",
                                }}
                              >
                                <ul>
                                  <li
                                    class="cursor-pointer p-2 hover:bg-gray-700 rounded transition-colors duration-200"
                                    onClick={() => {
                                      handleMenuItemClick("編集");
                                      setContextMenuPosition({
                                        x: 0,
                                        y: 0,
                                        type: "category",
                                        id: id,
                                      });
                                      setShowEditChannelModal(true);
                                    }}
                                  >
                                    編集
                                  </li>
                                  <li
                                    class="cursor-pointer p-2 hover:bg-gray-700 rounded transition-colors duration-200"
                                    onClick={async () => {
                                      const match = sellectedRoom()?.roomid
                                        .match(
                                          /^g\{([^}]+)\}@(.+)$/,
                                        );
                                      if (!match) {
                                        return console.error("Invalid roomid");
                                      }

                                      const res = await TakosFetch(
                                        "/api/v2/group/category/delete",
                                        {
                                          method: "POST",
                                          headers: {
                                            "Content-Type": "application/json",
                                          },
                                          body: JSON.stringify({
                                            groupId: match[1] + "@" + match[2],
                                            categoryId: id,
                                          }),
                                        },
                                      );
                                      if (!res.ok) {
                                        console.error(
                                          "Failed to delete category",
                                        );
                                      }
                                      alert("カテゴリーを削除しました");
                                      setShowContextMenu(false);
                                    }}
                                  >
                                    削除
                                  </li>
                                  <li
                                    class="cursor-pointer p-2 hover:bg-gray-700 rounded transition-colors duration-200 text-gray-400"
                                    onClick={() => {
                                      alert(
                                        "カテゴリーはデフォルトにできません",
                                      );
                                      setShowContextMenu(false);
                                    }}
                                  >
                                    デフォルトに設定
                                  </li>
                                </ul>
                              </div>
                            )}
                          </li>
                        );
                      }
                      return (
                        <>
                          {groupInfo.categories
                            .map((category) => {
                              const categoryChannels = groupInfo.channels
                                .filter((channel) =>
                                  channel.category === category.id
                                );

                              return (
                                <ChannelCategory
                                  name={category.name}
                                  id={category.id}
                                  children={
                                    <ul>
                                      {categoryChannels.map((channel) => (
                                        <ChannelCompornent
                                          name={channel.name}
                                          id={channel.id}
                                        />
                                      ))}
                                    </ul>
                                  }
                                />
                              );
                            })}
                          {groupInfo.channels
                            .filter((channel) => !channel.category)
                            .map((channel) => (
                              <ChannelCompornent
                                name={channel.name}
                                id={channel.id}
                              />
                            ))}
                        </>
                      );
                    })()}
                  </ul>
                  {/* サイドバーのコンテキストメニュー */}
                  {showContextMenu() && contextMenuTarget().id === "sidebar" &&
                    (
                      <div
                        class="bg-gray-800 text-white rounded-lg shadow-lg p-2 animate-fadeIn z-50"
                        style={{
                          left: `${menuPosition().x}px`,
                          top: `${menuPosition().y}px`,
                          position: "fixed",
                        }}
                      >
                        <ul>
                          <li
                            class="cursor-pointer p-2 hover:bg-gray-700 rounded transition-colors duration-200"
                            onClick={() => {
                              createChannel();
                              setShowContextMenu(false);
                            }}
                          >
                            チャンネル作成
                          </li>
                        </ul>
                      </div>
                    )}
                  {/* チャンネル作成ボタンを削除 */}
                </div>
              </div>
            </>
          )}
          {isOpenChannel() === false && (
            <button
              style={{
                position: "absolute",
                top: "50%",
                left: 0,
                transform: "translateY(-50%)",
              }}
              class="z-[9999] bg-[#12121288] px-1 py-4 border-t border-r border-b border-solid border-gray-300 rounded-r-lg"
              onClick={() => setIsOpenChannel(!isOpenChannel())}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                xmlns="http://www.w3.org/2000/svg"
              >
                <polygon points="0,0 12,6 0,12" fill="currentColor" />
              </svg>
            </button>
          )}
        </>
      )}
    </>
  );
}
