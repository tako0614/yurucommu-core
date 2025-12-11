import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  api,
  addOrUpdateAccount,
  clearJWT,
  exchangeSessionForJWT,
  getBackendUrl,
  getHostHandle,
  getJWT,
  hasJWT,
  logout as apiLogout,
  setJWT,
  switchToAccount,
  type StoredAccount,
  type User,
} from "./api-client";
import { isSelfHostedMode } from "./config";
import { setRuntimeUser, setRuntimeLoggedIn } from "./takos-runtime";

export * from "./api-client";

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

type AuthState = "unknown" | "authenticated" | "unauthenticated";

function getInitialAuthState(): AuthState {
  if (typeof window === "undefined") return "unknown";
  return hasJWT() ? "authenticated" : "unauthenticated";
}

let authState: AuthState = getInitialAuthState();
let refreshPromise: Promise<boolean> | null = null;
let lastRefreshTime = 0;
const REFRESH_COOLDOWN_MS = 5000;

const authSubscribers = new Set<() => void>();
const meSubscribers = new Set<() => void>();

function notifyAuth() {
  authSubscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function notifyMe() {
  meSubscribers.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function setAuthState(next: AuthState) {
  if (authState !== next) {
    authState = next;
    setRuntimeLoggedIn(next === "authenticated");
    notifyAuth();
  }
}

export function authStatus(): AuthState {
  return authState;
}

export function useAuthStatus(): AuthState {
  return useSyncExternalStore(
    (listener) => {
      authSubscribers.add(listener);
      return () => authSubscribers.delete(listener);
    },
    () => authState,
    () => authState,
  );
}

let cachedMe: User | undefined;
let mePromise: Promise<User> | null = null;

function setCachedMe(user: User | undefined) {
  cachedMe = user;
  setRuntimeUser(user ?? null);
  notifyMe();
}

function clearMeCache() {
  cachedMe = undefined;
  mePromise = null;
  notifyMe();
}

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
  setCachedMe(data);

  const jwt = getJWT();
  const hostHandle = getHostHandle();
  if (jwt && hostHandle && data.id) {
    const account: StoredAccount = {
      userId: data.id,
      handle: (data as any).handle || data.id,
      displayName: data.display_name || "User",
      avatarUrl: (data as any).avatar_url || "",
      jwt,
      hostHandle,
    };
    addOrUpdateAccount(account);
  }

  return data;
}

export async function fetchMe(): Promise<User> {
  if (cachedMe) return cachedMe;
  if (mePromise) return mePromise;
  mePromise = fetchMeFromApi();
  try {
    return await mePromise;
  } finally {
    mePromise = null;
  }
}

export function useMe(): () => User | undefined {
  const user = useSyncExternalStore(
    (listener) => {
      meSubscribers.add(listener);
      return () => meSubscribers.delete(listener);
    },
    () => cachedMe,
    () => cachedMe,
  );

  useEffect(() => {
    if (authState === "authenticated" && !user) {
      fetchMe().catch(() => {});
    }
  }, [user]);

  return useCallback(() => user, [user]);
}

export async function refreshAuth(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  const now = Date.now();
  if (now - lastRefreshTime < REFRESH_COOLDOWN_MS && authState !== "unknown") {
    return authState === "authenticated";
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
          /* ignore */
        }
      }

      if (isHostBackend && !isSelfHostedMode()) {
        clearMeCache();
        setAuthState("unauthenticated");
        return false;
      }

      if (!hasJWT()) {
        const token = await exchangeSessionForJWT(backendUrl);
        if (!token) {
          clearMeCache();
          clearJWT();
          setAuthState("unauthenticated");
          return false;
        }
      }

      setAuthState("authenticated");

      try {
        await fetchMeFromApi();
        setAuthState("authenticated");
        return true;
      } catch (error: any) {
        if (error?.message?.includes("401")) {
          clearMeCache();
          clearJWT();
          setAuthState("unauthenticated");
          return false;
        }
        console.warn("refreshAuth: error fetching user", error);
        return true;
      }
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function logout(): Promise<void> {
  try {
    await apiLogout();
  } finally {
    clearMeCache();
    clearJWT();
    setAuthState("unauthenticated");
  }
}

export function switchAccount(index: number): void {
  const success = switchToAccount(index);
  if (success) {
    clearMeCache();
    setAuthState("unknown");
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
  if (backend) return backend;
  throw new Error("BACKEND_URL not configured");
}

async function activityRequest(path: string, init: RequestInit = {}) {
  const backend = requireBackendOrigin();
  const url = joinUrl(backend, path);
  const headers = new Headers(init.headers ?? undefined);
  const jwt = getJWT();
  if (jwt && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${jwt}`);
  }
  const hasBody = init.body !== undefined && init.body !== null;
  if (hasBody && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
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

export async function fetchChannelMessages(communityId: string, channelId: string) {
  if (!communityId || !channelId) {
    return { orderedItems: [] };
  }
  const path = `/ap/channels/${encodeURIComponent(communityId)}/${encodeURIComponent(channelId)}/messages`;
  const data = await activityRequest(path);
  return normalizeCollection(data);
}

export async function postDirectMessage(params: { recipients: string[]; content: string; inReplyTo?: string | null; context?: string | null }) {
  const recipients = Array.isArray(params.recipients) ? params.recipients : [];
  if (!recipients.length) {
    throw new Error("recipient required");
  }

  const result = await api("/dm/send", {
    method: "POST",
    body: JSON.stringify({
      recipients,
      content: params.content,
      ...(params.inReplyTo && typeof params.inReplyTo === "string" && params.inReplyTo.trim()
        ? { inReplyTo: params.inReplyTo.trim() }
        : {}),
    }),
  });

  return { threadId: (result as any)?.threadId };
}

export async function postChannelMessage(params: { communityId: string; channelId: string; content: string; recipients?: string[]; inReplyTo?: string | null }) {
  if (!params.communityId || !params.channelId) {
    throw new Error("communityId and channelId required");
  }

  await api(`/communities/${encodeURIComponent(params.communityId)}/channels/${encodeURIComponent(params.channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: params.content,
      recipients: Array.isArray(params.recipients) ? params.recipients : [],
      ...(params.inReplyTo && typeof params.inReplyTo === "string" && params.inReplyTo.trim()
        ? { inReplyTo: params.inReplyTo.trim() }
        : {}),
    }),
  });
}
