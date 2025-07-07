import {
  decryptDataDeviceKey,
  encryptDataDeviceKey,
  isValidAccountKeyPublic,
  keyHash,
} from "@takos/takos-encrypt-ink";
import { load, Store } from "@tauri-apps/plugin-store";
import { DBSchema, IDBPDatabase, openDB } from "idb";

// ストレージインターフェース定義
type StoreNames =
  | "shareKeys"
  | "identityKeys"
  | "accountKeys"
  | "RoomKeys"
  | "allowKeys"
  | "shareSignKeys"
  | "excludeUsers"
  | "encrypteSetting"
  | "notification";

interface StorageInterface {
  get<T extends StoreNames>(
    storeName: T,
    key: string,
  ): Promise<TakosDB[T]["value"] | undefined>;
  put<T extends StoreNames>(
    storeName: T,
    value: TakosDB[T]["value"],
  ): Promise<void>;
  getAll<T extends StoreNames>(storeName: T): Promise<TakosDB[T]["value"][]>;
  delete<T extends StoreNames>(storeName: T, key: string): Promise<void>;
  clear<T extends StoreNames>(storeName: T): Promise<void>;
}

// IndexedDB実装
class IndexedDBStorage implements StorageInterface {
  private db: Promise<IDBPDatabase<TakosDB>>;

  constructor() {
    this.db = createTakosDB();
  }

  async get<T extends StoreNames>(
    storeName: T,
    key: string,
  ): Promise<TakosDB[T]["value"] | undefined> {
    const db = await this.db;
    return db.get(storeName, key);
  }

  async put<T extends StoreNames>(
    storeName: T,
    value: TakosDB[T]["value"],
  ): Promise<void> {
    const db = await this.db;
    await db.put(storeName, value);
  }

  async getAll<T extends StoreNames>(
    storeName: T,
  ): Promise<TakosDB[T]["value"][]> {
    const db = await this.db;
    return db.getAll(storeName);
  }

  async delete<T extends StoreNames>(storeName: T, key: string): Promise<void> {
    const db = await this.db;
    await db.delete(storeName, key);
  }

  async clear<T extends StoreNames>(storeName: T): Promise<void> {
    const db = await this.db;
    await db.clear(storeName);
  }
}

// Tauriストア実装
class TauriStorage implements StorageInterface {
  private stores: Map<string, Store> = new Map();

  async getStore(storeName: StoreNames): Promise<Store> {
    if (!this.stores.has(storeName)) {
      const store = await load(storeName);
      this.stores.set(storeName, store);
    }
    return this.stores.get(storeName)!;
  }

  async get<T extends StoreNames>(
    storeName: T,
    key: string,
  ): Promise<TakosDB[T]["value"] | undefined> {
    const store = await this.getStore(storeName);
    return await store.get(key);
  }

  async put<T extends StoreNames>(
    storeName: T,
    value: TakosDB[T]["value"],
  ): Promise<void> {
    const store = await this.getStore(storeName);
    await store.set(value.key, value);
    await store.save();
  }

  async getAll<T extends StoreNames>(
    storeName: T,
  ): Promise<TakosDB[T]["value"][]> {
    const store = await this.getStore(storeName);
    const entries = await store.entries();
    const result: TakosDB[T]["value"][] = [];
    for (const [k, v] of entries) {
      result.push(v as TakosDB[T]["value"]);
    }
    return result;
  }

  async delete<T extends StoreNames>(storeName: T, key: string): Promise<void> {
    const store = await this.getStore(storeName);
    await store.delete(key);
    await store.save();
  }

  async clear<T extends StoreNames>(storeName: T): Promise<void> {
    const store = await this.getStore(storeName);
    store.clear();
    await store.save();
  }
}

// ストレージファクトリ
const storageInstance: StorageInterface = (window as any).isApp
  ? new TauriStorage()
  : new IndexedDBStorage();

