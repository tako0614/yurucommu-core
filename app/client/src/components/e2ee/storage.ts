import type {
  GeneratedKeyPair,
  RosterEvidence,
  StoredGroupState,
} from "./mls_wrapper.ts";
import { load as loadStore, type Store } from "@tauri-apps/plugin-store";
import { isTauri } from "../../utils/config.ts";
import type { ChatMessage } from "../chat/types.ts";

// 新実装に伴い保存形式を変更
const DB_VERSION = 10;
const STORE_NAME = "mlsGroups";
const KEY_STORE = "mlsKeyPairs";
const CACHE_STORE = "cache";
const EVIDENCE_STORE = "evidence";
const KP_RECORD_STORE = "kpRecords";

const stores: Record<string, Store> = {};

async function openStore(accountId: string): Promise<Store> {
  if (stores[accountId]) return stores[accountId];
  const store = await loadStore(`takos_${accountId}.json`);
  const version = await store.get<number>("version");
  if (version !== DB_VERSION) {
    await store.clear();
    await store.set("version", DB_VERSION);
    await store.save();
  }
  stores[accountId] = store;
  return store;
}

function openDB(accountId: string): Promise<IDBDatabase> {
  const name = `takos_${accountId}`;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = (ev as IDBVersionChangeEvent).oldVersion ?? 0;
      if (oldVersion < DB_VERSION) {
        if (db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }
        if (db.objectStoreNames.contains(KEY_STORE)) {
          db.deleteObjectStore(KEY_STORE);
        }
        if (db.objectStoreNames.contains(EVIDENCE_STORE)) {
          db.deleteObjectStore(EVIDENCE_STORE);
        }
        if (db.objectStoreNames.contains(KP_RECORD_STORE)) {
          db.deleteObjectStore(KP_RECORD_STORE);
        }
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE);
      }
      if (!db.objectStoreNames.contains(EVIDENCE_STORE)) {
        db.createObjectStore(EVIDENCE_STORE);
      }
      if (!db.objectStoreNames.contains(KP_RECORD_STORE)) {
        db.createObjectStore(KP_RECORD_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const loadMLSGroupStates = async (
  accountId: string,
): Promise<Record<string, StoredGroupState>> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    return await store.get<Record<string, StoredGroupState>>("groups") ?? {};
  }
  const db = await openDB(accountId);
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  return await new Promise((resolve, reject) => {
    const req = store.openCursor();
    const result: Record<string, StoredGroupState> = {};
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        result[cursor.key as string] = cursor.value as StoredGroupState;
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    req.onerror = () => reject(req.error);
  });
};

export const saveMLSGroupStates = async (
  accountId: string,
  states: Record<string, StoredGroupState>,
): Promise<void> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    await store.set("groups", states);
    await store.save();
    return;
  }
  // ブラウザ環境では ts-mls の ClientState に関数など非クローン要素が含まれ
  // IndexedDB の structured clone で DataCloneError になるため、保存はスキップする。
  // 将来的にシリアライズAPIが追加されたらここで永続化に切り替える。
  return;
};

export const loadMLSKeyPair = async (
  accountId: string,
): Promise<GeneratedKeyPair | null> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    return await store.get<GeneratedKeyPair>("keyPair") ?? null;
  }
  const db = await openDB(accountId);
  const tx = db.transaction(KEY_STORE, "readonly");
  const store = tx.objectStore(KEY_STORE);
  return await new Promise((resolve, reject) => {
    const req = store.openCursor(null, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      resolve(cursor ? (cursor.value as GeneratedKeyPair) : null);
    };
    req.onerror = () => reject(req.error);
  });
};

export const saveMLSKeyPair = async (
  accountId: string,
  pair: GeneratedKeyPair,
): Promise<void> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    await store.set("keyPair", pair);
    await store.save();
    return;
  }
  const db = await openDB(accountId);
  const tx = db.transaction(KEY_STORE, "readwrite");
  const store = tx.objectStore(KEY_STORE);
  store.add(pair);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
};

export const loadRosterEvidence = async (
  accountId: string,
  roomId: string,
): Promise<RosterEvidence[]> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    const ev = await store.get<Record<string, RosterEvidence[]>>(
      "evidence",
    ) ?? {};
    return ev[roomId] ?? [];
  }
  const db = await openDB(accountId);
  const tx = db.transaction(EVIDENCE_STORE, "readonly");
  const store = tx.objectStore(EVIDENCE_STORE);
  return await new Promise((resolve, reject) => {
    const req = store.get(roomId);
    req.onsuccess = () => {
      resolve((req.result as RosterEvidence[]) ?? []);
    };
    req.onerror = () => reject(req.error);
  });
};

