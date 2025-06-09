/**
 * Takos API Helpers
 * 
 * 型安全なglobalThis.takosアクセスと共通ユーティリティ関数
 */

// Takos API型定義
export interface TakosEvent<T = unknown> {
  name: string;
  payload: T;
  timestamp: number;
  source: "server" | "client" | "ui" | "background";
}

export interface TakosEventsAPI {
  publish<T = unknown>(eventName: string, payload: T): Promise<void>;
  publishToBackground<T = unknown>(eventName: string, payload: T): Promise<void>;
  publishToUI<T = unknown>(eventName: string, payload: T): Promise<void>;
  subscribe<T = unknown>(eventName: string, handler: (payload: T) => void): () => void;
}

export interface TakosKVAPI {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface TakosCdnAPI {
  read(path: string): Promise<string>;
  write(path: string, data: string | Uint8Array, options?: { cacheTTL?: number }): Promise<string>;
  delete(path: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface TakosActivityPubAPI {
  send(userId: string, activity: Record<string, unknown>): Promise<void>;
  read(id: string): Promise<Record<string, unknown>>;
  delete(id: string): Promise<void>;
  list(userId?: string): Promise<string[]>;
  actor: {
    read(userId: string): Promise<Record<string, unknown>>;
    update(userId: string, key: string, value: string): Promise<void>;
    delete(userId: string, key: string): Promise<void>;
  };
  pluginActor: {
    create(localName: string, profile: Record<string, unknown>): Promise<string>;
    read(iri: string): Promise<Record<string, unknown>>;
    update(iri: string, partial: Record<string, unknown>): Promise<void>;
    delete(iri: string): Promise<void>;
    list(): Promise<string[]>;
  };
}

// コンテキスト別API定義
export interface TakosServerAPI {
  kv: TakosKVAPI;
  activitypub: TakosActivityPubAPI;
  cdn: TakosCdnAPI;
  events: TakosEventsAPI;
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

export interface TakosClientAPI {
  kv: TakosKVAPI;
  cdn: TakosCdnAPI;
  events: TakosEventsAPI;
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

export interface TakosUIAPI {
  events: Pick<TakosEventsAPI, 'publishToBackground' | 'subscribe'>;
}

// 型安全なTakos APIアクセス関数群
/**
 * サーバーコンテキストでTakos APIにアクセス
 */
export function getTakosServerAPI(): TakosServerAPI | undefined {
  return (globalThis as Record<string, unknown>).takos as TakosServerAPI | undefined;
}

/**
 * クライアントコンテキストでTakos APIにアクセス
 */
export function getTakosClientAPI(): TakosClientAPI | undefined {
  return (globalThis as Record<string, unknown>).takos as TakosClientAPI | undefined;
}

/**
 * UIコンテキストでTakos APIにアクセス
 */
export function getTakosUIAPI(): TakosUIAPI | undefined {
  return (globalThis as Record<string, unknown>).takos as TakosUIAPI | undefined;
}

/**
 * 汎用的なTakos APIアクセス（型推論が制限される）
 */
export function getTakosAPI(): TakosServerAPI | TakosClientAPI | TakosUIAPI | undefined {
  return (globalThis as Record<string, unknown>).takos as TakosServerAPI | TakosClientAPI | TakosUIAPI | undefined;
}

// 便利なヘルパー関数
/**
 * イベントを安全に発行する
 */
export async function publishEvent<T = unknown>(
  eventName: string, 
  payload: T,
  context: 'server' | 'client' | 'ui' = 'client'
): Promise<void> {
  if (context === 'ui') {
    const api = getTakosUIAPI();
    if (!api?.events) {
      console.warn(`Takos API not available in ${context} context`);
      return;
    }
    await api.events.publishToBackground(eventName, payload);
  } else {
    const api = context === 'server' ? getTakosServerAPI() : getTakosClientAPI();
    if (!api?.events) {
      console.warn(`Takos API not available in ${context} context`);
      return;
    }
    await api.events.publish(eventName, payload);
  }
}

/**
 * KVストアに安全にアクセスする
 */
export async function kvRead(key: string): Promise<unknown> {
  const serverAPI = getTakosServerAPI();
  if (serverAPI?.kv) {
    return await serverAPI.kv.read(key);
  }
  
  const clientAPI = getTakosClientAPI();
  if (clientAPI?.kv) {
    return await clientAPI.kv.read(key);
  }
  
  console.warn('KV API not available in this context');
  return undefined;
}

export async function kvWrite(key: string, value: unknown): Promise<void> {
  const serverAPI = getTakosServerAPI();
  if (serverAPI?.kv) {
    await serverAPI.kv.write(key, value);
    return;
  }
  
  const clientAPI = getTakosClientAPI();
  if (clientAPI?.kv) {
    await clientAPI.kv.write(key, value);
    return;
  }
  
  console.warn('KV API not available in this context');
}

/**
 * ActivityPubアクションを安全に実行する
 */
export async function sendActivityPub(
  userId: string, 
  activity: Record<string, unknown>
): Promise<void> {
  const api = getTakosServerAPI();
  if (!api?.activitypub) {
    console.warn('ActivityPub API not available in this context (server only)');
    return;
  }
  
  await api.activitypub.send(userId, activity);
}

// 型ガード関数
export function isServerContext(api: unknown): api is TakosServerAPI {
  return api !== null && 
         typeof api === 'object' && 
         'kv' in api && 
         'activitypub' in api && 
         'cdn' in api &&
         'events' in api &&
         'fetch' in api;
}

export function isClientContext(api: unknown): api is TakosClientAPI {
  return api !== null && 
         typeof api === 'object' && 
         'kv' in api && 
         'cdn' in api &&
         'events' in api &&
         'fetch' in api;
}

export function isUIContext(api: unknown): api is TakosUIAPI {
  return api !== null && 
         typeof api === 'object' && 
         'events' in api &&
         !('kv' in api);
}
