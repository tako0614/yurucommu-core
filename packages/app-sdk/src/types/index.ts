// ============================================================================
// App SDK Types v3.0
// Workers-compatible App SDK type definitions
// ============================================================================
/// <reference types="@cloudflare/workers-types" />

// =============================================================================
// Server Types (@takos/app-sdk/server)
// =============================================================================

/**
 * Storage set options.
 */
export interface AppStorageSetOptions {
  /** TTL in seconds */
  expirationTtl?: number;
}

/**
 * App-specific KV storage interface (per-user isolated).
 */
export interface AppStorage {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown, options?: AppStorageSetOptions) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
}

/**
 * OpenAI SDK compatible AI interface.
 * Can be passed directly to LangChain or used with OpenAI SDK.
 */
export interface OpenAICompatibleClient {
  chat: {
    completions: {
      create: (params: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        max_tokens?: number;
        stream?: boolean;
        [key: string]: unknown;
      }) => Promise<{
        id: string;
        choices: Array<{
          message: { role: string; content: string };
          finish_reason: string;
        }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      }>;
    };
  };
  embeddings: {
    create: (params: {
      model: string;
      input: string | string[];
    }) => Promise<{
      data: Array<{ embedding: number[]; index: number }>;
      usage?: { prompt_tokens: number; total_tokens: number };
    }>;
  };
}

/**
 * Authentication information (read-only).
 * null if the request is not authenticated.
 */
export type PlanName = string;

export type PlanLimits = {
  storage: number;
  fileSize: number;
  aiRequests: number;
  dmMessagesPerDay: number;
  dmMediaSize: number;
  vfsStorage?: number;
  vfsMaxFiles?: number;
  vfsMaxFileSize?: number;
  vfsMaxWorkspaces?: number;
  apDeliveryPerMinute?: number;
  apDeliveryPerDay?: number;
};

export type PlanInfo = {
  name: PlanName;
  limits: PlanLimits;
  features: string[];
};

export interface AuthInfo {
  userId: string;
  handle: string;
  sessionId?: string | null;
  plan?: PlanInfo;
  limits?: PlanLimits;
  isAuthenticated?: boolean;
}

/**
 * App metadata.
 */
export interface AppInfo {
  id: string;
  version: string;
}

/**
 * Instance metadata (read-only).
 */
export interface InstanceInfo {
  domain: string;
  name: string;
  description: string;
  openRegistrations: boolean;
}

// =============================================================================
// Core Services (高レベル API)
// =============================================================================

/**
 * Object (Note, Article, etc.) for ObjectService.
 */
