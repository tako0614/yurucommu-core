import { atom, useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { createRoot } from "solid-js";
import { selectedChannelState, selectedRoomState } from "../room/roomState";
import { deviceKeyState, inputMessageState } from "../state";
import { decryptDataDeviceKey, encryptMessage } from "@takos/takos-encrypt-ink";
import { createRoomKey } from "../room/createRoomKey";
import { groupChannelState } from "../../components/sidebar/SideBar";
import { createTextContent } from "./getMessage";
import {
  clearMentionReplyState,
  EVERYONE_MENTION_ID,
  mentionListState,
  replyTargetState,
} from "./mentionReply";
import { getAllRoomKeys, getEncryptSetting } from "../storage/idb";
import { TakosFetch } from "../TakosFetch";
import { userId } from "../userId";
// Global state atoms
export const isSendingAtom = atom(false);
export const sendingProgressAtom = atom(0);
export const currentOperationAtom = atom("");
export const isEncryptedAtom = atom(true);
export const isMenuOpenAtom = atom(false);
export const menuPositionAtom = atom("left");

// 選択された部屋の暗号化設定を読み込む関数
export const loadEncryptionSetting = async (roomId: string) => {
  if (!roomId) return;
  try {
    const isEncrypted = await getEncryptSetting({ roomId });
    return isEncrypted;
  } catch (error) {
    console.error("暗号化設定の読み込みに失敗しました:", error);
    return true; // デフォルトでは暗号化を有効にする
  }
};

// Utility for reading files as base64
export const readFileAsBase64 = (
  file: File,
  stripPrefix = false,
): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (stripPrefix) {
        const base64Data = dataUrl.replace(/^data:.*?;base64,/, "");
        resolve(base64Data);
      } else {
        resolve(dataUrl);
      }
    };
    reader.readAsDataURL(file);
  });
};

export const createNewRoomKey = async (
  room: { roomid: any; type: any },
  decryptedIdentityKey: { privateKey: string },
  latestIdentityKey: { key: string },
  deviceKeyVal: string,
) => {
  return createRoot(() => {
    const roomId = room.roomid;
    const [groupChannel] = useAtom(groupChannelState);
    if (room.type === "friend") {
      const match = roomId.match(/^m\{([^}]+)\}@(.+)$/);
      if (!match) return null;

      const friendUserName = match[1];
      const domainFromRoom = match[2];

      return createRoomKey(
        roomId,
        [`${friendUserName}@${domainFromRoom}`],
        userId,
        decryptedIdentityKey.privateKey,
        latestIdentityKey.key,
        deviceKeyVal,
        "friend",
      );
    }

    if (room.type === "group") {
      const friendIds = groupChannel()?.members.map((user) => user.userId);
      if (!friendIds) return null;

      return createRoomKey(
        roomId,
        friendIds,
        userId,
        decryptedIdentityKey.privateKey,
        latestIdentityKey.key,
        deviceKeyVal,
        "group",
      );
    }

    return null;
  });
};

export const shouldCreateNewRoomKey = (
  room: { roomid?: string; type: any },
  latestRoomKey: string | null,
  encryptedRoomKey: {
    key?: string;
    encryptedKey?: string;
    timestamp: any;
    roomid?: string;
    metaData: any;
  },
) => {
  return createRoot(() => {
    const [groupChannel] = useAtom(groupChannelState);
    // キー有効期限切れチェック (10分)
    if (encryptedRoomKey.timestamp < new Date().getTime() - 1000 * 60 * 10) {
      return true;
    }

    // グループチャットのメンバー変更チェック
    if (room.type === "group" && latestRoomKey) {
      const previousMembers = JSON.parse(encryptedRoomKey.metaData).sharedUser
        .map((user: { userId: any }) => user.userId);

      const currentMembers = groupChannel()?.members
        .map((user) => user.userId);

      if (!previousMembers || !currentMembers) return true;
      if (previousMembers.length !== currentMembers.length) return true;

      // メンバーに変更があるか確認
      for (const member of previousMembers) {
        if (!currentMembers.includes(member)) {
          console.log("メンバーが変更されたため、新しいroomKeyを作成します");
          return true;
        }
      }
    }

    return false;
  });
};

