/**
 * TakosRuntime Factory
 *
 * Creates a runtime object that bridges Core (frontend) and App components.
 * Implements the TakosRuntime interface from @takos/app-sdk.
 *
 * Reference: docs/plan/16-app-sdk.md §16.7
 */

import type { TakosRuntime, CoreAPI, AppAPI, AuthState, UserIdentity } from "@takos/app-sdk";
import { getBackendUrl, getJWT, hasJWT } from "./api-client";
import type { User } from "@takos/platform";
import { extractRouteParams, getScreenByRoute, loadAppManifest, type AppManifest } from "./app-manifest";

// Global state subscribers for auth changes
type AuthListener = () => void;
const authListeners = new Set<AuthListener>();

let cachedAuthState: AuthState | null = null;
let cachedUser: User | null = null;

// Global route params (synced from App.tsx via setRouteParams)
let currentRouteParams: Record<string, string> = {};

// Route params change listeners
type RouteParamsListener = (params: Record<string, string>) => void;
const routeParamsListeners = new Set<RouteParamsListener>();

// Cached manifest for route param extraction
let cachedManifestForRouting: AppManifest | null = null;

export function setRuntimeUser(user: User | null): void {
  cachedUser = user;
  cachedAuthState = null; // Invalidate cache
  notifyAuthListeners();
}

export function setRuntimeLoggedIn(loggedIn: boolean): void {
  if (!loggedIn) {
    cachedUser = null;
  }
  cachedAuthState = null;
  notifyAuthListeners();
}

function notifyAuthListeners(): void {
  authListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore
    }
  });
}

export function subscribeToAuth(listener: AuthListener): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

/**
 * Get current authentication state
 */
function getAuthState(): AuthState {
  if (cachedAuthState) {
    return cachedAuthState;
  }

  const isLoggedIn = hasJWT();
  const token = getJWT();

  let user: UserIdentity | null = null;
  if (cachedUser && isLoggedIn) {
    user = {
      id: cachedUser.id,
      handle: (cachedUser as any).handle || cachedUser.id,
      displayName: cachedUser.display_name || "User",
      avatar: (cachedUser as any).avatar_url,
    };
  }

  cachedAuthState = {
    isLoggedIn,
    user,
    token,
  };

  return cachedAuthState;
}

/**
 * Set route parameters (called by App.tsx when route changes)
 */
export function setRouteParams(params: Record<string, string>): void {
  currentRouteParams = params;
  notifyRouteParamsListeners(params);
}

/**
 * Notify all route params listeners
 */
function notifyRouteParamsListeners(params: Record<string, string>): void {
  routeParamsListeners.forEach((listener) => {
    try {
      listener(params);
    } catch {
      // ignore
    }
  });
}

/**
 * Subscribe to route params changes
 */
export function subscribeToRouteParams(listener: RouteParamsListener): () => void {
  routeParamsListeners.add(listener);
  return () => routeParamsListeners.delete(listener);
}

/**
 * Sync route params from current URL path (async, uses manifest)
 */
export async function syncRouteParamsFromPath(pathname?: string): Promise<Record<string, string>> {
  const path = pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");

  if (!cachedManifestForRouting) {
    cachedManifestForRouting = await loadAppManifest();
  }

  const screen = getScreenByRoute(cachedManifestForRouting, path);
  if (screen) {
    const params = extractRouteParams(screen.route, path);
    setRouteParams(params);
    return params;
  }

  setRouteParams({});
  return {};
}

/**
 * Extract route parameters from current URL path
 */
function extractParams(): Record<string, string> {
  return currentRouteParams;
}

/**
 * Extract query parameters from current URL
 */
function extractQuery(): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }
  const params = new URLSearchParams(window.location.search);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Create Core API client for accessing backend API endpoints.
 *
 * Note: According to docs/plan/16-app-sdk.md §16.4, the URL mapping is:
 *   runtime.core.fetch('/posts') => /-/api/posts
 *
 * However, the current backend uses direct paths like /posts, /me, etc.
 * This implementation uses the existing backend paths for compatibility.
 * When the backend adds the /-/api prefix, update the baseFetch URL accordingly.
 */
