/**
 * Fetch wrapper with consistent configuration
 * All API calls should use this wrapper to ensure:
 * - credentials are included for cookie-based auth
 * - consistent error handling
 */

export interface FetchOptions extends RequestInit {
  /** Override default credentials behavior */
  credentials?: RequestCredentials;
}

/**
 * Wrapper around fetch that includes credentials by default
 */
export async function apiFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  return fetch(url, {
    ...options,
    credentials: options.credentials ?? 'include',
  });
}

/**
 * JSON POST request helper
 */
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

/**
 * JSON PUT request helper
 */
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

/**
 * JSON PATCH request helper
 */
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

/**
 * DELETE request helper
 */
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