export const getRoomKeyOrCreate = async (
  { room, deviceKeyVal, decryptedIdentityKey, latestIdentityKey }: {
    room: { roomid: string; type: string };
    deviceKeyVal: string;
    decryptedIdentityKey: any;
    latestIdentityKey: any;
  },
) => {
  const roomKeys = await getAllRoomKeys();
  const encryptedRoomKey = roomKeys
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((key) => key.roomid === room.roomid)[0];

  if (!encryptedRoomKey) {
    return createNewRoomKey(
      room,
      decryptedIdentityKey,
      latestIdentityKey,
      deviceKeyVal,
    );
  }

  // 既存キーの復号を試みる
  let latestRoomKey;
  try {
    latestRoomKey = await decryptDataDeviceKey(
      deviceKeyVal,
      encryptedRoomKey.encryptedKey,
    );
  } catch (error) {
    return createNewRoomKey(
      room,
      decryptedIdentityKey,
      latestIdentityKey,
      deviceKeyVal,
    );
  }

  // キーの再利用可否をチェック
  if (shouldCreateNewRoomKey(room, latestRoomKey, encryptedRoomKey)) {
    return createNewRoomKey(
      room,
      decryptedIdentityKey,
      latestIdentityKey,
      deviceKeyVal,
    );
  }

  return latestRoomKey;
};

export const sendEncryptedMessage = async (
  { roomId, message, sign, type, channelId }: {
    roomId: string;
    message: any;
    sign: any;
    type: string;
    channelId: string;
  },
) => {
  const res = await TakosFetch("/api/v2/message/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      roomId,
      message,
      sign,
      type,
      channelId,
      isEncrypted: true,
    }),
  });
  if (res.status == 200) {
    const body = await res.json();
    return { status: true, messageId: body.messageId };
  } else {
    return { status: false };
  }
};

// 非暗号化メッセージを送信する関数
export const sendUnencryptedMessage = async (
  { roomId, message, type, channelId }: {
    roomId: string;
    message: any;
    type: string;
    channelId: string;
  },
) => {
  const res = await TakosFetch("/api/v2/message/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      roomId,
      message,
      type,
      channelId,
      isEncrypted: false,
    }),
  });
  if (res.status == 200) {
    const body = await res.json();
    return { status: true, messageId: body.messageId };
  } else {
    return { status: false };
  }
};

