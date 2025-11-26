/**
 * Frontend API Client
 * Uses shared API client with SolidJS-specific implementations
 */

import {
  createApiClient,
  createStoryApi,
  ApiError,
  type User,
  type Community,
  type Post,
  type FriendEdge,
  type Channel,
  type Notification,
  type CommunityInvitation,
  type CommunityInviteCode,
  type FirebasePublicConfig,
  type ApiRequestInit,
} from '@takos/platform';
import {
  getConfiguredBackendOrigin,
  getConfiguredHostHandle,
  isSelfHostedMode,
} from './config';

// Re-export types
export type {
  User,
  Community,
  Post,
  FriendEdge,
  Channel,
  Notification,
  CommunityInvitation,
  CommunityInviteCode,
  FirebasePublicConfig,
  ApiRequestInit,
};
export { ApiError };

// Backend configuration
function normalizeBase(input: string | undefined | null): string {
  if (!input) return "";
  return input.replace(/\/+$/, "");
}

const BACKEND_OVERRIDE_KEY = "takos.backend-origin";
let backendOverride: string | null = null;

const HOST_HANDLE_STORAGE_KEY = "takos.host-handle";

function loadBackendOverride(): void {
  if (typeof window === "undefined") return;
  try {
    const stored = window.localStorage.getItem(BACKEND_OVERRIDE_KEY);
    backendOverride = stored ? normalizeBase(stored) : null;
  } catch {
    backendOverride = null;
  }
}

function getBackendOverride(): string | null {
  if (backendOverride === null && typeof window !== "undefined") {
    loadBackendOverride();
  }
  return backendOverride;
}

