/**
 * Fetch wrapper with consistent configuration.
 * All API calls should use this wrapper so frontend plugins can override
 * transport behavior (URL resolution, auth headers, credentials mode).
 */

import { getApiTransport } from '../plugin';

export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
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

function createApiMethod(method: string) {
  return async (
    url: string,
    body?: unknown,
    options: Omit<RequestInit, 'method' | 'body'> = {}
  ): Promise<Response> => {
    const headers = new Headers(options.headers);
    if (body) {
      headers.set('Content-Type', 'application/json');
    }

    return apiFetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...options,
    });
  };
}

export const apiPost = createApiMethod('POST');
export const apiPut = createApiMethod('PUT');
export const apiPatch = createApiMethod('PATCH');
export const apiDelete = createApiMethod('DELETE');
