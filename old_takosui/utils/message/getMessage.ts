import { decryptAccountKey, getAccountKey } from "../storage/idb";
import { useAtom } from "solid-jotai";
import { deviceKeyState } from "../state";
import {
  decryptDataAccountKey,
  decryptDataDeviceKey,
  decryptDataRoomKey,
} from "@takos/takos-encrypt-ink";
import { TakosFetch } from "../TakosFetch";
import { userId } from "../userId";
import { load } from '@tauri-apps/plugin-store';

// 新しいメッセージ型定義に基づくレスポンス型
export interface MessageResponse {
  verified: boolean;
  encrypted: boolean;
  value: {
    type: "text" | "image" | "video" | "audio" | "file" | "thumbnail";
    content: string; // 各タイプに応じた内容
    reply?: {
      id: string;
    };
    mention: string[];
  };
  channel: string;
  original?: string;
  timestamp: number;
  isLarge: boolean;
}

export async function getMessage({
  messageid,
  type,
  roomId,
  senderId,
  isProgress,
  onProgress,
}: {
  messageid: string;
  type: string;
  roomId: string;
  senderId: string;
  isProgress?: boolean;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<MessageResponse> {
  const [deviceKey] = useAtom(deviceKeyState);
  const deviceKeyVal = deviceKey();
  if (!deviceKeyVal) throw new Error("DeviceKey not found");
  if (!isProgress && onProgress) {
    throw new Error("onProgress is only available when isProgress is true");
  }
  // TakosFetch APIの代わりにXMLHttpRequestを使用して進捗を追跡
  let encryptedMessage;

  if(window.isApp) {
    const store = await load('messages.json', { autoSave: false });
    const message = await store.get(messageid);
    if (message) {
      return message as MessageResponse;
    }
  }

  if (isProgress) {
    encryptedMessage = await new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        "GET",
        `https://${messageid.split("@")[1]}/_takos/v1/message/${messageid}`,
      );

      // ヘッダー取得用のフラグ
      let headersTakosFetched = false;

      // readystatechangeイベントでヘッダーを取得
      xhr.onreadystatechange = () => {
        // readyStateが2（HEADERS_RECEIVED）以上になったらヘッダー取得可能
        if (xhr.readyState >= 2 && !headersTakosFetched) {
          headersTakosFetched = true;
          const contentLength = xhr.getResponseHeader("Content-Length");
          console.log("Content-Length:", contentLength);
          // ここで必要に応じて取得したヘッダー情報を保存/処理できます
        }
      };

      // 進捗イベントの設定
      xhr.onprogress = (event) => {
        if (onProgress) {
          if (event.lengthComputable) {
            console.log("進捗:", event.loaded, "/", event.total);
          } else if (xhr.getResponseHeader("Content-Length")) {
            // event.totalが利用できない場合、Content-Lengthから取得
            const total = parseInt(
              xhr.getResponseHeader("Content-Length") || "0",
              10,
            );
            onProgress(event.loaded, total);
          }
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (error) {
            reject(new Error("Failed to parse response"));
          }
        } else {
          reject(new Error("Unauthorized"));
        }
      };

      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send();
    });
  } else {
    const res = await TakosFetch(
      `https://${messageid.split("@")[1]}/_takos/v1/message/${messageid}`,
      { cache: "force-cache" },
    );
    if (!res || res.status !== 200) {
      throw new Error("Unauthorized");
    }
    encryptedMessage = await res.json();
  }
  const parsedMessage = JSON.parse(encryptedMessage.message);
  if (!parsedMessage.encrypted) {
    if(window.isApp) {
      const store = await load('messages.json', { autoSave: false });
      await store.set(messageid, {
        verified: false,
        encrypted: false,
        value: parsedMessage.value,
        channel: parsedMessage.channel,
        original: parsedMessage.original,
        timestamp: encryptedMessage.timestamp,
        isLarge: parsedMessage.isLarge,
      });
      await store.save();
    }
    // 復号化されていないメッセージはそのまま返す
    // 署名検証が実装されていない場合はfalse
    return {
      verified: false,
      encrypted: false,
      value: parsedMessage.value,
      channel: parsedMessage.channel,
      original: parsedMessage.original,
      timestamp: encryptedMessage.timestamp,
      isLarge: parsedMessage.isLarge,
    };
  }

  // 暗号化メッセージの処理
  const messageValue = JSON.parse(parsedMessage.value);
  const roomKeyHash = messageValue.keyHash;

  // セッションストレージからroomKeyを取得、なければ取得して復号
  let roomKey = sessionStorage.getItem("roomKey-" + roomKeyHash);
  if (!roomKey) {
    let encryptedRoomKeyRes;
    if (type === "group") {
      encryptedRoomKeyRes = await TakosFetch(
        `https://${
          messageid.split("@")[1]
        }/_takos/v1/key/roomKey?roomId=${roomId}&targetUserId=${userId}&hash=${
          encodeURIComponent(roomKeyHash)
        }&userId=${senderId}`,
      );
    } else if (type === "friend") {
      encryptedRoomKeyRes = await TakosFetch(
        `https://${
          messageid.split("@")[1]
        }/_takos/v1/key/roomKey?targetUserId=${userId}&hash=${
          encodeURIComponent(roomKeyHash)
        }&userId=${senderId}`,
      );
    }

    if (!encryptedRoomKeyRes || encryptedRoomKeyRes.status !== 200) {
      throw new Error("Unauthorized");
    }
    const encryptedRoomKey = (await encryptedRoomKeyRes.json()).roomKey;
    const accountKeyHash = JSON.parse(encryptedRoomKey).keyHash;
    const accountKey = await getAccountKey({
      key: accountKeyHash,
    });
    if (!accountKey) {
      throw new Error("AccountKey not found");
    }
    const decryptedAccountKey = await decryptAccountKey({
      deviceKey: deviceKeyVal,
      encryptedAccountKey: accountKey.encryptedKey,
    });
    if (!decryptedAccountKey) {
      throw new Error("Failed to decrypt accountKey");
    }

    const roomKeyResult = await decryptDataAccountKey(
      decryptedAccountKey.privateKey,
      encryptedRoomKey,
    );

    if (!roomKeyResult) {
      throw new Error("Failed to decrypt roomKey");
    }

    roomKey = roomKeyResult;
    sessionStorage.setItem("roomKey-" + roomKeyHash, roomKey);
  }
  // roomKeyを使ってメッセージを復号
  const decryptedMessage = await decryptDataRoomKey(
    roomKey,
    parsedMessage.value,
  );
  if (!decryptedMessage) {
    throw new Error("Failed to decrypt message");
  }
  // 復号したメッセージをパース
  const decryptedContent = JSON.parse(decryptedMessage);

  if(window.isApp) {
    const store = await load('messages.json', { autoSave: false });
    await store.set(messageid, {
      verified: false,
      encrypted: true,
      value: {
        type: decryptedContent.type,
        content: decryptedContent.content,
        reply: decryptedContent.reply,
        mention: decryptedContent.mention || [],
      },
      channel: parsedMessage.channel,
      original: parsedMessage.original,
      timestamp: encryptedMessage.timestamp,
      isLarge: parsedMessage.isLarge,
    });
    await store.save();
  }

  return {
    verified: false, // 署名検証が実装されていない場合はfalse
    encrypted: true,
    value: {
      type: decryptedContent.type,
      content: decryptedContent.content, // コンテンツはJSONの場合があるためパース
      reply: decryptedContent.reply,
      mention: decryptedContent.mention || [],
    },
    channel: parsedMessage.channel,
    original: parsedMessage.original,
    timestamp: encryptedMessage.timestamp,
    isLarge: parsedMessage.isLarge,
  };
}

export function createTextContent({
  text,
  format,
}: {
  text: string;
  format: "text" | "markdown";
}) {
  return JSON.stringify({
    text,
    format,
  });
}

export function createMediaContent({
  uri,
  metadata,
}: {
  uri: string;
  metadata: {
    filename: string;
    mimeType: string;
  };
}) {
  return JSON.stringify({
    uri,
    metadata,
  });
}

export function createThumbnailContent({
  originalType,
  thumbnailText,
  thumbnailUri,
  thumbnailMimeType,
}: {
  originalType: "text" | "image" | "video" | "audio" | "file";
  thumbnailText?: string;
  thumbnailUri?: string;
  thumbnailMimeType?: string;
}) {
  if (originalType === "text") {
    return JSON.stringify({
      originalType,
      thumbnailText,
    });
  } else if (originalType === "image" || originalType === "video") {
    return JSON.stringify({
      originalType,
      thumbnailUri,
      thumbnailMimeType,
    });
  } else {
    return JSON.stringify({
      originalType,
      thumbnailText,
    });
  }
}
