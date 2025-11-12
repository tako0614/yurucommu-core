/**
 * Frontend API Module (SolidJS)
 * Combines shared API client with SolidJS-specific state management
 */

import { createResource, createSignal } from "solid-js";
import type { Resource, ResourceActions } from "solid-js";

// Re-export everything from the shared API client
export * from "./api-client";

// Import specific items we need
import {
  getBackendUrl,
  hasJWT,
  getJWT,
  setJWT,
  clearJWT,
  exchangeSessionForJWT,
  addOrUpdateAccount,
  getHostHandle,
  switchToAccount,
} from "./api-client";
import type { User, StoredAccount } from "./api-client";
import { isSelfHostedMode } from "./config";

function consumeAuthTokenFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    let token = url.searchParams.get("authToken");
    if (token) {
      url.searchParams.delete("authToken");
    } else if (url.hash) {
      const hashParams = new URLSearchParams(url.hash.slice(1));
      const hashToken = hashParams.get("authToken");
      if (hashToken) {
        token = hashToken;
        hashParams.delete("authToken");
        url.hash = hashParams.toString();
      }
    }
    if (token) {
      setJWT(token);
      const cleanedSearch = url.searchParams.toString();
      const cleanedHash = url.hash;
      const newUrl = `${url.pathname}${cleanedSearch ? `?${cleanedSearch}` : ""}${cleanedHash ? (cleanedHash.startsWith("#") ? cleanedHash : `#${cleanedHash}`) : ""}`;
      window.history.replaceState({}, document.title, newUrl || "/");
    }
  } catch (error) {
    console.warn("failed to read auth token from URL", error);
  }
}

consumeAuthTokenFromUrl();

// SolidJS-specific state management
type AuthState = "unknown" | "authenticated" | "unauthenticated";

// Initialize auth state based on JWT
function getInitialAuthState(): AuthState {
  if (typeof window === "undefined") return "unknown";
  // Quick check: if JWT exists, assume authenticated initially
  return hasJWT() ? "authenticated" : "unauthenticated";
}

const [authState, setAuthState] = createSignal<AuthState>(getInitialAuthState());
let refreshPromise: Promise<boolean> | null = null;
let lastRefreshTime = 0;
const REFRESH_COOLDOWN_MS = 5000; // 5秒以内の再呼び出しを防ぐ
export const authStatus = authState;

let cachedMe: User | undefined;
let meResource: Resource<User | undefined> | undefined;
let meResourceControls: ResourceActions<User | undefined> | undefined;
let mePromise: Promise<User> | null = null;

function ensureMeResource() {
  if (!meResource) {
    const fetcher = async () => {
      const data = await fetchMeFromApi();
      cachedMe = data as any;
      return data as any;
    };
    const [resource, controls] = createResource(fetcher, {
      initialValue: cachedMe,
    } as any);
    meResource = resource as any;
    meResourceControls = controls as any;
  }
}

function clearMeCache() {
  cachedMe = undefined;
  mePromise = null;
  if (meResourceControls) {
    meResourceControls.mutate(undefined);
  }
  meResource = undefined;
  meResourceControls = undefined;
}

