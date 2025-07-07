import { inputMessageState, isValidInputState } from "../../../utils/state.ts";
import { useAtom } from "solid-jotai";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import {
  selectedChannelState,
  selectedRoomState,
} from "../../../utils/room/roomState.ts";
import {
  clearMentionReplyState,
  EVERYONE_MENTION_ID,
  mentionEveryone,
  mentionListState,
  replyTargetState,
} from "../../../utils/message/mentionReply.ts";
import {
  currentOperationAtom,
  isEncryptedAtom,
  isMenuOpenAtom,
  isSendingAtom,
  loadEncryptionSetting,
  menuPositionAtom,
  sendingProgressAtom,
  sendTextHandler,
} from "../../../utils/message/messageUtils.tsx";
import {
  cancelPastedImage,
  confirmAndSendPastedImage,
  handleMediaSelect,
  handlePastedImage,
} from "../../../utils/media/mediaHandler.ts";
import ImagePasteConfirmModal, {
  pasteImagePreviewAtom,
  showPasteConfirmAtom,
} from "./ImagePasteConfirmModal.tsx";
function ChatSend() {
  const [inputMessage, setInputMessage] = useAtom(inputMessageState);
  const [isValidInput, setIsValidInput] = useAtom(isValidInputState);
  const [isSending] = useAtom(isSendingAtom);
  const [sendingProgress] = useAtom(sendingProgressAtom);
  const [currentOperation] = useAtom(currentOperationAtom);
  const [mentionList] = useAtom(mentionListState);
  const [replyTarget] = useAtom(replyTargetState);
  const [isEncrypted, setIsEncrypted] = useAtom(isEncryptedAtom);
  const [isMenuOpen, setIsMenuOpen] = useAtom(isMenuOpenAtom);
  const [menuPosition, setMenuPosition] = useAtom(menuPositionAtom);
  const [showPasteConfirm] = useAtom(showPasteConfirmAtom);
  const [pasteImagePreview] = useAtom(pasteImagePreviewAtom);
  const [isIOS] = createSignal(/iPad|iPhone|iPod/.test(navigator.userAgent));
  const [textareaRef, setTextareaRef] = createSignal<HTMLTextAreaElement>();
  const [selectedRoom] = useAtom(selectedRoomState);

  // 暗号化設定を読み込む
  createEffect(async () => {
    const room = selectedRoom();
    if (room?.roomid) {
      const setting = await loadEncryptionSetting(room.roomid);
      setIsEncrypted(setting !== false); // undefinedの場合もtrueとして扱う
    }
  });

  // 暗号化切り替え処理
  const toggleEncryption = () => {
    setIsEncrypted(!isEncrypted());
  };

  // メニュー表示切り替え処理
  const toggleMenu = (e: MouseEvent) => {
    e.stopPropagation();

    // ボタンの位置を取得して画面端からの距離を計算
    const buttonElement = e.currentTarget as HTMLElement;
    const rect = buttonElement.getBoundingClientRect();
    const distanceFromRight = window.innerWidth - rect.right;

    // 右端から250px以内の場合は右揃えに切り替え (w-48 = 12rem = ~192px + 余裕)
    if (distanceFromRight < 250) {
      setMenuPosition("right");
    } else {
      setMenuPosition("left");
    }

    setIsMenuOpen(!isMenuOpen());
  };

  // メニュー外クリックで閉じる
  const closeMenu = () => {
    if (isMenuOpen()) {
      setIsMenuOpen(false);
    }
  };

  // iOS向けのキーボード対応
  onMount(() => {
    if (isIOS()) {
      const handleFocus = () => {
        // フォーカス時にビューポートを調整
        setTimeout(() => {
          window.scrollTo(0, 0);
          document.body.scrollTop = 0;
        }, 300);
      };

      const handleBlur = () => {
        // フォーカスが外れたら少し待って元に戻す
        setTimeout(() => {
          window.scrollTo(0, 0);
        }, 100);
      };

      const textarea = textareaRef();
      if (textarea) {
        textarea.addEventListener("focus", handleFocus);
        textarea.addEventListener("blur", handleBlur);
      }

      onCleanup(() => {
        if (textarea) {
          textarea.removeEventListener("focus", handleFocus);
          textarea.removeEventListener("blur", handleBlur);
        }
      });
    }
  });

  // コンポーネントのマウント時にドキュメント全体のクリックイベントを設定
  createEffect(() => {
    if (isMenuOpen()) {
      document.addEventListener("click", closeMenu);
    } else {
      document.removeEventListener("click", closeMenu);
    }

    // クリーンアップ関数
    return () => {
      document.removeEventListener("click", closeMenu);
    };
  });

  const handleFileSelect = () => {
    console.log("ファイル選択");
    setIsMenuOpen(false);
  };

  // メニュー項目に「全員をメンション」ボタンを追加
  const menuItems = [
    {
      label: "ファイル",
      icon: (
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
      ),
      onClick: handleFileSelect,
    },
    {
      label: "全員をメンション",
      icon: (
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
          <path d="M17 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-6"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
      ),
      onClick: () => {
        mentionEveryone();
        setIsMenuOpen(false);
      },
    },
    {
      label: isEncrypted() ? "暗号化をオフにする" : "暗号化をオンにする",
      icon: (
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
          {isEncrypted()
            ? (
              <path d="M12 17a2 2 0 0 0 2-2v-2H10v2a2 2 0 0 0 2 2zm7-7h-1V8A6 6 0 0 0 6 8v2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z">
              </path>
            )
            : (
              <path d="M19 11H5c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7c0-1.1-.9-2-2-2zm-1 9H6c-.55 0-1-.45-1-1v-5h14v5c0 .55-.45 1-1 1zm-6-13c-2.21 0-4 1.79-4 4v2h2V7c0-1.1.9-2 2-2s2 .9 2 2v2h2V7c0-2.21-1.79-4-4-4z">
              </path>
            )}
        </svg>
      ),
      onClick: () => {
        toggleEncryption();
        setIsMenuOpen(false);
      },
    },
  ];

  return (
    <div
      class="p-talk-chat-send relative bg-[#1e1e1e] py-2 px-4"
      style={{
        "padding-bottom": "calc(env(safe-area-inset-bottom, 8px) + 8px)",
      }}
    >
      <form class="p-talk-chat-send__form" onSubmit={(e) => e.preventDefault()}>
        <div class="p-talk-chat-send__msg flex items-center">
          <div
            class="p-talk-chat-send__dummy"
            aria-hidden="true"
          >
            {inputMessage().split("\n").map((row) => (
              <>
                {row}
                <br />
              </>
            ))}
          </div>
          <label class="flex-1">
            <textarea
              class="p-talk-chat-send__textarea w-full py-2 px-3"
              placeholder="メッセージを入力"
              value={inputMessage()}
              ref={setTextareaRef}
              onInput={(e) => {
                if (e.target) {
                  //0文字以上の場合はtrue
                  setIsValidInput(e.target.value.length > 0);
                  setInputMessage(e.target.value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendTextHandler();
                }
              }}
              onPaste={async (e) => {
                // クリップボード画像処理を試みる
                const handled = await handlePastedImage(e);
                // 画像が処理された場合は、テキスト貼り付けはデフォルトの挙動に任せる
              }}
            >
            </textarea>
          </label>
        </div>
        <div class="flex items-center mt-2">
          {/* 暗号化状態インジケーター */}
          <div
            class={`flex items-center mr-2 px-2 py-1 rounded-full text-xs ${
              isEncrypted()
                ? "bg-green-700 bg-opacity-25 text-green-400"
                : "bg-yellow-700 bg-opacity-25 text-yellow-400"
            }`}
            onClick={toggleEncryption}
            title={isEncrypted()
              ? "暗号化オン (クリックで切り替え)"
              : "暗号化オフ (クリックで切り替え)"}
            style="cursor: pointer;"
          >
            {isEncrypted()
              ? (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-3.5 w-3.5 mr-1"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  暗号化
                </>
              )
              : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-3.5 w-3.5 mr-1"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                  </svg>
                  非暗号化
                </>
              )}
          </div>

          {/* メニューボタン */}
          <div class="relative">
            <div
              class="p-2 cursor-pointer hover:bg-[#2e2e2e] rounded-full transition-colors mr-2"
              onClick={toggleMenu}
              title="メニューを開く"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </div>

            {/* ドロップダウンメニュー */}
            <div
              class={`absolute bottom-12 ${
                menuPosition() === "right" ? "right-0" : "left-0"
              } bg-[#333333] rounded-md shadow-lg py-2 w-48 z-50 ${
                isMenuOpen() ? "block" : "hidden"
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {menuItems.map((item) => (
                <button
                  type="button"
                  class="w-full text-left px-4 py-2 hover:bg-[#444444] flex items-center"
                  onClick={item.onClick}
                >
                  <span class="mr-2">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* 画像ボタン */}
          <div
            class="mr-2 p-2 cursor-pointer hover:bg-[#2e2e2e] rounded-full transition-colors"
            onClick={handleMediaSelect}
            title="写真・動画を送信"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
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
          </div>
          {/* 送信ボタン */}
          <div
            class={isValidInput()
              ? "p-talk-chat-send__button is-active"
              : "p-talk-chat-send__button"}
            onClick={sendTextHandler}
          >
            <svg
              width="800px"
              height="800px"
              viewBox="0 0 28 28"
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g stroke="none" stroke-width="1" fill="none">
                <g fill="#000000">
                  <path d="M3.78963301,2.77233335 L24.8609339,12.8499121 C25.4837277,13.1477699 25.7471402,13.8941055 25.4492823,14.5168992 C25.326107,14.7744476 25.1184823,14.9820723 24.8609339,15.1052476 L3.78963301,25.1828263 C3.16683929,25.4806842 2.42050372,25.2172716 2.12264586,24.5944779 C1.99321184,24.3238431 1.96542524,24.015685 2.04435886,23.7262618 L4.15190935,15.9983421 C4.204709,15.8047375 4.36814355,15.6614577 4.56699265,15.634447 L14.7775879,14.2474874 C14.8655834,14.2349166 14.938494,14.177091 14.9721837,14.0981464 L14.9897199,14.0353553 C15.0064567,13.9181981 14.9390703,13.8084248 14.8334007,13.7671556 L14.7775879,13.7525126 L4.57894108,12.3655968 C4.38011873,12.3385589 4.21671819,12.1952832 4.16392965,12.0016992 L2.04435886,4.22889788 C1.8627142,3.56286745 2.25538645,2.87569101 2.92141688,2.69404635 C3.21084015,2.61511273 3.51899823,2.64289932 3.78963301,2.77233335 Z">
                  </path>
                </g>
              </g>
            </svg>
          </div>
        </div>
      </form>

      {/* 画像貼り付け確認モーダル */}
      <ImagePasteConfirmModal
        isOpen={showPasteConfirm()}
        imagePreview={pasteImagePreview()}
        onConfirm={confirmAndSendPastedImage}
        onCancel={cancelPastedImage}
      />
      {/* 送信中プログレスバー表示 */}
      <Show when={isSending()}>
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-[#333] p-6 rounded-lg shadow-lg max-w-md w-full">
            <h3 class="text-xl mb-3">ファイル送信中...</h3>
            <p class="mb-4">{currentOperation()}</p>
            <div class="w-full bg-gray-700 rounded-full h-2.5">
              <div
                class="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-in-out"
                style={{ width: `${sendingProgress()}%` }}
              >
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
export default ChatSend;
