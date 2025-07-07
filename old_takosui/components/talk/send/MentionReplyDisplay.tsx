import { createEffect, createSignal, For, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import {
  EVERYONE_MENTION_ID,
  mentionListState,
  removeMention,
  replyTargetState,
} from "../../../utils/message/mentionReply";
import { DEFAULT_ICON } from "../../utils/defaultIcon";
import { iconsState, nickNamesState } from "../../../utils/state";

export const MentionReplyDisplay = () => {
  const [mentionList] = useAtom(mentionListState);
  const [replyTarget, setReplyTarget] = useAtom(replyTargetState);
  const [icons] = useAtom(iconsState);
  const [nickNames] = useAtom(nickNamesState);

  // リプライターゲットをクリア
  const clearReplyTarget = () => {
    setReplyTarget(null);
  };

  // メディアタイプに応じたアイコン表示
  const getContentTypeIcon = (type: string) => {
    switch (type) {
      case "image":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
        );
      case "video":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
            <line x1="7" y1="2" x2="7" y2="22"></line>
            <line x1="17" y1="2" x2="17" y2="22"></line>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <line x1="2" y1="7" x2="7" y2="7"></line>
            <line x1="2" y1="17" x2="7" y2="17"></line>
            <line x1="17" y1="17" x2="22" y2="17"></line>
            <line x1="17" y1="7" x2="22" y2="7"></line>
          </svg>
        );
      case "audio":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z">
            </path>
          </svg>
        );
      case "file":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z">
            </path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        );
      default:
        return null;
    }
  };

  // メンションユーザーのアイコンを取得
  const getUserIcon = (userId: string) => {
    // everyoneメンションの場合は特別なアイコンを返す
    if (userId === EVERYONE_MENTION_ID) {
      return "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJjdXJyZW50Q29sb3IiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS11c2VycyI+PHBhdGggZD0iTTE3IDIxdi0yYTQgNCAwIDAgMC00LTRIOWE0IDQgMCAwIDAtNCA0djIiLz48Y2lyY2xlIGN4PSI5IiBjeT0iNyIgcj0iNCIvPjxwYXRoIGQ9Ik0yMyAyMXYtMmE0IDQgMCAwIDAtMy02Ii8+PHBhdGggZD0iTTE2IDMuMTNhNCA0IDAgMCAxIDAgNy43NSIvPjwvc3ZnPg==";
    }
    // 通常のユーザー
    const userIcon = icons().find((iconData) => iconData.key === userId);
    return userIcon ? userIcon.icon : DEFAULT_ICON;
  };

  // メンションユーザーのニックネームを取得
  const getUserNickname = (userId: string) => {
    // everyoneメンションの場合
    if (userId === EVERYONE_MENTION_ID) {
      return "everyone";
    }
    // 通常のユーザー
    const userNickname = nickNames().find((nickData) =>
      nickData.key === userId
    );
    return userNickname ? userNickname.nickName : userId.split("@")[0];
  };

  // 特定のユーザーのメンションを削除
  const handleRemoveMention = (userId: string, e: Event) => {
    e.stopPropagation(); // 親要素へのイベント伝播を防止
    removeMention(userId);
  };

  return (
    <Show when={mentionList().length > 0 || replyTarget()}>
      <div class="p-talk-mention-reply bg-[#2a2a2a] rounded-md mb-2 p-2 mx-2">
        {/* メンションリスト表示 */}
        <Show when={mentionList().length > 0}>
          <div class="mb-2">
            <div class="text-xs text-gray-400 mb-1">メンション:</div>
            <div class="flex flex-wrap gap-2">
              <For each={mentionList()}>
                {(userId) => (
                  <div
                    class={`flex items-center rounded-full px-2 py-1 pr-1 ${
                      userId === EVERYONE_MENTION_ID
                        ? "bg-[#5865F2] bg-opacity-30"
                        : "bg-[#3a3a3a]"
                    }`}
                  >
                    <img
                      src={getUserIcon(userId)}
                      alt={getUserNickname(userId)}
                      class="w-5 h-5 rounded-full mr-1"
                    />
                    <span
                      class={`text-xs truncate max-w-[100px] ${
                        userId === EVERYONE_MENTION_ID ? "font-semibold" : ""
                      }`}
                    >
                      {getUserNickname(userId)}
                    </span>
                    <button
                      class="ml-1 p-1 text-gray-400 hover:text-white rounded-full hover:bg-[#4a4a4a] transition-colors"
                      onClick={(e) => handleRemoveMention(userId, e)}
                      title="メンションを削除"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
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
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* リプライ表示 */}
        <Show when={replyTarget()}>
          <div>
            <div class="text-xs text-gray-400 mb-1">リプライ先:</div>
            <div class="flex items-start bg-[#3a3a3a] rounded p-3 pr-10 relative">
              <Show when={replyTarget()}>
                {(reply) => (
                  <>
                    <div class="flex-shrink-0 mr-2">
                      <img
                        src={DEFAULT_ICON}
                        alt="User"
                        class="w-8 h-8 rounded-full"
                      />
                    </div>
                    <div class="flex-grow min-w-0">
                      <div class="text-sm font-medium mb-1">ユーザー</div>
                      <div class="text-sm break-words overflow-hidden text-ellipsis max-h-14">
                        {reply().type === "text"
                          ? (
                            <span>
                              {(JSON.parse(reply().content!)).text ||
                                "メッセージ"}
                            </span>
                          )
                          : (
                            <div class="flex items-center">
                              {getContentTypeIcon(reply().type)}
                              <span class="ml-1">
                                {reply().type === "image"
                                  ? "画像"
                                  : reply().type === "video"
                                  ? "動画"
                                  : reply().type === "audio"
                                  ? "音声"
                                  : "ファイル"}
                              </span>
                            </div>
                          )}
                      </div>
                    </div>
                    <button
                      class="absolute top-3 right-3 text-gray-400 hover:text-white"
                      onClick={clearReplyTarget}
                      title="リプライをキャンセル"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
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
                  </>
                )}
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default MentionReplyDisplay;
