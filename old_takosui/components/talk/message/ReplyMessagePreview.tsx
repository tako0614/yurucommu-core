import { createEffect, createSignal, Show } from "solid-js";
import { MessageContentType } from "../../../types/message";
import {
  messagesState,
  messageTimeLineState,
} from "../../../components/talk/Content";
import { useAtom } from "solid-jotai";

interface ReplyMessagePreviewProps {
  replyId: string;
}

// 拡張型を定義
type ExtendedMessageContentType =
  | "text"
  | "video"
  | "audio"
  | "file"
  | "image"
  | "thumbnail";

export function ReplyMessagePreview(props: ReplyMessagePreviewProps) {
  const [replyMessage, setReplyMessage] = createSignal<
    {
      content: string;
      type: ExtendedMessageContentType;
      userName: string;
      nickName?: string;
    } | null
  >(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(false);
  const [messages] = useAtom(messagesState);
  const [messageTimeLine] = useAtom(messageTimeLineState);

  createEffect(async () => {
    if (!props.replyId) {
      setLoading(false);
      setError(true);
      return;
    }

    try {
      setLoading(true);
      // まず現在表示中のメッセージタイムラインから検索
      const message = messageTimeLine().find((msg) =>
        msg.messageid === props.replyId
      );

      // 見つからなければ全メッセージから検索
      const foundMessage = message ||
        messages().find((msg) => msg.messageid === props.replyId);

      if (!foundMessage) {
        setError(true);
        return;
      }
      setReplyMessage({
        content: foundMessage.content,
        type: foundMessage.type as ExtendedMessageContentType,
        userName: foundMessage.serverData.userName,
        nickName: foundMessage.serverData.userName,
      });
      setError(false);
    } catch (e) {
      console.error("Failed to find reply message:", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  });

  const getPreviewContent = () => {
    if (error()) return "メッセージを取得できませんでした";
    if (loading()) return "読み込み中...";
    if (!replyMessage()) return "メッセージが見つかりません";

    const msg = replyMessage()!;
    let preview = "";

    try {
      if (msg.type === "text") {
        const content = JSON.parse(msg.content);
        preview = content.text.substring(0, 50);
        if (content.text.length > 50) preview += "...";
      } else if (msg.type === "image") {
        preview = "画像";
      } else if (msg.type === "video") {
        preview = "動画";
      } else if (msg.type === "thumbnail") {
        const content = JSON.parse(msg.content);
        preview = content.originalType === "image" ? "画像" : "動画";
      } else {
        preview = "メッセージ";
      }
    } catch (e) {
      preview = "メッセージの解析に失敗しました";
    }

    return preview;
  };

  const getNickName = () => {
    if (!replyMessage()) return "";
    return replyMessage()!.nickName || replyMessage()!.userName.split("@")[0];
  };

  const getMessageTypeIcon = () => {
    if (!replyMessage()) return null;

    const type = replyMessage()!.type;
    let isImage = type === "image";
    let isVideo = type === "video";

    // サムネイルの場合は安全にJSONをパース
    if (type === "thumbnail") {
      try {
        const content = JSON.parse(replyMessage()!.content);
        if (content && typeof content === "object" && content.originalType) {
          isImage = content.originalType === "image";
          isVideo = content.originalType === "video";
        }
      } catch (e) {
        console.error("Failed to parse thumbnail content:", e);
        // パースに失敗した場合はデフォルトでテキストアイコンとする
      }
    }

    // 画像アイコン
    if (isImage) {
      return (
        <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
        </svg>
      );
    } // 動画アイコン
    else if (isVideo) {
      return (
        <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 8v8l6-4-6-4zm11-5H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z" />
        </svg>
      );
    }

    // デフォルトはテキストメッセージアイコン
    return (
      <svg class="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
      </svg>
    );
  };

  return (
    <div class="flex items-center py-1 px-2 border-l-2 border-blue-500 text-sm opacity-80 hover:opacity-100 transition-opacity">
      <div class="flex-shrink-0 text-blue-500 dark:text-blue-400">
        {getMessageTypeIcon()}
      </div>
      <div class="flex-1 overflow-hidden">
        <Show
          when={!loading() && !error()}
          fallback={
            <span class="text-gray-600 dark:text-gray-400 italic">
              {loading() ? "読み込み中..." : "メッセージを取得できませんでした"}
            </span>
          }
        >
          <div class="font-medium text-blue-600 dark:text-blue-400">
            {getNickName()}
          </div>
          <div class="text-gray-700 dark:text-gray-400 truncate text-xs">
            {getPreviewContent()}
          </div>
        </Show>
      </div>
    </div>
  );
}
