/**
 * Fetch wrapper with consistent configuration
 * All API calls should use this wrapper to ensure:
 * - credentials are included for cookie-based auth (self-hosted)
 * - Bearer token auth is used (hosted mode)
 * - consistent error handling
 */

// ホスティングモード設定
const IS_HOSTED = import.meta.env.VITE_HOSTED_MODE === 'true';
const AUTH_BASE_URL = import.meta.env.VITE_AUTH_URL || '';

/**
 * Get the tenant API base URL
 * Stored in localStorage after authentication
 */
function getTenantUrl(): string | null {
  return localStorage.getItem('tenant_url');
}

/**
 * Set the tenant API base URL
 */
export function setTenantUrl(subdomain: string): void {
  const url = `https://${subdomain}.yurucommu.com`;
  localStorage.setItem('tenant_url', url);
}

/**
 * Clear tenant URL (on logout)
 */
export function clearTenantUrl(): void {
  localStorage.removeItem('tenant_url');
}

/**
 * Clear tenant token (on logout)
 */
export function clearTenantToken(): void {
  localStorage.removeItem('tenant_token');
}

/**
 * Get authentication headers for hosted mode
 * Uses tenant_token for tenant API calls, session_token for central auth calls
 */
function getAuthHeaders(path: string): HeadersInit {
  if (IS_HOSTED) {
    // Auth endpoints use session_token
    if (path.startsWith('/api/auth/')) {
      const token = localStorage.getItem('session_token');
      if (token) {
        return { 'Authorization': `Bearer ${token}` };
      }
    } else {
      // Tenant API endpoints use tenant_token (JWT issued by central)
      const tenantToken = localStorage.getItem('tenant_token');
      if (tenantToken) {
        return { 'Authorization': `Bearer ${tenantToken}` };
      }
    }
  }
  return {};
}

/**
 * Convert API path for the appropriate mode
 * - Self-hosted: /api/... -> /api/...
 * - Hosted auth: /api/auth/... -> {AUTH_BASE_URL}/api/auth/...
 * - Hosted tenant: /api/... -> {TENANT_URL}/api/...
 */
function getApiUrl(path: string): string {
  if (IS_HOSTED) {
    // Auth endpoints go to central service, not tenant
    if (path.startsWith('/api/auth/')) {
      return `${AUTH_BASE_URL}${path}`;
    }

    // Other API endpoints go to tenant
    const tenantUrl = getTenantUrl();
    if (tenantUrl && path.startsWith('/api/')) {
      return `${tenantUrl}${path}`;
    }

    // Fallback: if no tenant URL set, try central
    if (path.startsWith('/api/')) {
      return `${AUTH_BASE_URL}${path}`;
    }

    return path;
  }
  // セルフホストモード: 直接アクセス
  return path;
}

export interface FetchOptions extends RequestInit {
  /** Override default credentials behavior */
  credentials?: RequestCredentials;
}

/**
 * Wrapper around fetch that includes credentials by default
 */
export async function apiFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const apiUrl = getApiUrl(url);
  const headers = new Headers(options.headers);

  // 認証ヘッダーを追加
  const authHeaders = getAuthHeaders(url);
  for (const [key, value] of Object.entries(authHeaders)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  // credentials設定
  const credentials = IS_HOSTED ? 'omit' : (options.credentials ?? 'include');

  return fetch(apiUrl, {
    ...options,
    headers,
    credentials,
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
