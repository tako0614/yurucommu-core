import { createEffect, createSignal, For, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { DEFAULT_ICON } from "../../utils/defaultIcon.ts";
import { iconsState, nickNamesState } from "../../../utils/state.ts";
import { ContextMenu } from "./ContextMenu.tsx";
import { getMessage } from "../../../utils/message/getMessage.ts";
import { selectedRoomState } from "../../../utils/room/roomState.ts";
import {
  convertTime,
  copyMessageContent,
} from "../../../utils/message/messageUtils.tsx";

import { getSecurityStatus, renderMessageContent } from "./MessageContent.tsx";
import {
  mentionEveryone,
  setReplyToMessage,
  toggleMention,
} from "../../../utils/message/mentionReply.ts";
import { ReplyMessagePreview } from "./ReplyMessagePreview.tsx";
import {
  TakosFetchEntityInfo,
  TakosFetchMultipleEntityInfo,
} from "../../../utils/chache/Icon.ts";
import MentionDisplay from "./MentionDisplay.tsx";

// props型定義に reply と mention を追加
export interface ChatOtherMessageProps {
  name: string;
  time: string | number | Date;
  content: {
    verified: boolean;
    encrypted: boolean;
    content: string;
    type: string;
    timestamp: string | number | Date;
    original?: string;
    reply?: {
      id: string;
    };
    mention?: string[];
  };
  messageid: string;
  isPrimary: boolean;
  isTakosFetch?: boolean;
}

// インターフェースを使用するようにコンポーネント定義を修正
const ChatOtherMessage = (props: ChatOtherMessageProps) => {
  const isPrimaryClass = props.isPrimary
    ? "c-talk-chat other primary"
    : "c-talk-chat other subsequent";
  const [icon, setIcon] = createSignal(DEFAULT_ICON);
  const [nickName, setNickName] = createSignal("");
  const [icons, setIcons] = useAtom(iconsState);
  const [nickNames, setNickNames] = useAtom(nickNamesState);
  const [mentionInfos, setMentionInfos] = createSignal(new Map());
  const [showMentionList, setShowMentionList] = createSignal(false);

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

  // ユーザーを報告
  const reportUser = () => {
    alert(`${props.name} を報告する機能は開発中です`);
  };

  // メンションリストの表示切り替え
  const toggleMentionList = () => {
    setShowMentionList(!showMentionList());
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
          props.content.type as any,
          props.content.content,
        );
        setShowContextMenu(false);
      },
    },
    {
      label: "メンション",
      onClick: () => {
        toggleMention(props.name);
        setShowContextMenu(false);
      },
    },
    {
      label: "全員をメンション",
      onClick: () => {
        mentionEveryone();
        setShowContextMenu(false);
      },
    },
    { label: "ユーザーを報告", onClick: reportUser },
  ];

  createEffect(async () => {
    if (!props.isTakosFetch) return;

    // ローカルステートから情報を取得
    const iconData = icons().find((value) => value.key === props.name);
    const nickNameData = nickNames().find((value) => value.key === props.name);

    // 既にアイコンとニックネームが取得済みの場合はそれを使用
    if (iconData) {
      setIcon(iconData.icon);
    }
    if (nickNameData) {
      setNickName(nickNameData.nickName);
    }

    // 両方とも取得済みならAPI呼び出しは不要
    if (iconData && nickNameData) {
      return;
    }

    try {
      const domain = props.name.split("@")[1];
      // 共有キャッシュから情報を取得
      const result = await TakosFetchEntityInfo(props.name, domain, "friend");

      // アイコン情報を設定
      if (!iconData && result.icon) {
        setIcon(result.icon);
        // グローバルステートにも保存
        setIcons(
          (prev) => [...prev, {
            key: props.name,
            icon: result.icon,
            type: "friend",
          }],
        );
      }

      // ニックネーム情報を設定
      if (!nickNameData && result.nickName) {
        setNickName(result.nickName);
        // グローバルステートにも保存
        setNickNames(
          (prev) => [...prev, {
            key: props.name,
            nickName: result.nickName,
            type: "friend",
          }],
        );
      }
    } catch (error) {
      console.error(`Failed to TakosFetch user info for ${props.name}:`, error);
    }
  });

  // メンションされたユーザーの情報を取得
  createEffect(async () => {
    if (props.content.mention && props.content.mention.length > 0) {
      try {
        const mentionMap = await TakosFetchMultipleEntityInfo(
          props.content.mention,
        );
        setMentionInfos(mentionMap);
      } catch (error) {
        console.error("メンション情報の取得に失敗しました", error);
      }
    }
  });

  return (
    <li class={isPrimaryClass}>
      <div class="c-talk-chat-box mb-1" onContextMenu={handleContextMenu}>
        {props.isPrimary && (
          <div class="c-talk-chat-icon">
            <img
              src={icon()}
              alt="image"
              class="rounded-full text-white dark:text-black"
            />
          </div>
        )}
        <div class="c-talk-chat-right">
          {props.isPrimary && (
            <div class="c-talk-chat-name">
              <p>{nickName()}</p>
            </div>
          )}
          <div class="flex flex-col space-y-1">
            <Show
              when={props.content.mention && props.content.mention.length > 0}
            >
              <MentionDisplay
                mentions={props.content.mention || []}
                align="start"
              />
            </Show>
            <Show when={props.content.reply?.id}>
              <ReplyMessagePreview replyId={props.content.reply!.id} />
            </Show>
            <div class="flex items-end">
              {renderMessageContent(props.content, props.name)}
              <span class="text-xs text-gray-500 ml-2">
                {convertTime(props.time)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 右クリックメニュー */}
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

export default ChatOtherMessage;