export function createCoreAPI(): CoreAPI {
  const backendUrl = getBackendUrl();

  // Core API uses direct backend paths (e.g., /posts, /me)
  // Future: change to `${backendUrl}/-/api${normalizedPath}` when backend is updated
  const baseFetch = async (path: string, options?: RequestInit): Promise<Response> => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = `${backendUrl}${normalizedPath}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string> || {}),
    };

    const jwt = getJWT();
    if (jwt) {
      headers["Authorization"] = `Bearer ${jwt}`;
    }

    return fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });
  };

  const jsonFetch = async <T>(path: string, options?: RequestInit): Promise<T> => {
    const response = await baseFetch(path, options);
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `HTTP ${response.status}`);
    }
    const json = await response.json();
    return (json.data ?? json) as T;
  };

  return {
    fetch: baseFetch,

    posts: {
      list: async (params?: Record<string, unknown>) => {
        const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : "";
        return jsonFetch(`/posts${query}`);
      },
      get: async (id: string) => {
        return jsonFetch(`/posts/${encodeURIComponent(id)}`);
      },
      create: async (data: Record<string, unknown>) => {
        return jsonFetch("/posts", {
          method: "POST",
          body: JSON.stringify(data),
        });
      },
      delete: async (id: string) => {
        await baseFetch(`/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
      },
    },

    users: {
      get: async (id: string) => {
        return jsonFetch(`/users/${encodeURIComponent(id)}`);
      },
      follow: async (id: string) => {
        await jsonFetch(`/users/${encodeURIComponent(id)}/follow`, { method: "POST" });
      },
      unfollow: async (id: string) => {
        await jsonFetch(`/users/${encodeURIComponent(id)}/unfollow`, { method: "POST" });
      },
    },

    timeline: {
      home: async (params?: Record<string, unknown>) => {
        const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : "";
        return jsonFetch(`/timeline/home${query}`);
      },
    },

    notifications: {
      list: async (params?: Record<string, unknown>) => {
        const query = params ? `?${new URLSearchParams(params as Record<string, string>)}` : "";
        return jsonFetch(`/notifications${query}`);
      },
      markRead: async (ids: string[]) => {
        await jsonFetch("/notifications/read", {
          method: "POST",
          body: JSON.stringify({ ids }),
        });
      },
    },

    storage: {
      upload: async (file: File, options?: Record<string, unknown>) => {
        const formData = new FormData();
        formData.append("file", file);
        if (options) {
          Object.entries(options).forEach(([key, value]) => {
            formData.append(key, String(value));
          });
        }

        // Use existing backend path for storage upload
        const url = `${backendUrl}/storage/upload`;
        const headers: Record<string, string> = {};
        const jwt = getJWT();
        if (jwt) {
          headers["Authorization"] = `Bearer ${jwt}`;
        }

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: formData,
          credentials: "include",
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw new Error(errorBody.error || `HTTP ${response.status}`);
        }

        const json = await response.json();
        return json.data ?? json;
      },
      get: async (key: string): Promise<Blob | null> => {
        // Use existing backend path for storage get
        const url = `${backendUrl}/storage/${encodeURIComponent(key)}`;
        const headers: Record<string, string> = {};
        const jwt = getJWT();
        if (jwt) {
          headers["Authorization"] = `Bearer ${jwt}`;
        }

        const response = await fetch(url, {
          headers,
          credentials: "include",
        });
        if (!response.ok) {
          if (response.status === 404) {
            return null;
          }
          throw new Error(`HTTP ${response.status}`);
        }
        return response.blob();
      },
      delete: async (key: string) => {
        await baseFetch(`/storage/${encodeURIComponent(key)}`, { method: "DELETE" });
      },
    },
  };
}

/**
 * Create App API client for accessing /-/apps/{appId}/api/* endpoints
 */
export function createAppAPI(appId: string): AppAPI {
  const backendUrl = getBackendUrl();

  return {
    fetch: async (path: string, options?: RequestInit): Promise<Response> => {
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const url = `${backendUrl}/-/apps/${encodeURIComponent(appId)}/api${normalizedPath}`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string> || {}),
      };

      const jwt = getJWT();
      if (jwt) {
        headers["Authorization"] = `Bearer ${jwt}`;
      }

      return fetch(url, {
        ...options,
        headers,
        credentials: "include",
      });
    },
  };
}

// App metadata cache
const appMetadataCache = new Map<string, { version: string; permissions: string[] }>();

function getAppVersion(appId: string): string {
  return appMetadataCache.get(appId)?.version ?? "1.0.0";
}

function getAppPermissions(appId: string): string[] {
  return appMetadataCache.get(appId)?.permissions ?? [];
}

export function setAppMetadata(appId: string, version: string, permissions: string[]): void {
  appMetadataCache.set(appId, { version, permissions });
}

// UI integration types
type ToastFn = (message: string, type?: "success" | "error" | "info") => void;
type ConfirmFn = (message: string) => Promise<boolean>;
type ModalOpenFn = (component: React.ComponentType) => void;
type ModalCloseFn = () => void;

// UI integration handlers (set by App.tsx or Shell)
let toastHandler: ToastFn = (message, type) => {
  console.log(`[Toast:${type || "info"}] ${message}`);
};

let confirmHandler: ConfirmFn = async (message) => {
  return window.confirm(message);
};

let modalOpenHandler: ModalOpenFn = () => {
  console.warn("Modal not configured");
};

let modalCloseHandler: ModalCloseFn = () => {
  console.warn("Modal not configured");
};

export function setToastHandler(handler: ToastFn): void {
  toastHandler = handler;
}

export function setConfirmHandler(handler: ConfirmFn): void {
  confirmHandler = handler;
}

export function setModalHandlers(open: ModalOpenFn, close: ModalCloseFn): void {
  modalOpenHandler = open;
  modalCloseHandler = close;
}

// Navigation handler (set by router integration)
let navigateHandler: (path: string) => void = (path) => {
  if (typeof window !== "undefined") {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
};

export function setNavigateHandler(handler: (path: string) => void): void {
  // Wrap handler to sync route params after navigation
  navigateHandler = (path: string) => {
    handler(path);
    // Async sync route params after navigation
    syncRouteParamsFromPath(path).catch(() => {
      // ignore errors during sync
    });
  };
}

/**
 * Create TakosRuntime for an App
 */
export function createTakosRuntime(appId: string): TakosRuntime {
  return {
    // Navigation
    navigate: (path: string) => navigateHandler(path),
    back: () => {
      if (typeof window !== "undefined") {
        window.history.back();
      }
    },
    get currentPath() {
      if (typeof window === "undefined") return "/";
      return window.location.pathname;
    },
    get params() {
      return extractParams();
    },
    get query() {
      return extractQuery();
    },

    // Authentication
    get auth() {
      return getAuthState();
    },

    // APIs
    core: createCoreAPI(),
    app: createAppAPI(appId),

    // UI Integration
    ui: {
      toast: (message: string, type?: "success" | "error" | "info") => {
        toastHandler(message, type);
      },
      confirm: (message: string) => confirmHandler(message),
      modal: {
        open: (component: React.ComponentType) => modalOpenHandler(component),
        close: () => modalCloseHandler(),
      },
    },

    // App Info
    appInfo: {
      id: appId,
      version: getAppVersion(appId),
      permissions: getAppPermissions(appId),
    },
  };
}
