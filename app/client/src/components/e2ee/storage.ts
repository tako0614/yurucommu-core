import type { StoredMLSGroupState, StoredMLSKeyPair } from "./mls.ts";
import { load as loadStore, type Store } from "@tauri-apps/plugin-store";
import { isTauri } from "../../utils/config.ts";

const DB_VERSION = 4;
const STORE_NAME = "mlsGroups";
const KEY_STORE = "mlsKeyPairs";
const CACHE_STORE = "cache";

const stores: Record<string, Store> = {};

async function openStore(accountId: string): Promise<Store> {
  if (stores[accountId]) return stores[accountId];
  const store = await loadStore(`takos_${accountId}.json`);
  stores[accountId] = store;
  return store;
}

function openDB(accountId: string): Promise<IDBDatabase> {
  const name = `takos_${accountId}`;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const loadMLSGroupStates = async (
  accountId: string,
): Promise<Record<string, StoredMLSGroupState>> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    return await store.get<Record<string, StoredMLSGroupState>>("groups") ?? {};
  }
  const db = await openDB(accountId);
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  return await new Promise((resolve, reject) => {
    const req = store.openCursor();
    const result: Record<string, StoredMLSGroupState> = {};
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        result[cursor.key as string] = cursor.value as StoredMLSGroupState;
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
  states: Record<string, StoredMLSGroupState>,
): Promise<void> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    await store.set("groups", states);
    await store.save();
    return;
  }
  const db = await openDB(accountId);
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.clear();
  for (const [id, state] of Object.entries(states)) {
    store.put(state, id);
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
};

export const loadMLSKeyPair = async (
  accountId: string,
): Promise<StoredMLSKeyPair | null> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    return await store.get<StoredMLSKeyPair>("keyPair") ?? null;
  }
  const db = await openDB(accountId);
  const tx = db.transaction(KEY_STORE, "readonly");
  const store = tx.objectStore(KEY_STORE);
  return await new Promise((resolve, reject) => {
    const req = store.openCursor(null, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      resolve(cursor ? (cursor.value as StoredMLSKeyPair) : null);
    };
    req.onerror = () => reject(req.error);
  });
};

export const saveMLSKeyPair = async (
  accountId: string,
  pair: StoredMLSKeyPair,
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

export const deleteMLSDatabase = async (accountId: string): Promise<void> => {
  if (isTauri()) {
    const store = await openStore(accountId);
    await store.clear();
    await store.save();
    return;
  }
  await new Promise((resolve, reject) => {
    const name = `takos_${accountId}`;
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};
