// ============================================================================
// App SDK Types v2.0
// Workers-compatible App SDK type definitions
// ============================================================================
/// <reference types="@cloudflare/workers-types" />

// =============================================================================
// Server Types (@takos/app-sdk/server)
// =============================================================================

/**
 * Activity type for ActivityPub operations.
 */
export interface Activity {
  type: string;
  actor?: string;
  object?: unknown;
  target?: string;
  to?: string[];
  cc?: string[];
  [key: string]: unknown;
}

/**
 * Options for AI completion requests.
 */
export interface AiCompleteOptions {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Options for AI embedding requests.
 */
export interface AiEmbedOptions {
  provider?: string;
  model?: string;
  dimensions?: number;
}

/**
 * App-specific KV storage interface (per-user isolated).
 */
export interface AppStorage {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (prefix: string) => Promise<string[]>;
}

/**
 * ActivityPub operations interface.
 */
export interface ActivityPubAPI {
  /** Deliver an activity to remote servers */
  send: (activity: Activity) => Promise<void>;
  /** Resolve a remote object/actor by URI */
  resolve: (uri: string) => Promise<unknown>;
}

/**
 * AI operations interface.
 */
export interface AiAPI {
  /** Generate text completion */
  complete: (prompt: string, options?: AiCompleteOptions) => Promise<string>;
  /** Generate embedding vector */
  embed: (text: string, options?: AiEmbedOptions) => Promise<number[]>;
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
 * Core Kernel service surface injected by takos runtime.
 * This is intentionally loose-typed to keep `@takos/app-sdk` decoupled from Core implementation packages.
 */
export type CoreServices = {
  objects: unknown;
  actors: unknown;
  auth: unknown;
  storage: unknown;
  notifications: unknown;
  db?: (name: string) => Collection;
  [key: string]: unknown;
};

export type CollectionWhereClause = Record<string, unknown>;
export type CollectionOrderBy = { column: string; direction: "asc" | "desc" };
export type CollectionUpdateData = Record<string, unknown>;

export interface CollectionQuery<T = Record<string, unknown>> {
  all(): Promise<T[]>;
  first(): Promise<T | null>;
  where(where: CollectionWhereClause): CollectionQuery<T>;
  orderBy(column: string, direction?: "asc" | "desc"): CollectionQuery<T>;
  limit(limit: number): CollectionQuery<T>;
  offset(offset: number): CollectionQuery<T>;
  count(): Promise<number>;
}

export interface Collection<T = Record<string, unknown>> {
  find(where?: CollectionWhereClause): CollectionQuery<T>;
  findById(id: string | number): Promise<T | null>;
  create(data: Partial<T>): Promise<T>;
  update(where: CollectionWhereClause, data: CollectionUpdateData): Promise<number>;
  updateById(id: string | number, data: CollectionUpdateData): Promise<T | null>;
  delete(where: CollectionWhereClause): Promise<number>;
  deleteById(id: string | number): Promise<boolean>;
  transaction<R>(callback: (tx: Collection<T>) => Promise<R>): Promise<R>;
}

/**
 * Environment object injected by Core into the App.
 * Provides access to Core services and utilities.
 */
export interface AppEnv {
  /**
   * Core Kernel services (defense-in-depth / migration aid).
   * Prefer higher-level APIs (`fetch`, `activitypub`, `ai`) unless you need direct service access.
   */
  core?: CoreServices;

  /**
   * Cloudflare bindings (direct access; optional).
   * Availability depends on the takos host configuration.
   */
  DB?: unknown;
  KV?: unknown;
  STORAGE?: unknown;

  /**
   * Environment variables (optional).
   */
  INSTANCE_DOMAIN?: string;
  INSTANCE_NAME?: string;
  INSTANCE_DESCRIPTION?: string;
  INSTANCE_OPEN_REGISTRATIONS?: string | boolean;
  JWT_SECRET?: string;
  takosConfig?: unknown;
  workspaceId?: string;

  /** App-specific KV storage (isolated per user) */
  storage: AppStorage;

  /** Authenticated fetch to Core API */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;

  /** ActivityPub operations */
  activitypub: ActivityPubAPI;

  /** AI operations */
  ai: AiAPI;

  /** Authentication info (null if not authenticated) */
  auth: AuthInfo | null;

  /** App metadata */
  app: AppInfo;
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
