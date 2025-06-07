// Takos API type definitions for extensions
// This provides full type inference for the globalThis.takos API

export interface ActivityPubObject {
  type: string;
  id: string;
  actor?: string;
  object?: unknown;
  to?: string[];
  cc?: string[];
  published?: string;
  content?: string;
  name?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface ActivityPubActor {
  type: string;
  id: string;
  name?: string;
  preferredUsername?: string;
  summary?: string;
  inbox: string;
  outbox: string;
  followers?: string;
  following?: string;
  publicKey?: {
    id: string;
    owner: string;
    publicKeyPem: string;
  };
  [key: string]: unknown;
}

export interface KVStore {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface AssetsManager {
  read(path: string): Promise<string>;
  write(
    path: string,
    data: string | Uint8Array,
    options?: { cacheTTL?: number },
  ): Promise<string>;
  delete(path: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface EventManager {
  // Server-side (server.js)
  publish(eventName: string, payload: unknown): Promise<[number, unknown]>;
  publishToClient(eventName: string, payload: unknown): Promise<void>;
  publishToClientPushNotification(
    eventName: string,
    payload: unknown,
  ): Promise<void>;

  // Client-side (client.js)
  publishToUI(eventName: string, payload: unknown): Promise<void>;
  publishToBackground(eventName: string, payload: unknown): Promise<void>;

  // Common API
  subscribe(eventName: string, handler: (payload: unknown) => void): () => void;
}

export interface PluginActorManager {
  create(localName: string, profile: ActivityPubActor): Promise<string>;
  read(iri: string): Promise<ActivityPubActor>;
  update(iri: string, partial: Partial<ActivityPubActor>): Promise<void>;
  delete(iri: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface ActivityPubManager {
  // Object operations
  send(userId: string, activity: ActivityPubObject): Promise<void>;
  read(id: string): Promise<ActivityPubObject>;
  delete(id: string): Promise<void>;
  list(userId?: string): Promise<string[]>;

  // Actor operations
  actor: {
    read(userId: string): Promise<ActivityPubActor>;
    update(userId: string, key: string, value: string): Promise<void>;
    delete(userId: string, key: string): Promise<void>;
  };

  // Follow operations
  follow(followerId: string, followeeId: string): Promise<void>;
  unfollow(followerId: string, followeeId: string): Promise<void>;
  listFollowers(actorId: string): Promise<string[]>;
  listFollowing(actorId: string): Promise<string[]>;

  // Plugin actor operations
  pluginActor: PluginActorManager;
}

export interface TakosAPI {
  activitypub: ActivityPubManager;
  kv: KVStore;
  assets: AssetsManager;
  events: EventManager;
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

// Global interface declaration for TypeScript
declare global {
  interface Window {
    takos: TakosAPI;
  }

  // For globalThis access
  namespace globalThis {
    var takos: TakosAPI;
  }

  // For const declaration
  var takos: TakosAPI;
}

// Extension hook function types
export type CanAcceptActivityHook = (
  activity: ActivityPubObject,
) => boolean | Promise<boolean>;
export type OnReceiveActivityHook = (
  activity: ActivityPubObject,
) => ActivityPubObject | Promise<ActivityPubObject>;
export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;
export type ServerEventHandler<T = unknown> = (
  payload: T,
) => Promise<[number, unknown]>;

// Extension Manifest interface for takopack configuration
export interface ExtensionManifest {
  name: string;
  description: string;
  version: string;
  identifier: string;
  apiVersion?: string;
  permissions?: string[];
  activityPub?: {
    objects?: Array<{
      accepts: string[];
      context?: string;
      hooks?: {
        canAccept?: string;
        onReceive?: string;
        priority?: number;
        serial?: boolean;
      };
    }>;
  };
  eventDefinitions?: Record<string, {
    source: "client" | "server" | "background" | "ui";
    target: "server" | "client" | "client:*" | "ui" | "background";
    handler: string;
  }>;
  server?: {
    entry: string;
  };
  client: {
    entryUI: string;
    entryBackground?: string;
  };
}

// Re-export for convenience
export type { TakosAPI as default };