export const sendHandler = async ({
  type,
  content,
  original = null,
  isLarge = false,
}: {
  type: "text" | "file" | "image" | "thumbnail" | "video";
  content: string;
  original?: string | null;
  isLarge?: boolean;
}) => {
  return createRoot(async () => {
    const [inputMessage, setInputMessage] = useAtom(inputMessageState);
    const [selectedRoom] = useAtom(selectedRoomState);
    const [deviceKey] = useAtom(deviceKeyState);
    const [selectedChannel] = useAtom(selectedChannelState);
    const [isSending, setIsSending] = useAtom(isSendingAtom);
    const [sendingProgress, setSendingProgress] = useAtom(sendingProgressAtom);
    const [currentOperation, setCurrentOperation] = useAtom(
      currentOperationAtom,
    );
    const [isEncrypted] = useAtom(isEncryptedAtom);
    // メンションとリプライ状態を取得
    const [mentionList] = useAtom(mentionListState);
    const [replyTarget] = useAtom(replyTargetState);

    try {
      if (isLarge) {
        setIsSending(true);
        setCurrentOperation("メッセージを準備中...");
      }

      const room = selectedRoom();
      if (!room?.roomid) return;

      const channel = room.type === "friend" ? "friend" : selectedChannel();
      if (!channel) {
        setIsSending(false);
        return;
      }

      const processedOriginal = original ? original : undefined;

      // メンションリストを処理
      const mention = mentionList().length > 0 ? mentionList() : [];

      // リプライ情報を処理
      const processedReply = replyTarget()
        ? { id: replyTarget()!.id }
        : undefined;

      // 非暗号化メッセージ送信処理
      if (!isEncrypted()) {
        setCurrentOperation("メッセージを送信中...");
        setSendingProgress(50);

        // 非暗号化メッセージの構築
        const unencryptedMessage = {
          encrypted: false,
          value: {
            type,
            content,
            reply: processedReply,
            mention,
          },
          channel,
          original: processedOriginal,
          timestamp: new Date().getTime(),
          isLarge,
        };

        // 非暗号化メッセージを送信
        const success = await sendUnencryptedMessage({
          roomId: room.roomid,
          message: JSON.stringify(unencryptedMessage),
          type: room.type,
          channelId: channel,
        });

        // 送信処理完了時に状態をリセット
        setIsSending(false);
        setSendingProgress(0);

        if (success && success.status) {
          setInputMessage("");
          // メッセージ送信成功時にメンションとリプライ状態をリセット
          clearMentionReplyState();
          return success.messageId;
        } else {
          console.error("メッセージ送信に失敗しました");
          return;
        }
      }

      // 以下は暗号化メッセージ送信処理（既存コード）
      const deviceKeyVal = deviceKey();
      if (!deviceKeyVal) return;
      setCurrentOperation("暗号化キーを確認中...");
      const { decryptedIdentityKey, latestIdentityKey } = await getIdentityKeys(
        deviceKeyVal,
      );
      if (!decryptedIdentityKey) {
        setIsSending(false);
        return;
      }
      const roomKey = await getRoomKeyOrCreate({
        room,
        deviceKeyVal,
        decryptedIdentityKey,
        latestIdentityKey,
      });
      if (!roomKey) {
        setIsSending(false);
        return;
      }

      setCurrentOperation("メッセージを暗号化中...");
      setSendingProgress(50);
      const encrypted = await encryptMessage(
        {
          type,
          content: content,
          channel,
          timestamp: new Date().getTime(),
          isLarge,
          mention,
          reply: processedReply,
          original: processedOriginal,
        },
        roomKey,
        {
          privateKey: decryptedIdentityKey.privateKey,
          pubKeyHash: latestIdentityKey!.key,
        },
        room.roomid,
      );
      if (!encrypted) {
        setIsSending(false);
        return;
      }

      setCurrentOperation("メッセージを送信中...");
      setSendingProgress(80);

      const success = await sendEncryptedMessage({
        roomId: room.roomid,
        message: encrypted.message,
        sign: encrypted.sign,
        type: room.type,
        channelId: channel,
      });

      // 送信処理完了時に状態をリセット
      setIsSending(false);
      setSendingProgress(0);

      if (success) {
        setInputMessage("");
        // メッセージ送信成功時にメンションとリプライ状態をリセット
        clearMentionReplyState();
      }
      if (success.status === false) {
        console.error("メッセージ送信に失敗しました");
        return;
      }
      return success.messageId;
    } catch (error) {
      console.error("メッセージ送信中にエラーが発生しました:", error);
      // エラー時も送信状態をリセット
      setIsSending(false);
      setSendingProgress(0);
    }
  });
};

export function convertLineBreak(message: string | null | undefined) {
  if (message === null || message === undefined) return;
  const messageValue = JSON.parse(message) as { text: string; format: string };
  if (messageValue.format === "text") {
    return messageValue.text.split("\n").map((line) => (
      <span>
        {line}
        <br />
      </span>
    ));
  }
  if (messageValue.format === "markdown") {
    return messageValue.text;
  }
}

export function convertTime(time: string | number | Date) {
  const date = new Date(time);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "午後" : "午前";
  const hour = hours % 12;
  const zeroPaddingHour = hour === 0 ? 12 : hour;
  const zeroPaddingMinutes = String(minutes).padStart(2, "0");
  return `${ampm} ${zeroPaddingHour}:${zeroPaddingMinutes}`;
}