export function setBackendOverride(base: string | null): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeBase(base);
  backendOverride = normalized || null;
  try {
    if (backendOverride) {
      window.localStorage.setItem(BACKEND_OVERRIDE_KEY, backendOverride);
    } else {
      window.localStorage.removeItem(BACKEND_OVERRIDE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function getHostHandleFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(HOST_HANDLE_STORAGE_KEY);
    return value ? value : null;
  } catch {
    return null;
  }
}

export function setHostHandle(handle: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (handle) {
      window.localStorage.setItem(HOST_HANDLE_STORAGE_KEY, handle);
    } else {
      window.localStorage.removeItem(HOST_HANDLE_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getHostHandle(): string | null {
  if (isSelfHostedMode()) {
    const configured = getConfiguredHostHandle();
    if (configured) {
      return configured;
    }
  }
  const stored = getHostHandleFromStorage();
  if (stored) {
    return stored;
  }
  const configured = getConfiguredHostHandle();
  if (configured) {
    return configured;
  }
  return null;
}

export function clearHostHandle(): void {
  setHostHandle(null);
}

// JWT localStorage management
const JWT_STORAGE_KEY = "takos_jwt";
const ACCOUNTS_STORAGE_KEY = "takos_accounts";
const ACTIVE_ACCOUNT_INDEX_KEY = "takos_active_account_index";

export interface StoredAccount {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
  jwt: string;
  hostHandle: string;
}

// Multiple accounts management
export function getStoredAccounts(): StoredAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function saveStoredAccounts(accounts: StoredAccount[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  } catch (error) {
    console.error("Failed to save accounts to localStorage:", error);
  }
}

export function getActiveAccountIndex(): number {
  if (typeof window === "undefined") return 0;
  try {
    const stored = window.localStorage.getItem(ACTIVE_ACCOUNT_INDEX_KEY);
    return stored ? parseInt(stored, 10) : 0;
  } catch {
    return 0;
  }
}

export function setActiveAccountIndex(index: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_ACCOUNT_INDEX_KEY, index.toString());
  } catch (error) {
    console.error("Failed to save active account index:", error);
  }
}

export function addOrUpdateAccount(account: StoredAccount): void {
  const accounts = getStoredAccounts();
  const existingIndex = accounts.findIndex(
    (a) => a.userId === account.userId && a.hostHandle === account.hostHandle
  );

  if (existingIndex >= 0) {
    accounts[existingIndex] = account;
  } else {
    accounts.push(account);
  }

  saveStoredAccounts(accounts);

  // Set as active account if it's the only one or was just added
  if (accounts.length === 1 || existingIndex < 0) {
    setActiveAccountIndex(existingIndex < 0 ? accounts.length - 1 : existingIndex);
  }
}

export function switchToAccount(index: number): boolean {
  const accounts = getStoredAccounts();
  if (index < 0 || index >= accounts.length) return false;

  const account = accounts[index];
  setActiveAccountIndex(index);
  setJWT(account.jwt);
  setHostHandle(account.hostHandle);

  return true;
}

export function getCurrentAccount(): StoredAccount | null {
  const accounts = getStoredAccounts();
  const index = getActiveAccountIndex();
  return accounts[index] || null;
}

export function removeAccount(index: number): void {
  const accounts = getStoredAccounts();
  if (index < 0 || index >= accounts.length) return;

  accounts.splice(index, 1);
  saveStoredAccounts(accounts);

  // Adjust active index if needed
  const currentIndex = getActiveAccountIndex();
  if (currentIndex >= accounts.length) {
    setActiveAccountIndex(Math.max(0, accounts.length - 1));
  }

  // Switch to the new active account if any remain
  if (accounts.length > 0) {
    const newIndex = getActiveAccountIndex();
    switchToAccount(newIndex);
  } else {
    clearJWT();
    clearHostHandle();
  }
}

export function getJWT(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(JWT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setJWT(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(JWT_STORAGE_KEY, token);
  } catch (error) {
    console.error("Failed to save JWT to localStorage:", error);
  }
}

export function clearJWT(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(JWT_STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear JWT from localStorage:", error);
  }
}

export function hasJWT(): boolean {
  return !!getJWT();
}

function computeBackendUrl(): string {
  const override = getBackendOverride();
  if (override) {
    return override;
  }
  const configuredFromClient = getConfiguredBackendOrigin();
  if (configuredFromClient) {
    return normalizeBase(configuredFromClient);
  }
  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location;
    if (isSelfHostedMode()) {
      return normalizeBase(`${protocol}//${hostname}`);
    }

    // Localhost development
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return normalizeBase(`${protocol}//${hostname}:8787`);
    }

    // Use current origin for single instance mode
    return normalizeBase(`${protocol}//${hostname}`);
  }
  return "";
}

export function getBackendUrl(): string {
  return computeBackendUrl();
}

export async function exchangeSessionForJWT(backendUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${backendUrl}/auth/session/token`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      return null;
    }
    const data = json?.data ?? json;
    const token = typeof data?.token === "string" ? data.token : null;
    if (token) {
      setJWT(token);
      return token;
    }
  } catch (error) {
    console.warn("failed to exchange session token", error);
  }
  return null;
}

// Helper to parse response
function maybeJson(body: BodyInit | Record<string, unknown> | null | undefined) {
  if (body == null) {
    return undefined;
  }
  if (typeof body === 'string' || body instanceof FormData || body instanceof Blob) {
    return body;
  }
  return JSON.stringify(body);
}

// Base API fetch function
async function apiFetch<T = unknown>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    throw new ApiError("BACKEND_URL not configured", 0, null);
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> || {}),
  };

  // Add JWT to Authorization header if available
  const jwt = getJWT();
  if (jwt) {
    headers["Authorization"] = `Bearer ${jwt}`;
  }

  const body = maybeJson(init.body ?? undefined);

  const res = await fetch(`${backendUrl}${path}`, {
    ...init,
    headers,
    body,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new ApiError(json.error || `HTTP ${res.status}`, res.status, json);
  }
  return (json.data ?? json) as T;
}

// URL resolver
function resolveUrl(path: string): string {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    throw new ApiError("BACKEND_URL not configured", 0, null);
  }
  return `${backendUrl}${path}`;
}

// Create API client instance
export const apiClient = createApiClient({
  apiFetch,
  resolveUrl,
});

// Create Story API instance
export const storyApiClient = createStoryApi({
  apiFetch,
});

// Re-export client methods as individual functions for backward compatibility
export const {
  fetchMe,
  updateMe,
  getUser,
  getCommunity,
  searchUsers,
  listMyCommunities,
  searchCommunities,
  createCommunity,
  updateCommunity,
  listCommunityPosts,
  listGlobalPosts,
  createCommunityPost,
  listCommunityChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  listMyFriends,
  listMyFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  listMyInvitations,
  listCommunityInvites,
  createInviteCode,
  disableInviteCode,
  resetCommunityInvites,
  joinCommunity,
  leaveCommunity,
  createDirectInvites,
  acceptCommunityInvite,
  declineCommunityInvite,
  listNotifications,
  markNotificationRead,
  registerPushDevice,
  removePushDevice,
  listPostPlans,
  getPostPlan,
  createPostPlan,
  updatePostPlan,
  deletePostPlan,
  publishPostPlan,
} = apiClient;

// Custom logout function that clears JWT
export async function logout(): Promise<void> {
  try {
    await apiClient.logout();
  } finally {
    clearJWT();
    clearHostHandle();
  }
}

export const {
  listStories,
  listGlobalStories,
  createStory,
  getStory,
  updateStory,
  deleteStory,
} = storyApiClient;

// Legacy helper that still powers a few UI call sites.
// Keep the warning, but always delegate to the real fetcher so data loads correctly.
export async function api(path: string, init: ApiRequestInit = {}): Promise<any> {
  console.warn(`Direct API call to ${path} is deprecated. Consider using apiClient methods instead.`);
  return apiFetch(path, init);
}

// Add apiClient methods as properties of api for backward compatibility
Object.assign(api, apiClient);

// Media upload (web-specific)
export async function uploadMedia(file: File): Promise<string> {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    throw new ApiError("BACKEND_URL not configured", 0, null);
  }
  const fd = new FormData();
  fd.append("file", file);

  const headers: Record<string, string> = {};
  const jwt = getJWT();
  if (jwt) {
    headers["Authorization"] = `Bearer ${jwt}`;
  }

  const res = await fetch(`${backendUrl}/media/upload`, {
    method: "POST",
    headers,
    body: fd,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  const url = json.data?.url || json.url || "";
  if (typeof url === "string" && url.startsWith("/")) {
    return `${backendUrl}${url}`;
  }
  return url;
}

// Firebase public config
export async function getFirebasePublicConfig(): Promise<FirebasePublicConfig | null> {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    console.warn("BACKEND_URL not configured; cannot load firebase public config");
    return null;
  }
  try {
    const res = await fetch(`${backendUrl}/public/firebase`, { credentials: "include" });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return json.data ?? json ?? null;
  } catch (err) {
    console.warn("failed to fetch firebase public config", err);
    return null;
  }
}

export async function registerWithPassword(input: {
  handle: string;
  password: string;
  display_name?: string;
}) {
  return apiFetch("/auth/password/register", {
    method: "POST",
    body: input,
  });
}

export async function loginWithPassword(input: {
  password: string;
}) {
  return apiFetch("/auth/password/login", {
    method: "POST",
    body: input,
  });
}

// Storage management
export interface StorageFile {
  key: string;
  size: number;
  uploaded: string;
  contentType?: string;
}

export async function getStorage(): Promise<StorageFile[]> {
  const res = await apiFetch<{ data?: { files?: StorageFile[] } }>("/storage", { method: "GET" });
  return res.data?.files || [];
}

export async function uploadStorage(file: File): Promise<string> {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    throw new ApiError("BACKEND_URL not configured", 0, null);
  }
  const fd = new FormData();
  fd.append("file", file);

  const headers: Record<string, string> = {};
  const jwt = getJWT();
  if (jwt) {
    headers["Authorization"] = `Bearer ${jwt}`;
  }

  const res = await fetch(`${backendUrl}/storage/upload`, {
    method: "POST",
    headers,
    body: fd,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  const url = json.data?.url || json.url || "";
  if (typeof url === "string" && url.startsWith("/")) {
    return `${backendUrl}${url}`;
  }
  return url;
}

export async function deleteStorage(key: string): Promise<void> {
  await apiFetch("/storage", {
    method: "DELETE",
    body: { key },
  });
}
