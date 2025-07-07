import { MessageData } from "../../types/message";
import { getMessage } from "./getMessage";

// メッセージキャッシュ
const messageCache = new Map<string, MessageData>();

export const getCachedMessage = async (
  messageid: string,
  roomId: string,
  type: string,
  senderId: string,
): Promise<MessageData> => {
  // キャッシュキーを作成
  const cacheKey = `${messageid}-${roomId}`;

  // キャッシュをチェック
  if (messageCache.has(cacheKey)) {
    return messageCache.get(cacheKey)!;
  }

  try {
    const serverData = await getMessage({
      messageid,
      roomId,
      type,
      senderId,
    });
    const messageData: MessageData = {
      verified: serverData.verified,
      encrypted: serverData.encrypted,
      content: serverData.value.content,
      type: String(serverData.value.type),
      timestamp: Number(serverData.timestamp),
      messageid,
      roomid: roomId,
      original: serverData.original,
      // リプライとメンション情報を追加
      reply: serverData.value.reply,
      mention: serverData.value.mention || [],
      serverData: {
        userName: senderId,
        timestamp: Number(serverData.timestamp),
      },
    };

    // キャッシュに保存
    messageCache.set(cacheKey, messageData);

    return messageData;
  } catch (error) {
    const errorMessage: MessageData = {
      verified: false,
      encrypted: false,
      content: JSON.stringify({
        text:
          "メッセージが復号されていない可能性があるため、\n表示できません。",
        format: "text",
      }),
      type: "text",
      timestamp: new Date().getTime(),
      messageid,
      roomid: roomId,
      // エラーメッセージにも空の配列/undefを設定
      reply: undefined,
      mention: [],
      serverData: {
        userName: senderId,
        timestamp: new Date().getTime(),
      },
    };

    // エラーメッセージもキャッシュ
    messageCache.set(cacheKey, errorMessage);
    return errorMessage;
  }
};

export const clearRoomCache = (roomId: string) => {
  // 指定されたルームのキャッシュをクリア
  const keysToDelete: string[] = [];

  messageCache.forEach((_, key) => {
    if (key.endsWith(`-${roomId}`)) {
      keysToDelete.push(key);
    }
  });

  keysToDelete.forEach((key) => messageCache.delete(key));
};
