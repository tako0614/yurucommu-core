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

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), init);
}

export function getOrigin(): string {
  return apiBase ? new URL(apiBase).origin : globalThis.location.origin;
}

export function getDomain(): string {
  return import.meta.env.VITE_ACTIVITYPUB_DOMAIN ||
    new URL(getOrigin()).hostname;
}
