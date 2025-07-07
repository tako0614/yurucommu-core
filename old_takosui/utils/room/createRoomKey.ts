import {
  decryptDataDeviceKey,
  encryptDataDeviceKey,
  encryptMessage,
  encryptRoomKeyWithAccountKeys,
  generateRoomkey,
  keyHash,
  verifyMasterKey,
} from "@takos/takos-encrypt-ink";
import { TakosFetch } from "../TakosFetch";
import {
  getAllAccountKeys,
  getAllAllowKeys,
  saveAllowKey,
  saveRoomKey,
} from "../storage/idb";

export async function createRoomKey(
  roomId: string,
  friendIds: string[],
  userId: string,
  identityKey: string,
  idenPubkeyHash: string,
  deviceKey: string,
  roomType: "friend" | "group",
): Promise<string | undefined> {
  try {
    // セッションUUIDの確認
    const uuid = localStorage.getItem("sessionUUID");
    if (!uuid) {
      console.error("セッションUUIDが見つかりません");
      return undefined;
    }

    // ルームキーの生成
    const roomKey = await generateRoomkey(uuid);
    if (!roomKey) {
      console.error("ルームキーの生成に失敗しました");
      return undefined;
    }
    // 自分のIDを友達リストから除外
    const targetFriendIds = friendIds.filter((id) => id !== userId);

    // 友達のキー情報を収集
    const friendKeys = await collectFriendKeys(targetFriendIds);

    // 自分のキー情報を取得
    const myKeyInfo = await getMyKeyInfo(userId, deviceKey);
    if (!myKeyInfo) {
      console.error("自分のキー情報の取得に失敗しました");
      return undefined;
    }

    // 全てのキー情報を結合
    const allKeys = [...friendKeys, myKeyInfo];

    // ルームキーの暗号化
    const encrypted = await encryptRoomKeyWithAccountKeys(
      allKeys,
      roomKey,
      identityKey,
      idenPubkeyHash,
    );
    if (!encrypted) {
      console.error("ルームキーの暗号化に失敗しました");
      return undefined;
    }

    // ルームキーの送信
    const success = await sendRoomKey(roomId, encrypted, roomKey, roomType);
    if (!success) {
      console.error("ルームキーの送信に失敗しました");
      return undefined;
    }

    // ルームキーをデバイスキーで暗号化して保存
    await storeRoomKey(roomId, roomKey, deviceKey, encrypted.metadata);
    return roomKey;
  } catch (error) {
    console.error("ルームキー作成中にエラーが発生しました:", error);
    return undefined;
  }
}

/**
 * 友達のキー情報を収集する
 */
async function collectFriendKeys(
  friendIds: string[],
): Promise<
  Array<{
    masterKey: string;
    accountKey: string;
    accountKeySign: string;
    userId: string;
    isVerify: boolean;
  }>
> {
  console.log(friendIds);
  const allowKeysData = await getAllAllowKeys();
  const friendKeys = [];

  for (const friendId of friendIds) {
    try {
      const domain = friendId.split("@")[1];
      if (!domain) {
        console.error(`不正なユーザーID: ${friendId}`);
        continue;
      }

      // 友達のマスターキーとアカウントキーを取得
      const [friendMasterKeyRes, friendAccountKeyRes] = await Promise.all([
        TakosFetch(
          `https://${domain}/_takos/v1/key/masterKey?userId=${friendId}`,
        ),
        TakosFetch(
          `https://${domain}/_takos/v1/key/accountKey?userId=${friendId}`,
        ),
      ]);

      if (
        friendMasterKeyRes.status !== 200 || friendAccountKeyRes.status !== 200
      ) {
        console.error(`${friendId}のキー情報取得に失敗しました`);
        continue;
      }

      const friendMasterKey = (await friendMasterKeyRes.json()).key;
      const { key: friendAccountKey, signature: friendAccountKeySign } =
        await friendAccountKeyRes.json();

      // 許可されたキーの更新
      const allowKey = allowKeysData.find((
        k: { userId: string; latest: any },
      ) => k.userId === friendId && k.latest);
      if (allowKey && allowKey.key !== await keyHash(friendMasterKey)) {
        await saveAllowKey({
          key: allowKey.key,
          userId: allowKey.userId,
          timestamp: allowKey.timestamp,
          latest: false,
        });
      }
      // マスターキーの検証
      if (
        !verifyMasterKey(
          friendMasterKey,
          friendAccountKeySign,
          friendAccountKey,
        )
      ) {
        console.error(`${friendId}のアカウントキーが不正です`);
        continue;
      }

      friendKeys.push({
        masterKey: friendMasterKey,
        accountKey: friendAccountKey,
        accountKeySign: friendAccountKeySign,
        userId: friendId,
        isVerify: true,
      });
    } catch (error) {
      console.error(
        `${friendId}のキー情報処理中にエラーが発生しました:`,
        error,
      );
    }
  }

  return friendKeys;
}