export interface TakosDB extends DBSchema {
  shareKeys: {
    key: string;
    value: {
      key: string; //hash
      encryptedKey: string;
      timestamp: number;
    };
  };
  identityKeys: {
    key: string;
    value: {
      key: string; //hash
      encryptedKey: string;
      timestamp: number;
    };
  };
  accountKeys: {
    key: string;
    value: {
      key: string; //hash
      encryptedKey: string;
      timestamp: number;
    };
  };
  RoomKeys: {
    key: string;
    value: {
      key: string; //hash
      encryptedKey: string;
      timestamp: number;
      roomid: string;
      metaData: string;
    };
  };
  allowKeys: {
    key: string;
    value: {
      key: string; //hash
      userId: string;
      timestamp: number;
      latest: boolean;
    };
  };
  shareSignKeys: {
    key: string;
    value: {
      key: string; //hash
      encryptedKey: string;
      timestamp: number;
    };
  };
  //暗号化除外するユーザーのオブジェクト
  excludeUsers: {
    key: string;
    value: {
      key: string; //userId-roomId
      userId: string;
      roomId: string;
      timestamp: number;
    };
  };
  encrypteSetting: {
    key: string;
    value: {
      key: string; //roomid
      isEncrypte: boolean;
      timestamp: number;
    };
  };
  notification: {
    key: string;
    value: {
      key: string; //roomid
      isNotification: boolean;
    };
  };
}

export async function saveNotificationSetting({
  roomId,
  isNotification,
}: {
  roomId: string;
  isNotification: boolean;
}) {
  await storageInstance.put("notification", {
    key: roomId,
    isNotification,
  });
}

export async function getNotificationSetting({
  roomId,
}: {
  roomId: string;
}): Promise<boolean> {
  console.log(roomId);
  const setting = await storageInstance.get("notification", roomId);
  if (setting === null || setting === undefined) {
    return true;
  }
  return setting.isNotification === false ? false : true;
}

export async function saveEncryptSetting({
  roomId,
  isEncrypte,
}: {
  roomId: string;
  isEncrypte: boolean;
}) {
  await storageInstance.put("encrypteSetting", {
    key: roomId,
    isEncrypte,
    timestamp: Date.now(),
  });
}

export async function getEncryptSetting(
  { roomId }: { roomId: string },
): Promise<boolean> {
  if (!roomId) {
    throw new Error("roomId is required");
  }
  const setting = await storageInstance.get("encrypteSetting", roomId);

  if (setting === null || setting === undefined) {
    return true; // 設定がない場合はデフォルトでtrue
  }

  // 明示的に値をチェック
  return setting.isEncrypte === false ? false : true;
}

export async function saveExcludeUsers({
  userId,
  roomId,
}: {
  userId: string;
  roomId: string;
}) {
  await storageInstance.put("excludeUsers", {
    key: `${userId}-${roomId}`,
    userId,
    roomId,
    timestamp: Date.now(),
  });
}

export async function getExcludeUsers({
  userId,
  roomId,
}: {
  userId: string;
  roomId: string;
}) {
  return storageInstance.get("excludeUsers", `${userId}-${roomId}`);
}

// 新しい関数: 特定のルームの除外ユーザーリストをすべて取得
export async function getExcludeUsersList({
  roomId,
}: {
  roomId: string;
}): Promise<string[]> {
  if (!roomId) {
    return [];
  }

  const allItems = await storageInstance.getAll("excludeUsers");

  // このルームIDに一致する除外ユーザーを抽出
  const roomExcludedUsers = allItems
    .filter((item) => item.roomId === roomId)
    .map((item) => item.userId);

  return roomExcludedUsers;
}

// 除外ユーザーリストを削除する関数
export async function removeExcludeUser({
  userId,
  roomId,
}: {
  userId: string;
  roomId: string;
}) {
  await storageInstance.delete("excludeUsers", `${userId}-${roomId}`);
}

