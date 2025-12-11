// ============================================================================
// App SDK Types v2.0
// Workers-compatible App SDK type definitions
// ============================================================================

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
export interface AuthInfo {
  userId: string;
  handle: string;
}

/**
 * App metadata.
 */
export interface AppInfo {
  id: string;
  version: string;
}

/**
 * Environment object injected by Core into the App.
 * Provides access to Core services and utilities.
 */
export interface AppEnv {
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