export interface TakosObject {
  id: string;
  type: string;
  content?: string;
  actor_id?: string;
  visibility?: "public" | "unlisted" | "followers" | "direct" | "community";
  in_reply_to?: string | null;
  sensitive?: boolean;
  spoiler_text?: string | null;
  created_at: string;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * Actor (User, Group, etc.) for ActorService.
 */
export interface TakosActor {
  id: string;
  handle: string;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  is_local: boolean;
  created_at: string;
  [key: string]: unknown;
}

/**
 * Notification for NotificationService.
 */
export interface TakosNotification {
  id: string;
  type: string;
  actor_id?: string;
  object_id?: string;
  read: boolean;
  created_at: string;
  [key: string]: unknown;
}

/**
 * ObjectService - CRUD operations for objects (posts, notes, etc.).
 */
export interface ObjectService {
  get(id: string): Promise<TakosObject | null>;
  create(data: Partial<TakosObject>): Promise<TakosObject>;
  update(id: string, data: Partial<TakosObject>): Promise<TakosObject | null>;
  delete(id: string): Promise<boolean>;
  list(options?: { actor_id?: string; type?: string; limit?: number; cursor?: string }): Promise<{
    items: TakosObject[];
    nextCursor?: string | null;
  }>;
}

/**
 * ActorService - Operations for actors (users, groups).
 */
export interface ActorService {
  get(id: string): Promise<TakosActor | null>;
  getByHandle(handle: string): Promise<TakosActor | null>;
  follow(targetId: string): Promise<void>;
  unfollow(targetId: string): Promise<void>;
  getFollowers(actorId: string, options?: { limit?: number; cursor?: string }): Promise<{
    items: TakosActor[];
    nextCursor?: string | null;
  }>;
  getFollowing(actorId: string, options?: { limit?: number; cursor?: string }): Promise<{
    items: TakosActor[];
    nextCursor?: string | null;
  }>;
}

/**
 * NotificationService - Notification operations.
 */
export interface NotificationService {
  list(options?: { limit?: number; since?: string }): Promise<TakosNotification[]>;
  markAsRead(id: string): Promise<void>;
  markAllAsRead(): Promise<void>;
}

/**
 * Core Services - All services provided by Core Kernel.
 */
export interface CoreServices {
  /** AI - OpenAI SDK compatible */
  ai: OpenAICompatibleClient;
  /** KV Storage (per-user isolated) */
  storage: AppStorage;
  /** Object operations (posts, notes, etc.) */
  objects: ObjectService;
  /** Actor operations (users, groups) */
  actors: ActorService;
  /** Notification operations */
  notifications: NotificationService;
}

/**
 * Environment object injected by Core into the App.
 * Provides access to Core services and utilities.
 *
 * Note: Raw Cloudflare bindings (DB, KV, STORAGE) are NOT exposed.
 * Use the takos-provided APIs instead (JS API, not direct bindings):
 * - `core.objects`, `core.actors`, ...
 * - `storage` for App state
 * - `fetch` for internal Core HTTP APIs (escape hatch)
 */
export interface AppEnv {
  /** Core Kernel services */
  core: CoreServices;

  /** Authentication info (null if not authenticated) */
  auth: AuthInfo | null;

  /** App metadata */
  app: AppInfo;

  /** Instance metadata */
  instance: InstanceInfo;

  /**
   * Node configuration (read-only).
   * Shape matches takos config, but is intentionally typed as unknown in the SDK.
   */
  takosConfig?: unknown;

  /** Per-user KV storage */
  storage: AppStorage;

  /** Global KV storage (shared across users) */
  storageGlobal: AppStorage;

  /** Authenticated fetch helper for calling Core APIs */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

/**
 * TakosApp interface - Workers-compatible App definition.
 * Apps implement this interface to handle HTTP requests.
 */
export interface TakosApp {
  /**
   * Handle an HTTP request.
   * @param request - The incoming HTTP request
   * @param env - Environment object with Core services
   * @returns A Response or Promise<Response>
   */
  fetch(request: Request, env: AppEnv): Response | Promise<Response>;

  /**
   * Handle a scheduled event (Cloudflare Workers Cron Triggers).
   */
  scheduled?: (event: ScheduledEvent, env: AppEnv, ctx: ExecutionContext) => void | Promise<void>;
}

// =============================================================================
// Client Types (@takos/app-sdk/client)
// =============================================================================

/**
 * User identity for client-side auth state.
 */
export interface UserIdentity {
  id: string;
  handle: string;
  displayName: string;
  avatar?: string;
}

/**
 * Authentication state for client-side.
 */
export interface ClientAuthState {
  user: UserIdentity | null;
  isLoggedIn: boolean;
}

/**
 * App info for client-side.
 */
export interface ClientAppInfo {
  appId: string;
  version: string;
}

// =============================================================================
// Manifest Types
// =============================================================================

/**
 * App entry points.
 */
export interface AppEntry {
  server: string;
  client?: string;
  styles?: string;
}

/**
 * App manifest schema v2.0.
 */
export interface AppManifest {
  schema_version: "2.0";
  id: string;
  name: string;
  version: string;
  description?: string;
  /** The official app version this app is based on */
  basedOn?: string;
  /** Whether this app has been modified from the base */
  modified?: boolean;
  /** Entry points */
  entry: AppEntry;
}