/**
 * 自分のキー情報を取得する
 */
async function getMyKeyInfo(
  userId: string,
  deviceKey: string,
): Promise<
  {
    masterKey: string;
    accountKey: string;
    accountKeySign: string;
    userId: string;
    isVerify: boolean;
  } | undefined
> {
  // マスターキーを取得
  const masterKey = localStorage.getItem("masterKey");
  if (!masterKey) {
    console.error("マスターキーが見つかりません");
    return undefined;
  }

  // デバイスキーでマスターキーを復号化
  const decryptMasterKey = await decryptDataDeviceKey(deviceKey, masterKey);
  if (!decryptMasterKey) {
    console.error("マスターキーの復号化に失敗しました");
    return undefined;
  }

  // 最新のアカウントキーを取得
  const accountKeys = await getAllAccountKeys();
  const encryptedAccountKey =
    accountKeys.sort((a: { timestamp: number }, b: { timestamp: number }) =>
      b.timestamp - a.timestamp
    )[0];
  if (!encryptedAccountKey) {
    console.error("アカウントキーが見つかりません");
    return undefined;
  }

  // アカウントキーの署名を取得
  const accountKeyRes = await TakosFetch(
    `/_takos/v1/key/accountKey?userId=${userId}`,
  );
  if (accountKeyRes.status !== 200) {
    console.error("アカウントキーの署名取得に失敗しました");
    return undefined;
  }

  const accountKeyData = await accountKeyRes.json();
  // キーハッシュの検証
  if (await keyHash(accountKeyData.key) !== encryptedAccountKey.key) {
    console.error("アカウントキーのハッシュが一致しません");
    return undefined;
  }

  // マスターキーの検証
  const parsedMasterKey = JSON.parse(decryptMasterKey);
  if (
    !verifyMasterKey(
      parsedMasterKey.publicKey,
      accountKeyData.signature,
      accountKeyData.key,
    )
  ) {
    console.error("アカウントキーの検証に失敗しました");
    return undefined;
  }

  return {
    masterKey: parsedMasterKey.publicKey,
    accountKey: accountKeyData.key,
    accountKeySign: accountKeyData.signature,
    userId: userId,
    isVerify: true,
  };
}

async function sendRoomKey(
  roomId: string,
  encrypted: {
    encryptedData: Array<{ userId: string; encryptedData: any }>;
    metadata: any;
    sign: string;
  },
  roomKey: string,
  roomType: "friend" | "group",
): Promise<boolean> {
  const res = await TakosFetch("/api/v2/keys/roomKey", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      roomId: roomId,
      encryptedRoomKeys: encrypted.encryptedData.map(
        (data) => [data.userId, data.encryptedData],
      ),
      hash: await keyHash(roomKey),
      metaData: encrypted.metadata,
      sign: encrypted.sign,
      type: roomType,
    }),
  });

  return res.status === 200;
}

async function storeRoomKey(
  roomId: string,
  roomKey: string,
  deviceKey: string,
  metadata: any,
): Promise<void> {
  const encryptedRoomKey = await encryptDataDeviceKey(deviceKey, roomKey);
  if (!encryptedRoomKey) {
    throw new Error("ルームキーの暗号化に失敗しました");
  }
  await saveRoomKey({
    key: await keyHash(roomKey),
    encryptedKey: encryptedRoomKey,
    timestamp: new Date().getTime(),
    roomid: roomId,
    metaData: metadata,
  });
}
