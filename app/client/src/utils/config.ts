export const API_BASE = import.meta.env.VITE_API_BASE || "";

export const ORIGIN = API_BASE
  ? new URL(API_BASE).origin
  : globalThis.location.origin;

export const DOMAIN = import.meta.env.VITE_ACTIVITYPUB_DOMAIN ||
  new URL(ORIGIN).hostname;

export function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), init);
}

export function getDomain(): string {
  return DOMAIN;
}

export function getOrigin(): string {
  return ORIGIN;
}
