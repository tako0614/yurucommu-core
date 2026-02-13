/**
 * Fetch wrapper with consistent configuration.
 * All API calls should use this wrapper so frontend plugins can override
 * transport behavior (URL resolution, auth headers, credentials mode).
 */

import { getApiTransport } from '../plugin';

export function setTenantUrl(subdomain: string): void {
  const normalized = subdomain.startsWith('http://') || subdomain.startsWith('https://')
    ? subdomain.replace(/\/+$/, '')
    : `https://${subdomain}`;
  localStorage.setItem('tenant_url', normalized);
}

export function clearTenantUrl(): void {
  localStorage.removeItem('tenant_url');
}

export function clearTenantToken(): void {
  localStorage.removeItem('tenant_token');
}

export interface FetchOptions extends RequestInit {
  credentials?: RequestCredentials;
}

export async function apiFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const transport = getApiTransport();
  const apiUrl = transport.resolveUrl(url);
  const headers = new Headers(options.headers);

  const authHeaders = transport.getAuthHeaders(url);
  for (const [key, value] of Object.entries(authHeaders)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return fetch(apiUrl, {
    ...options,
    headers,
    credentials: options.credentials ?? transport.credentials,
  });
}

export async function apiPost<T = unknown>(
  url: string,
  body?: unknown,
  options: Omit<FetchOptions, 'method' | 'body'> = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (body) {
    headers.set('Content-Type', 'application/json');
  }

  return apiFetch(url, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
}

export async function apiPut<T = unknown>(
  url: string,
  body?: unknown,
  options: Omit<FetchOptions, 'method' | 'body'> = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (body) {
    headers.set('Content-Type', 'application/json');
  }

  return apiFetch(url, {
    method: 'PUT',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
}

export async function apiPatch<T = unknown>(
  url: string,
  body?: unknown,
  options: Omit<FetchOptions, 'method' | 'body'> = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (body) {
    headers.set('Content-Type', 'application/json');
  }

  return apiFetch(url, {
    method: 'PATCH',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
}

export async function apiDelete(
  url: string,
  body?: unknown,
  options: Omit<FetchOptions, 'method' | 'body'> = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (body) {
    headers.set('Content-Type', 'application/json');
  }

  return apiFetch(url, {
    method: 'DELETE',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    ...options,
  });
}