// Internal function that always fetches from API
async function fetchMeFromApi(): Promise<User> {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    throw new Error("BACKEND_URL not configured");
  }

  const res = await fetch(`${backendUrl}/me`, {
    headers: {
      Authorization: `Bearer ${getJWT()}`,
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json: any = await res.json().catch(() => ({}));
  const data = (json.data ?? json) as User;
  cachedMe = data;
  if (meResourceControls) {
    meResourceControls.mutate(data);
  }

  // Save or update account info in stored accounts
  const jwt = getJWT();
  const hostHandle = getHostHandle();
  if (jwt && hostHandle && data.id) {
    const account: StoredAccount = {
      userId: data.id,
      handle: (data as any).handle || data.id,
      displayName: data.display_name || "User",
      avatarUrl: data.avatar_url || "",
      jwt,
      hostHandle,
    };
    addOrUpdateAccount(account);
  }

  return data;
}

// Public fetchMe that returns cached value if available
export async function fetchMe(): Promise<User> {
  // Return cached value if available and fresh
  if (cachedMe) {
    return cachedMe;
  }

  // Return existing promise if already fetching
  if (mePromise) {
    return mePromise;
  }

  // Start new fetch
  mePromise = fetchMeFromApi();
  try {
    return await mePromise;
  } finally {
    mePromise = null;
  }
}

export async function refreshAuth(): Promise<boolean> {
  // Return cached promise if already refreshing
  if (refreshPromise) return refreshPromise;
  
  // Check cooldown to prevent rapid successive calls
  const now = Date.now();
  if (now - lastRefreshTime < REFRESH_COOLDOWN_MS && authState() !== "unknown") {
    console.log("refreshAuth: cooldown active, returning cached state");
    return authState() === "authenticated";
  }
  
  lastRefreshTime = now;
  refreshPromise = (async () => {
    try {
      const backendUrl = getBackendUrl();
      if (!backendUrl) {
        clearMeCache();
        clearJWT();
        setAuthState("unauthenticated");
        return false;
      }

      let isHostBackend = false;
      if (!isSelfHostedMode() && typeof window !== "undefined") {
        try {
          const currentOrigin = window.location.origin;
          const backendOrigin = new URL(backendUrl, currentOrigin).origin;
          if (backendOrigin === currentOrigin) {
            isHostBackend = true;
          }
        } catch {
          // Ignore parse errors and treat as non-host backend
        }
      }

      if (isHostBackend && !isSelfHostedMode()) {
        // Host backend does not expose account /me endpoint.
        clearMeCache();
        setAuthState("unauthenticated");
        return false;
      }

      // Quick client-side check: if no JWT, try exchanging cookie-based session
      if (!hasJWT()) {
        const token = await exchangeSessionForJWT(backendUrl);
        if (!token) {
          clearMeCache();
          clearJWT();
          setAuthState("unauthenticated");
          return false;
        }
      }

      // JWT exists - assume authenticated and fetch user info in background
      setAuthState("authenticated");

      try {
        await fetchMeFromApi();
        setAuthState("authenticated");
        return true;
      } catch (error) {
        const err = error as any;
        if (err?.message?.includes("401")) {
          clearMeCache();
          clearJWT();
          setAuthState("unauthenticated");
          return false;
        }
        console.warn("refreshAuth: error fetching user", error);
        // Network or other error - keep authenticated state if JWT exists
        return true;
      }
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

// SolidJS-specific hook for accessing current user
export function useMe() {
  ensureMeResource();
  return meResource!;
}

// Account switching helper
export function switchAccount(index: number): void {
  const success = switchToAccount(index);
  if (success) {
    // Clear current user cache
    clearMeCache();
    // Reload the page to refresh all state
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }
}

type ActivityCollection<T = unknown> = {
  orderedItems?: T[];
  items?: T[];
  [key: string]: any;
};

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function requireBackendOrigin(): string {
  const backend = getBackendUrl();
  if (backend) {
    return backend;
  }
  throw new Error("BACKEND_URL not configured");
}

async function activityRequest(
  path: string,
  init: RequestInit = {},
) {
  const backend = requireBackendOrigin();
  const url = joinUrl(backend, path);
  const headers = new Headers(init.headers ?? undefined);
  const jwt = getJWT();
  if (jwt && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${jwt}`);
  }
  const hasBody = init.body !== undefined && init.body !== null;
  if (
    hasBody &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/activity+json, application/json");
  }
  const response = await fetch(url, {
    ...init,
    headers,
  });
  if (response.status === 204) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return null;
  }
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const errorMessage =
      (data && typeof data === "object" && (data as any).error) ||
      (data && typeof data === "object" && (data as any).message) ||
      `HTTP ${response.status}`;
    throw new Error(String(errorMessage));
  }
  return data ?? null;
}

function normalizeCollection<T>(input: unknown): ActivityCollection<T> {
  if (!input || typeof input !== "object") {
    return { orderedItems: [] };
  }
  const candidate = input as ActivityCollection<T>;
  if (Array.isArray(candidate.orderedItems)) {
    return candidate;
  }
  if (Array.isArray(candidate.items)) {
    return { ...candidate, orderedItems: candidate.items };
  }
  return { ...candidate, orderedItems: [] };
}

export async function fetchDirectMessages(threadId: string) {
  if (!threadId) {
    return { orderedItems: [] };
  }
  const data = await activityRequest(`/ap/dm/${encodeURIComponent(threadId)}`);
  return normalizeCollection(data);
}

export async function fetchChannelMessages(
  communityId: string,
  channelId: string,
) {
  if (!communityId || !channelId) {
    return { orderedItems: [] };
  }
  const path = `/ap/channels/${encodeURIComponent(communityId)}/${encodeURIComponent(channelId)}/messages`;
  const data = await activityRequest(path);
  return normalizeCollection(data);
}

export async function postDirectMessage(
  activity: Record<string, unknown>,
) {
  await activityRequest("/ap/outbox", {
    method: "POST",
    body: JSON.stringify(activity),
  });
}

export async function postChannelMessage(
  activity: Record<string, unknown>,
) {
  await activityRequest("/ap/outbox", {
    method: "POST",
    body: JSON.stringify(activity),
  });
}
