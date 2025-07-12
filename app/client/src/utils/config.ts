import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

let apiBase = import.meta.env.VITE_API_BASE ||
  localStorage.getItem("takos-api-base") ||
  "";

export function setApiBase(url: string) {
  apiBase = url;
  localStorage.setItem("takos-api-base", url);
}

export function getApiBase(): string {
  return apiBase;
}

export function apiUrl(path: string): string {
  return apiBase ? `${apiBase}${path}` : path;
}

export function isTauri(): boolean {
  if (typeof window === "undefined") return false; // SSR/Node 対策
  return (
    "__TAURI__" in window || // Tauri v1 〜 v2 β
    "__TAURI_INTERNALS__" in window // v2 α〜β 一部で採用
  );
}

export function apiFetch(path: string, init?: RequestInit) {
  // Tauri環境判定
  const is = isTauri();
  console.log("isTauri:" + is);
  if (is) {
    return tauriFetch(apiUrl(path), init);
  }
  return fetch(apiUrl(path), init);
}

export function getOrigin(): string {
  return apiBase ? new URL(apiBase).origin : globalThis.location.origin;
}

export function getDomain(): string {
  return import.meta.env.VITE_ACTIVITYPUB_DOMAIN ||
    new URL(getOrigin()).hostname;
}

// --- 複数サーバー管理 ---

const SERVERS_KEY = "takos-servers";
const ACTIVE_SERVER_KEY = "takos-active-server";

export function getServers(): string[] {
  const raw = localStorage.getItem(SERVERS_KEY);
  try {
    return raw ? JSON.parse(raw) as string[] : [];
  } catch {
    return [];
  }
}

export function addServer(url: string) {
  const list = getServers();
  if (!list.includes(url)) {
    list.push(url);
    localStorage.setItem(SERVERS_KEY, JSON.stringify(list));
  }
}

export function getActiveServer(): string | null {
  return localStorage.getItem(ACTIVE_SERVER_KEY);
}

export function setActiveServer(url: string) {
  localStorage.setItem(ACTIVE_SERVER_KEY, url);
}
