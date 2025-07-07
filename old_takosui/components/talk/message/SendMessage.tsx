import { createSignal, Show } from "solid-js";
import { ContextMenu } from "./ContextMenu.tsx";
import {
  convertTime,
  copyMessageContent,
} from "../../../utils/message/messageUtils.tsx";
import { getSecurityStatus, renderMessageContent } from "./MessageContent.tsx";
import { setReplyToMessage } from "../../../utils/message/mentionReply.ts";
import { MessageContentType } from "../../../types/message.ts";
import { ReplyMessagePreview } from "./ReplyMessagePreview.tsx";
import MentionDisplay from "./MentionDisplay.tsx";
import { TakosFetch } from "../../../utils/TakosFetch.ts";
import { userId } from "../../../utils/userId.ts";

// props型定義に reply と mention を追加
export interface ChatSendMessageProps {
  time: string | number | Date;
  content: {
    verified: boolean;
    encrypted: boolean;
    content: string;
    type: MessageContentType;
    timestamp: string | number | Date;
    original?: string;
    reply?: {
      id: string;
    };
    mention?: string[];
  };
  messageid: string;
  isPrimary: boolean;
  isSendPrimary: boolean;
}

// インターフェースを使用するようにコンポーネント定義を修正
const ChatSendMessage = (props: ChatSendMessageProps) => {
  const isPrimaryClass = `c-talk-chat self ${
    props.isPrimary ? "primary" : "subsequent"
  }${props.isSendPrimary ? " mt-2" : ""}`;

  // 右クリックメニュー用の状態
  const [showContextMenu, setShowContextMenu] = createSignal(false);
  const [contextMenuPosition, setContextMenuPosition] = createSignal({
    x: 0,
    y: 0,
  });

  // 右クリックイベントハンドラ
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  // メッセージをコピー
  const copyMessage = async () => {
    const success = await copyMessageContent(props.content);
    if (success) {
      alert("メッセージをクリップボードにコピーしました");
    } else {
      alert("メッセージのコピーに失敗しました");
    }
  };

  // メッセージを削除
  const deleteMessage = async () => {
    if (confirm("このメッセージを削除しますか？")) {
      try {
        const res = await TakosFetch("/api/v2/message/delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messageId: props.messageid }),
        });
        if (!res.ok) {
          throw new Error("メッセージ削除に失敗しました");
        }
        console.log("メッセージ削除:", props.messageid);
      } catch (error) {
        console.error("メッセージ削除エラー:", error);
      }
    }
  };

  // セキュリティステータス情報を取得
  const getSecurityInfo = () => {
    return getSecurityStatus(props.content.encrypted, props.content.verified);
  };

  // セキュリティ情報を表示する関数
  const showSecurityInfo = () => {
    const { encryptionStatus, verificationStatus } = getSecurityInfo();

    alert(`メッセージセキュリティ情報:
${encryptionStatus.icon} ${encryptionStatus.text}
${verificationStatus.icon} ${verificationStatus.text}`);
  };

  // セキュリティ情報をヘッダーとして表示
  const securityHeader = () => {
    const { encryptionStatus, verificationStatus } = getSecurityInfo();
    return (
      <div
        class="flex justify-between items-center w-full px-1"
        onClick={showSecurityInfo}
      >
        <div class={`flex items-center ${encryptionStatus.class}`}>
          <span class="mr-1">{encryptionStatus.icon}</span>
          <span class="text-sm">{encryptionStatus.text}</span>
        </div>
        <div class={`flex items-center ${verificationStatus.class}`}>
          <span class="mr-1">{verificationStatus.icon}</span>
          <span class="text-sm">{verificationStatus.text}</span>
        </div>
      </div>
    );
  };

  // メニュー項目の定義 (セキュリティ情報を削除)
  const menuItems = [
    { label: "メッセージをコピー", onClick: copyMessage },
    {
      label: "リプライ",
      onClick: () => {
        setReplyToMessage(
          props.messageid,
          props.content.type,
          props.content.content,
        );
        setShowContextMenu(false);
      },
    },
    { label: "メッセージを削除", onClick: deleteMessage, danger: true },
  ];

  return (
    <li class={isPrimaryClass}>
      <div
        class="c-talk-chat-box mb-[3px] max-w-full"
        onContextMenu={handleContextMenu}
      >
        <div class="c-talk-chat-right flex flex-col items-end ml-auto">
          <div class="flex flex-col items-end space-y-1 w-full text-right">
            <Show
              when={props.content.mention && props.content.mention.length > 0}
            >
              <MentionDisplay
                mentions={props.content.mention || []}
                align="end"
              />
            </Show>
            <Show when={props.content.reply?.id}>
              <div class="w-full">
                <ReplyMessagePreview replyId={props.content.reply!.id} />
              </div>
            </Show>
            <div class="flex items-end">
              <span class="text-xs text-gray-500 mr-2">
                {convertTime(props.time)}
              </span>
              {renderMessageContent(props.content, userId)}
            </div>
          </div>
        </div>
      </div>

      {showContextMenu() && (
        <ContextMenu
          x={contextMenuPosition().x}
          y={contextMenuPosition().y}
          items={menuItems}
          onClose={() => setShowContextMenu(false)}
          header={securityHeader()}
        />
      )}
    </li>
  );
};

export default ChatSendMessage;
