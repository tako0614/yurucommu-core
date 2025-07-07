import {
  isSelectRoomState,
  selectedRoomState,
} from "../../utils/room/roomState.ts";
import { messageListState } from "../../utils/state.ts";
import { atom, useAtom, useSetAtom } from "solid-jotai";
import ChatSendMessage from "./message/SendMessage.tsx";
import ChatOtherMessage from "./message/OtherMessage.tsx";
import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { MessageContentType, MessageData } from "../../types/message.ts";
import { getCachedMessage } from "../../utils/message/messageCache.ts";
import { ChannelSideBar } from "./sideBar/ChannelSideBar.tsx";
import LoadingAnimation from "./LoadingAnimation.tsx";
import MentionReplyDisplay from "./send/MentionReplyDisplay.tsx";
import { userId } from "../../utils/userId.ts";

// 状態管理
export const messagesState = atom<MessageData[]>([]);
export const isLoadedMessageState = atom(false);
export const processedMessageIdsState = atom<Set<string>>(new Set<string>());
export const messageTimeLineState = atom<MessageData[]>([]);
export const showCreateChannelModalState = atom(false);
export const showEditChannelModalState = atom(false);
export const contextMenuPositionState = atom<
  { x: number; y: number; type: "channel" | "category" | null; id: string }
>({ x: 0, y: 0, type: null, id: "" });

// メッセージロード処理
function useMessageLoader() {
  const [processedMessageIds, setProcessedMessageIds] = useAtom(
    processedMessageIdsState,
  );
  const [messageList] = useAtom(messageListState);
  const [loaded, setLoaded] = useAtom(isLoadedMessageState);
  const [selectedRoom] = useAtom(selectedRoomState);
  const [messages, setMessages] = useAtom(messagesState);
  const setMessageTimeLine = useSetAtom(messageTimeLineState);

  const loadMessages = async () => {
    const currentMessageList = messageList();
    const roomid = selectedRoom()?.roomid;
    const type = selectedRoom()?.type;

    // 基本チェック
    if (currentMessageList.length === 0) {
      setMessageTimeLine([]);
      setMessages([]);
      setLoaded(true);
      return;
    }

    if (!roomid || !type) {
      return;
    }

    // メッセージリストが空の場合はリセット
    if (currentMessageList.length === 0) {
      setMessages([]);
      setProcessedMessageIds(() => new Set<string>());
      setMessageTimeLine([]);
      setLoaded(true);
      return;
    }

    // ルームが変わったらか、強制リロードフラグが立っていれば処理済みIDリストをリセット
    if (
      messages().length > 0 &&
      (messages()[0].roomid !== roomid || !loaded())
    ) {
      setMessages([]);
      setProcessedMessageIds(() => new Set<string>());
    }

    // まだ処理していないメッセージだけをフィルタリング
    const newMessages = currentMessageList.filter(
      (msg) => !processedMessageIds().has(`${msg.messageid}-${roomid}`),
    );

    // 新規メッセージがない場合
    if (newMessages.length === 0 && loaded()) {
      // 既存メッセージから情報を取得
      const result = messageList().map((messageIds) =>
        messages().find((msg) => msg.messageid === messageIds.messageid)
      ).filter(Boolean) as MessageData[];

      setMessageTimeLine(result);
      return;
    }

    // 新規メッセージを処理
    const processedIds = new Set(processedMessageIds());
    const messagesResult = await Promise.all(
      newMessages.map(async (message) => {
        // 処理済みとしてマーク
        processedIds.add(`${message.messageid}-${roomid}`);
        return getCachedMessage(
          message.messageid,
          roomid,
          type,
          message.userName,
        );
      }),
    );

    // 新しいメッセージを既存のメッセージに追加
    setProcessedMessageIds(processedIds);
    const validMessages = messagesResult.filter(Boolean);

    if (validMessages.length > 0) {
      setMessages((prev) => [...prev, ...validMessages]);

      // タイムラインの構築
      const allMessages = [...messages(), ...validMessages];
      const uniqueMessages = new Map<string, MessageData>();

      // 重複を排除して最新のメッセージを保持
      allMessages.forEach((msg) => uniqueMessages.set(msg.messageid, msg));

      // メッセージIDリストの順序に従ってメッセージを並べる
      const result = messageList()
        .map((messageIds) => uniqueMessages.get(messageIds.messageid))
        .filter(Boolean) as MessageData[];

      setMessageTimeLine(result);
    }

    setLoaded(true);
  };

  return { loadMessages };
}

// メッセージ表示コンポーネント
function MessageDisplay({ message }: { message: MessageData }) {
  const [show, setShow] = createSignal(false);

  // コンポーネントがマウントされたら表示アニメーションを開始
  onMount(() => {
    setTimeout(() => setShow(true), 50);
  });
  const messageContent = () => {
    if (message.serverData.userName === userId) {
      return (
        <ChatSendMessage
          time={message.serverData.timestamp}
          content={{
            verified: message.verified,
            encrypted: message.encrypted,
            content: message.content,
            type: message.type as MessageContentType,
            timestamp: message.timestamp,
            original: message.original,
            // リプライとメンション情報を追加
            reply: message.reply,
            mention: message.mention || [], // undefined対策
          }}
          messageid={message.messageid}
          isPrimary={true}
          isSendPrimary={true}
        />
      );
    } else {
      return (
        <ChatOtherMessage
          name={message.serverData.userName}
          time={message.serverData.timestamp}
          content={{
            verified: message.verified,
            encrypted: message.encrypted,
            content: message.content,
            type: message.type,
            timestamp: message.timestamp,
            original: message.original,
            // リプライとメンション情報を追加
            reply: message.reply,
            mention: message.mention || [], // undefined対策
          }}
          messageid={message.messageid}
          isPrimary={true}
          isTakosFetch={true}
        />
      );
    }
  };

  return (
    <div
      class="message-container"
      classList={{ "message-show": show() }}
      style={{
        "opacity": show() ? "1" : "0",
        "transform": show() ? "translateY(0)" : "translateY(10px)",
        "transition": "opacity 0.3s ease, transform 0.3s ease",
      }}
    >
      {messageContent()}
    </div>
  );
}