export const sendTextHandler = async () => {
  return createRoot(async () => {
    const [isValidInput] = useAtom(inputMessageState);
    const [inputMessage] = useAtom(inputMessageState);
    const [mentionList] = useAtom(mentionListState);
    const [replyTarget] = useAtom(replyTargetState);

    // 入力検証と必要な値の確認
    if (!isValidInput()) return;
    const input = inputMessage();
    if (!input) return;
    const textContent = createTextContent({
      text: input,
      format: "text",
    });
    // メンションリストからeveryoneを処理
    const mentionsToSend = mentionList().includes(EVERYONE_MENTION_ID)
      ? [EVERYONE_MENTION_ID] // everyoneが含まれている場合はそれだけを送信
      : mentionList();

    await sendHandler({
      type: "text",
      content: textContent,
    });
    // sendHandler内でリセットされるため、ここでの呼び出しは冗長になりました
    // clearMentionReplyState();
  });
};

/**
 * メッセージの種類に応じた内容を抽出してクリップボードにコピーする
 * @param content メッセージ内容オブジェクト
 * @returns コピー成功時はtrue、失敗時はfalseを返す
 */
export async function copyMessageContent(content: {
  type: string;
  content: string;
}): Promise<boolean> {
  try {
    switch (content.type) {
      case "text": {
        const messageValue = JSON.parse(content.content) as {
          text: string;
          format: string;
        };
        await navigator.clipboard.writeText(messageValue.text);
        return true;
      }

      case "image": {
        const imageContent = JSON.parse(content.content) as {
          uri: string;
          metadata: { filename: string; mimeType: string };
        };

        // 通知用のテキストを準備
        const imageText = `[画像: ${imageContent.metadata.filename}]`;
        await navigator.clipboard.writeText(imageText);

        // ブラウザによっては画像自体をクリップボードにコピーできない場合がある
        try {
          const dataUrl =
            `data:${imageContent.metadata.mimeType};base64,${imageContent.uri}`;
          const blob = await TakosFetch(dataUrl).then((res) => res.blob());
          const clipboardItem = new ClipboardItem({
            [imageContent.metadata.mimeType]: blob,
          });
          await navigator.clipboard.write([clipboardItem]);
        } catch (e) {
          console.log("画像のコピーはテキスト形式のみサポートされています", e);
          // エラーが発生しても、テキストのコピーは成功していればtrueを返す
        }
        return true;
      }

      case "video": {
        const videoContent = JSON.parse(content.content) as {
          metadata: { filename: string };
        };
        const videoText = `[動画: ${videoContent.metadata.filename}]`;
        await navigator.clipboard.writeText(videoText);
        return true;
      }

      case "thumbnail": {
        const thumbnailContent = JSON.parse(content.content) as {
          originalType: "image" | "video";
        };

        const mediaType = thumbnailContent.originalType === "image"
          ? "画像"
          : "動画";
        await navigator.clipboard.writeText(`[${mediaType}]`);
        return true;
      }

      default:
        await navigator.clipboard.writeText(
          `[サポートされていないメッセージタイプ: ${content.type}]`,
        );
        return true;
    }
  } catch (err) {
    console.error("メッセージのコピーに失敗しました:", err);
    return false;
  }
}

import { decryptIdentityKey, getAllIdentityKeys } from "../storage/idb";
import { shoowIdentityKeyPopUp } from "../../components/encrypted/CreateIdentityKeyPopUp";

export async function getIdentityKeys(deviceKeyVal: string) {
  return createRoot(async () => {
    const [showIdentityKeyPopUp, setShowIdentityKeyPopUp] = useAtom(
      shoowIdentityKeyPopUp,
    );
    const identityKeys = await getAllIdentityKeys();
    const latestIdentityKey = identityKeys.sort((a, b) =>
      b.timestamp - a.timestamp
    )[0];
    if (!latestIdentityKey) {
      setShowIdentityKeyPopUp(true);
      return { decryptedIdentityKey: null, latestIdentityKey: null };
    }
    const decryptedIdentityKey = await decryptIdentityKey({
      deviceKey: deviceKeyVal,
      encryptedIdentityKey: latestIdentityKey.encryptedKey,
    });

    return { decryptedIdentityKey, latestIdentityKey };
  });
}