export const appendRosterEvidence = async (
  accountId: string,
  roomId: string,
  evidence: RosterEvidence[],
): Promise<void> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    const ev = await store.get<Record<string, RosterEvidence[]>>(
      "evidence",
    ) ?? {};
    const current = ev[roomId] ?? [];
    ev[roomId] = current.concat(evidence);
    await store.set("evidence", ev);
    await store.save();
    return;
  }
  const db = await openDB(accountId);
  const tx = db.transaction(EVIDENCE_STORE, "readwrite");
  const store = tx.objectStore(EVIDENCE_STORE);
  const current: RosterEvidence[] = await new Promise((resolve, reject) => {
    const req = store.get(roomId);
    req.onsuccess = () => resolve((req.result as RosterEvidence[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  store.put(current.concat(evidence), roomId);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
};

// すべての鍵ペアを取得（プール運用向け）
export const loadAllMLSKeyPairs = async (
  accountId: string,
): Promise<GeneratedKeyPair[]> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    // tauri-store では一覧を保持していないため直近のみ
    const last = await store.get<GeneratedKeyPair>("keyPair");
    return last ? [last] : [];
  }
  const db = await openDB(accountId);
  const tx = db.transaction(KEY_STORE, "readonly");
  const store = tx.objectStore(KEY_STORE);
  return await new Promise((resolve, reject) => {
    const req = store.openCursor();
    const out: GeneratedKeyPair[] = [];
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        out.push(cur.value as GeneratedKeyPair);
        cur.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
};

// 汎用キャッシュ（IndexedDB の CACHE_STORE を利用）
export const getCacheItem = async (
  accountId: string,
  key: string,
): Promise<unknown | null> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    const all = await store.get<Record<string, unknown>>("cache");
    return (all ?? {})[key] ?? null;
  }
  const db = await openDB(accountId);
  const tx = db.transaction(CACHE_STORE, "readonly");
  const store = tx.objectStore(CACHE_STORE);
  return await new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
};

export const setCacheItem = async (
  accountId: string,
  key: string,
  value: unknown,
): Promise<void> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    const all = await store.get<Record<string, unknown>>("cache") ?? {};
    all[key] = value;
    await store.set("cache", all);
    await store.save();
    return;
  }
  const db = await openDB(accountId);
  const tx = db.transaction(CACHE_STORE, "readwrite");
  const store = tx.objectStore(CACHE_STORE);
  store.put(value, key);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
};

// KeyPackage 検証記録
export interface KeyPackageRecord {
  kpUrl: string;
  actorId: string;
  leafIndex: number;
  credentialFingerprint: string;
  time: string;
  ktIncluded?: boolean;
}

export const loadKeyPackageRecords = async (
  accountId: string,
  roomId: string,
): Promise<KeyPackageRecord[]> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    const rec = await store.get<Record<string, KeyPackageRecord[]>>(
      "kpRecords",
    ) ?? {};
    return rec[roomId] ?? [];
  }
  const db = await openDB(accountId);
  const tx = db.transaction(KP_RECORD_STORE, "readonly");
  const store = tx.objectStore(KP_RECORD_STORE);
  return await new Promise((resolve, reject) => {
    const req = store.get(roomId);
    req.onsuccess = () => {
      resolve((req.result as KeyPackageRecord[]) ?? []);
    };
    req.onerror = () => reject(req.error);
  });
};

export const appendKeyPackageRecords = async (
  accountId: string,
  roomId: string,
  records: KeyPackageRecord[],
): Promise<void> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    const rec = await store.get<Record<string, KeyPackageRecord[]>>(
      "kpRecords",
    ) ?? {};
    const current = rec[roomId] ?? [];
    rec[roomId] = current.concat(records);
    await store.set("kpRecords", rec);
    await store.save();
    return;
  }
  const db = await openDB(accountId);
  const tx = db.transaction(KP_RECORD_STORE, "readwrite");
  const store = tx.objectStore(KP_RECORD_STORE);
  const current: KeyPackageRecord[] = await new Promise((resolve, reject) => {
    const req = store.get(roomId);
    req.onsuccess = () => resolve((req.result as KeyPackageRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  store.put(current.concat(records), roomId);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
};

// キャッシュの読み書き
export interface CacheEntry<T> {
  timestamp: number;
  value: T;
}

export const loadCacheEntry = async <T>(
  accountId: string,
  key: string,
): Promise<CacheEntry<T> | null> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    const cache = await store.get<Record<string, CacheEntry<T>>>("cache") ?? {};
    return cache[key] ?? null;
  }
  const db = await openDB(accountId);
  const tx = db.transaction(CACHE_STORE, "readonly");
  const store = tx.objectStore(CACHE_STORE);
  return await new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => {
      resolve(req.result as CacheEntry<T> | null);
    };
    req.onerror = () => reject(req.error);
  });
};

export const saveCacheEntry = async <T>(
  accountId: string,
  key: string,
  value: T,
): Promise<void> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    const cache = await store.get<Record<string, CacheEntry<T>>>("cache") ?? {};
    cache[key] = { timestamp: Date.now(), value } as CacheEntry<T>;
    await store.set("cache", cache);
    await store.save();
    return;
  }
  const db = await openDB(accountId);
  const tx = db.transaction(CACHE_STORE, "readwrite");
  const store = tx.objectStore(CACHE_STORE);
  store.put({ timestamp: Date.now(), value } as CacheEntry<T>, key);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
};

// 復号済みメッセージの永続化（ブラウザ/tauri 両対応）
type SerializableChatMessage = Omit<ChatMessage, "timestamp"> & {
  timestamp: string;
};

function serializeMessages(list: ChatMessage[]): SerializableChatMessage[] {
  return list.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() }));
}

function deserializeMessages(list: SerializableChatMessage[]): ChatMessage[] {
  return list.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
}

export const loadDecryptedMessages = async (
  accountId: string,
  roomId: string,
): Promise<ChatMessage[] | null> => {
  const key = `roomMsgs:${roomId}`;
  const entry = await loadCacheEntry<SerializableChatMessage[]>(accountId, key);
  if (!entry || !Array.isArray(entry.value)) return null;
  try {
    return deserializeMessages(entry.value);
  } catch {
    return null;
  }
};

export const saveDecryptedMessages = async (
  accountId: string,
  roomId: string,
  messages: ChatMessage[],
  opts?: { max?: number },
): Promise<void> => {
  const key = `roomMsgs:${roomId}`;
  const max = opts?.max ?? 500;
  // 新しいものから最大 max 件を保存
  const trimmed = messages
    .slice(-max)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  await saveCacheEntry(accountId, key, serializeMessages(trimmed));
};

export const deleteMLSDatabase = async (accountId: string): Promise<void> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    await store.clear();
    await store.save();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const name = `takos_${accountId}`;
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};