// メッセージリストコンポーネント
function ChatTalkMain() {
  const { loadMessages } = useMessageLoader();
  const [messageList] = useAtom(messageListState);
  const [loaded] = useAtom(isLoadedMessageState);
  const [messageTimeLine] = useAtom(messageTimeLineState);
  const [prevMessageCount, setPrevMessageCount] = createSignal(0);
  const [shouldAutoScroll, setShouldAutoScroll] = createSignal(true);
  const [hasNewMessages, setHasNewMessages] = createSignal(false);
  const [isIOS] = createSignal(/iPad|iPhone|iPod/.test(navigator.userAgent));

  // SolidJSの正しいref設定方法
  const [chatListRef, setChatListRef] = createSignal<HTMLDivElement>();

  // メッセージのロード
  createEffect(() => {
    loadMessages();
  });

  // スクロール位置検出
  const handleScroll = (e: Event) => {
    const element = e.target as HTMLDivElement;
    const isNearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 100;
    setShouldAutoScroll(isNearBottom);

    // 最下部までスクロールしたら通知を消す
    if (isNearBottom && hasNewMessages()) {
      setHasNewMessages(false);
    }
  };

  // 最新メッセージへスクロールする関数
  const scrollToBottom = () => {
    const element = chatListRef();
    if (element) {
      element.scrollTo({
        top: element.scrollHeight,
        behavior: "smooth",
      });
      setHasNewMessages(false);
    }
  };

  // スクロール管理の改善
  createEffect(() => {
    const currentMessageCount = messageTimeLine().length;
    const element = chatListRef();

    if (element && currentMessageCount > 0) {
      // 新しいメッセージが追加された場合
      if (currentMessageCount > prevMessageCount()) {
        // 最新のメッセージが自分のメッセージか確認
        const lastMessage = messageTimeLine()[currentMessageCount - 1];
        const isOwnMessage = lastMessage?.serverData.userName === userId;

        // 自分のメッセージまたはスクロールが下にある場合は自動スクロール
        if (shouldAutoScroll() || isOwnMessage) {
          setTimeout(() => {
            element.scrollTo({
              top: element.scrollHeight,
              behavior: isIOS() ? "auto" : "smooth", // iOSはsmoothが重いので
            });
            // スクロールしたので通知は不要
            setHasNewMessages(false);
          }, 100);
        } else {
          // それ以外の場合は新しいメッセージがあることを通知
          setHasNewMessages(true);
        }
      }

      setPrevMessageCount(currentMessageCount);
    }
  });

  // リサイズ時にも必要に応じてスクロールする
  createEffect(() => {
    const handleResize = () => {
      if (shouldAutoScroll()) {
        const element = chatListRef();
        if (element) {
          setTimeout(() => {
            element.scrollTo({
              top: element.scrollHeight,
              behavior: isIOS() ? "auto" : "smooth",
            });
          }, 100);
        }
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  });

  return (
    <div class="relative flex flex-col h-full w-full">
      <div
        class="pl-2 flex-1 overflow-y-auto pb-4 overscroll-contain"
        id="chatList"
        ref={setChatListRef}
        onScroll={handleScroll}
        style={{
          "-webkit-overflow-scrolling": "touch", // iOSでのスムーズスクロール
          "padding-bottom": "env(safe-area-inset-bottom, 16px)", // ノッチ対応
        }}
      >
        {loaded()
          ? (
            <For each={messageTimeLine()}>
              {(message) => <MessageDisplay message={message} />}
            </For>
          )
          : <LoadingAnimation />}
      </div>

      {/* 新しいメッセージがある場合に表示するボタン */}
      <Show when={hasNewMessages()}>
        <div
          class="absolute bottom-16 right-6 bg-blue-600 text-white px-4 py-2 rounded-full shadow-lg cursor-pointer z-10 flex items-center transition-opacity duration-300 opacity-90 hover:opacity-100"
          onClick={scrollToBottom}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5 mr-2"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a 1 1 0 010 1.414z"
              clip-rule="evenodd"
              transform="rotate(180, 10, 10)"
            />
          </svg>
          最新のメッセージ
        </div>
      </Show>
    </div>
  );
}

// メインコンポーネント
function ChatTalk() {
  const [isChoiceUser] = useAtom(isSelectRoomState);

  return (
    <>
      {isChoiceUser()
        ? (
          <div class="h-full w-full overflow-hidden flex flex-col">
            <ChannelSideBar />
            <div class="flex-1 overflow-hidden flex flex-col">
              <ChatTalkMain />
            </div>
            <MentionReplyDisplay />
          </div>
        )
        : (
          <div class="flex w-full h-full">
            <p class="m-auto">友達を選択してください</p>
          </div>
        )}
    </>
  );
}

export default ChatTalk;
