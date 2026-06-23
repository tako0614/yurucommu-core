/**
 * Fetch wrapper with consistent configuration.
 * All API calls should use this wrapper so frontend plugins can override
 * transport behavior (URL resolution, auth headers, credentials mode).
 */

import { getApiTransport } from "../plugin.ts";
import {
  fetchWithTimeout,
  type FetchWithTimeoutInit,
} from "../fetch-with-timeout.ts";

/**
 * Custom error class for API responses that includes the HTTP status code.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    // `message` is the human-facing server error (or a caller fallback); the
    // HTTP status lives on `.status`. Keep `.message` clean — many UI surfaces
    // render `err.message` verbatim in an error box, and a "<status>: " prefix
    // reads as technical noise (e.g. "422: Add this account as an alias…").
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Read an error message from a failed API response. Attempts to parse JSON
 * with an `error` field; falls back to `statusText`.
 */
export async function extractErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const data = (await res.json()) as {
      error?: string | { message?: string };
    };
    // The server uses a flat `{ error: "message" }` envelope. Defensively also
    // unwrap a nested `{ error: { message } }` so a stray non-flat error never
    // renders as the "[object Object]" stringification.
    const err = data.error;
    const message = typeof err === "string" ? err : err?.message;
    return message || fallback;
  } catch {
    return res.statusText || fallback;
  }
}

/**
 * Assert that a response is OK. Throws an `ApiError` with the status code
 * and a message extracted from the response body when it is not.
 */
export async function assertOk(res: Response, fallback: string): Promise<void> {
  if (!res.ok) {
    const message = await extractErrorMessage(res, fallback);
    throw new ApiError(res.status, message);
  }
}

export interface ApiRequestInit extends FetchWithTimeoutInit {}

export function apiFetch(
  url: string,
  options: ApiRequestInit = {},
): Promise<Response> {
  const transport = getApiTransport();
  const apiUrl = transport.resolveUrl(url);
  const headers = new Headers(options.headers);

  const authHeaders = transport.getAuthHeaders(url);
  for (const [key, value] of Object.entries(authHeaders)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return fetchWithTimeout(apiUrl, {
    ...options,
    headers,
    credentials: options.credentials ?? transport.credentials,
  });
}

function createApiMethod(method: string) {
  return async (
    url: string,
    body?: unknown,
    options: Omit<ApiRequestInit, "method" | "body"> = {},
  ): Promise<Response> => {
    const headers = new Headers(options.headers);
    if (body) {
      headers.set("Content-Type", "application/json");
    }

    return await apiFetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...options,
    });
  };
}

export const apiPost = createApiMethod("POST");
export const apiPut = createApiMethod("PUT");
export const apiPatch = createApiMethod("PATCH");
export const apiDelete = createApiMethod("DELETE");
