import type * as React from "react";

export type ScreenAuth = "required" | "optional";

export interface UserIdentity {
  id: string;
  handle: string;
  displayName: string;
  avatar?: string;
}

export interface AuthState {
  isLoggedIn: boolean;
  user: UserIdentity | null;
  token: string | null;
}

// =============================================================================
// Core Services - Base types shared between client and server
// =============================================================================

export interface PostsService {
  list: (params?: Record<string, unknown>) => Promise<unknown>;
  get: (id: string) => Promise<unknown>;
  create: (data: Record<string, unknown>) => Promise<unknown>;
  delete: (id: string) => Promise<void>;
}

export interface UsersService {
  get: (id: string) => Promise<unknown>;
  follow: (id: string) => Promise<void>;
  unfollow: (id: string) => Promise<void>;
}

export interface TimelineService {
  home: (params?: Record<string, unknown>) => Promise<unknown>;
}

export interface NotificationsService {
  list: (params?: Record<string, unknown>) => Promise<unknown>;
  markRead: (ids: string[]) => Promise<void>;
}

export interface StorageService {
  upload: (file: File | Blob, options?: Record<string, unknown>) => Promise<unknown>;
  get: (key: string) => Promise<Blob | null>;
  delete: (key: string) => Promise<void>;
}

export interface ActivityPubService {
  send: (activity: Record<string, unknown>) => Promise<void>;
  resolve: (uri: string) => Promise<unknown>;
}

export interface AIService {
  complete: (prompt: string, options?: Record<string, unknown>) => Promise<string>;
  embed: (text: string) => Promise<number[]>;
}

/**
 * CoreServices - Base interface for core services available on both client and server.
 * Contains common functionality shared across environments.
 */
export interface CoreServices {
  posts: PostsService;
  users: UsersService;
  storage: StorageService;
}

/**
 * CoreAPI - Client-side API interface.
 * Extends CoreServices with client-specific functionality.
 */
export interface CoreAPI extends CoreServices {
  /** Raw fetch for custom API calls */
  fetch: (path: string, options?: RequestInit) => Promise<Response>;
  /** Timeline operations (client-only convenience) */
  timeline: TimelineService;
  /** Notification operations */
  notifications: NotificationsService;
  /** ActivityPub operations (available on both client and server) */
  activitypub: ActivityPubService;
  /** AI operations (available on both client and server) */
  ai: AIService;
}

/**
 * ServerCoreAPI - Server-side API interface for handlers.
 * Extends CoreServices with server-specific functionality.
 */
export interface ServerCoreAPI extends CoreServices {
  /** Timeline operations */
  timeline: TimelineService;
  /** Notification operations */
  notifications: NotificationsService;
  /** ActivityPub operations */
  activitypub: ActivityPubService;
  /** AI operations */
  ai: AIService;
}

export interface AppAPI {
  fetch: (path: string, options?: RequestInit) => Promise<Response>;
}

export interface TakosRuntime {
  navigate: (path: string) => void;
  back: () => void;
  currentPath: string;
  params: Record<string, string>;
  query: Record<string, string>;
  auth: AuthState;
  core: CoreAPI;
  app: AppAPI;
  ui: {
    toast: (message: string, type?: "success" | "error" | "info") => void;
    confirm: (message: string) => Promise<boolean>;
    modal: {
      open: (component: React.ComponentType) => void;
      close: () => void;
    };
  };
  appInfo: {
    id: string;
    version: string;
    permissions: string[];
  };
}

export interface ScreenConfig {
  id: string;
  path: string;
  component: React.ComponentType;
  title?: string;
  auth?: ScreenAuth;
}

export type ScreenDefinition = ScreenConfig & {
  __takosScreen?: true;
};

export interface AppConfig {
  id: string;
  name: string;
  version: string;
  description?: string;
  screens: ScreenDefinition[];
  handlers?: unknown[];
  permissions?: string[];
}

export type AppDefinition = React.ComponentType<{ runtime: TakosRuntime }> & {
  __takosApp?: NormalizedAppConfig;
};

export type NormalizedScreen = ScreenDefinition & {
  auth: ScreenAuth;
};

export interface NormalizedAppConfig extends Omit<AppConfig, "screens"> {
  id: string;
  screens: NormalizedScreen[];
}

/**
 * App-specific storage for handler state (KV-like).
 * Separate from core.storage which handles file/blob storage.
 */
export interface AppStorage {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
}

/**
 * HandlerContext - Context provided to server-side handlers.
 * Uses ServerCoreAPI for core services with full server capabilities.
 */
export interface HandlerContext {
  /** Authenticated user info */
  auth: {
    userId: string;
    handle: string;
  };
  /** Route parameters (e.g., :id from /posts/:id) */
  params: Record<string, string>;
  /** Query string parameters */
  query: Record<string, string>;
  /** Core services - unified type with client */
  core: ServerCoreAPI;
  /** App-specific KV storage for handler state */
  storage: AppStorage;
  /** Helper to create JSON response */
  json: <T>(data: T, options?: { status?: number }) => Response;
  /** Helper to create error response */
  error: (message: string, status?: number) => Response;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface HandlerConfig<TInput = unknown, TOutput = unknown> {
  method: HttpMethod;
  path: string;
  auth?: boolean;
  handler: (ctx: HandlerContext, input: TInput) => Promise<TOutput>;
}

export interface HandlerMetadata {
  id: string;
  method: HttpMethod;
  path: string;
  auth: boolean;
}

export type Handler<TInput = unknown, TOutput = unknown> = {
  __takosHandler: true;
  metadata: HandlerMetadata;
  handler: (ctx: HandlerContext, input: TInput) => Promise<TOutput>;
}

export interface AppManifest {
  schema_version: "2.0";
}