export function createTakosDB(): Promise<IDBPDatabase<TakosDB>> {
  return openDB<TakosDB>("takos-db", 19, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("shareKeys")) {
        db.createObjectStore("shareKeys", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("identityKeys")) {
        db.createObjectStore("identityKeys", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("accountKeys")) {
        db.createObjectStore("accountKeys", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("RoomKeys")) {
        db.createObjectStore("RoomKeys", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("allowKeys")) {
        db.createObjectStore("allowKeys", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("shareSignKeys")) {
        db.createObjectStore("shareSignKeys", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("excludeUsers")) {
        db.createObjectStore("excludeUsers", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("encrypteSetting")) {
        db.createObjectStore("encrypteSetting", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("notification")) {
        db.createObjectStore("notification", { keyPath: "key" });
      }
      // 許可されたobjectStoreのみ残し、その他を削除
      const allowedStores = [
        "shareKeys",
        "identityKeys",
        "accountKeys",
        "RoomKeys",
        "allowKeys",
        "shareSignKeys",
        "excludeUsers",
        "encrypteSetting",
        "notification",
      ];
      for (const storeName of Array.from(db.objectStoreNames)) {
        if (!allowedStores.includes(storeName)) {
          db.deleteObjectStore(storeName);
        }
      }
    },
  });
}

export interface AccountKey {
  privateKey: string;
  publicKey: string;
  sign: string;
}

export interface IdentityKey {
  privateKey: string;
  publicKey: string;
  sign: string;
}

export interface ShareSignKey {
  privateKey: string;
  publicKey: string;
  sign: string;
}

export async function encryptAccountKey({
  deviceKey,
  accountKey,
}: {
  deviceKey: string;
  accountKey: AccountKey;
}): Promise<string> {
  const rawString = JSON.stringify(accountKey);
  const encryptedAccountKey = await encryptDataDeviceKey(
    deviceKey,
    rawString,
  );
  if (!encryptedAccountKey) {
    throw new Error("encryptedAccountKey is not generated");
  }
  return encryptedAccountKey;
}

export async function decryptAccountKey({
  deviceKey,
  encryptedAccountKey,
}: {
  deviceKey: string;
  encryptedAccountKey: string;
}): Promise<AccountKey> {
  const decryptedAccountKey = await decryptDataDeviceKey(
    deviceKey,
    encryptedAccountKey,
  );
  if (!decryptedAccountKey) {
    throw new Error("decryptedAccountKey is not generated");
  }
  return JSON.parse(decryptedAccountKey) as AccountKey;
}

export async function encryptIdentityKey({
  deviceKey,
  identityKey,
}: {
  deviceKey: string;
  identityKey: IdentityKey;
}): Promise<string> {
  const rawString = JSON.stringify(identityKey);
  const encryptedIdentityKey = await encryptDataDeviceKey(
    deviceKey,
    rawString,
  );
  if (!encryptedIdentityKey) {
    throw new Error("encryptedIdentityKey is not generated");
  }
  return encryptedIdentityKey;
}

export async function decryptIdentityKey({
  deviceKey,
  encryptedIdentityKey,
}: {
  deviceKey: string;
  encryptedIdentityKey: string;
}): Promise<IdentityKey> {
  const decryptedIdentityKey = await decryptDataDeviceKey(
    deviceKey,
    encryptedIdentityKey,
  );
  if (!decryptedIdentityKey) {
    throw new Error("decryptedIdentityKey is not generated");
  }
  return JSON.parse(decryptedIdentityKey) as IdentityKey;
}

export async function encryptShareSignKey({
  deviceKey,
  shareSignKey,
}: {
  deviceKey: string;
  shareSignKey: ShareSignKey;
}): Promise<string> {
  const rawString = JSON.stringify(shareSignKey);
  const encryptedShareSignKey = await encryptDataDeviceKey(
    deviceKey,
    rawString,
  );
  if (!encryptedShareSignKey) {
    throw new Error("encryptedShareSignKey is not generated");
  }
  return encryptedShareSignKey;
}

export async function decryptShareSignKey({
  deviceKey,
  encryptedShareSignKey,
}: {
  deviceKey: string;
  encryptedShareSignKey: string;
}): Promise<ShareSignKey> {
  const decryptedShareSignKey = await decryptDataDeviceKey(
    deviceKey,
    encryptedShareSignKey,
  );
  if (!decryptedShareSignKey) {
    throw new Error("decryptedShareSignKey is not generated");
  }
  return JSON.parse(decryptedShareSignKey) as ShareSignKey;
}

export async function saveShareKey({
  key,
  encryptedKey,
  timestamp,
}: {
  key: string;
  encryptedKey: string;
  timestamp: number;
}) {
  await storageInstance.put("shareKeys", {
    key: key,
    encryptedKey,
    timestamp,
  });
}

export async function getShareKey({ key }: { key: string }) {
  return storageInstance.get("shareKeys", key);
}

export async function getAccountKey({ key }: { key: string }) {
  return storageInstance.get("accountKeys", key);
}

export async function saveAccountKey({
  key,
  encryptedKey,
  timestamp,
}: {
  key: string;
  encryptedKey: string;
  timestamp: number;
}) {
  await storageInstance.put("accountKeys", {
    key: key,
    encryptedKey,
    timestamp,
  });
}

export async function getIdentityKey({ key }: { key: string }) {
  return storageInstance.get("identityKeys", key);
}

export async function saveIdentityKey({
  key,
  encryptedKey,
  timestamp,
}: {
  key: string;
  encryptedKey: string;
  timestamp: number;
}) {
  await storageInstance.put("identityKeys", {
    key: key,
    encryptedKey,
    timestamp,
  });
}

export async function getAllIdentityKeys() {
  return storageInstance.getAll("identityKeys");
}

export async function getAllAccountKeys() {
  return storageInstance.getAll("accountKeys");
}

export async function getShareSignKey({ key }: { key: string }) {
  return storageInstance.get("shareSignKeys", key);
}

export async function saveShareSignKey({
  key,
  encryptedKey,
  timestamp,
}: {
  key: string;
  encryptedKey: string;
  timestamp: number;
}) {
  await storageInstance.put("shareSignKeys", {
    key: key,
    encryptedKey,
    timestamp,
  });
}

export async function getAllShareSignKeys() {
  return storageInstance.getAll("shareSignKeys");
}

export async function getAllowKey({ key }: { key: string }) {
  return storageInstance.get("allowKeys", key);
}

export async function saveAllowKey({
  key,
  userId,
  timestamp,
  latest,
}: {
  key: string;
  userId: string;
  timestamp: number;
  latest: boolean;
}) {
  await storageInstance.put("allowKeys", {
    key: key,
    userId,
    timestamp,
    latest,
  });
}

export async function getAllAllowKeys() {
  return storageInstance.getAll("allowKeys");
}

export async function getRoomKey({ key }: { key: string }) {
  return storageInstance.get("RoomKeys", key);
}

export async function saveRoomKey({
  key,
  encryptedKey,
  timestamp,
  roomid,
  metaData,
}: {
  key: string;
  encryptedKey: string;
  timestamp: number;
  roomid: string;
  metaData: string;
}) {
  await storageInstance.put("RoomKeys", {
    key: key,
    encryptedKey,
    timestamp,
    roomid,
    metaData,
  });
}

export async function getAllRoomKeys() {
  return storageInstance.getAll("RoomKeys");
}

export async function clearDB() {
  await storageInstance.clear("allowKeys");
  await storageInstance.clear("identityKeys");
  await storageInstance.clear("accountKeys");
  await storageInstance.clear("shareKeys");
  await storageInstance.clear("RoomKeys");
  await storageInstance.clear("shareSignKeys");
  await storageInstance.clear("excludeUsers");
  await storageInstance.clear("encrypteSetting");
  await storageInstance.clear("notification");
}
