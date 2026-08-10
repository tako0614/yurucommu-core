/**
 * Fetch wrapper with consistent configuration.
 * All API calls should use this wrapper so frontend plugins can override
 * transport behavior (URL resolution, auth headers, credentials mode).
 */

import {
  fetchWithTimeout,
  type FetchWithTimeoutInit,
} from "../fetch-with-timeout.ts";
import { getYurucommuApiTransport } from "../transport.ts";

/**
 * Custom error class for API responses that includes the HTTP status code.
 */
export class ApiError extends Error {
  public readonly code: string | null;
  public readonly retryAfterSeconds: number | null;

  constructor(
    public readonly status: number,
    message: string,
    details: {
      readonly code?: string | null;
      readonly retryAfterSeconds?: number | null;
    } = {},
  ) {
    // `message` is the human-facing server error (or a caller fallback); the
    // HTTP status lives on `.status`. Keep `.message` clean — many UI surfaces
    // render `err.message` verbatim in an error box, and a "<status>: " prefix
    // reads as technical noise (e.g. "422: Add this account as an alias…").
    super(message);
    this.name = "ApiError";
    this.code = details.code ?? null;
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
  }
}

interface ApiErrorDetails {
  readonly message: string;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;
}

function parseRetryAfterSeconds(
  bodyValue: unknown,
  headerValue: string | null,
): number | null {
  const bodySeconds =
    typeof bodyValue === "number" && Number.isFinite(bodyValue) && bodyValue > 0
      ? Math.ceil(bodyValue)
      : null;
  if (bodySeconds !== null) return bodySeconds;
  if (!headerValue) return null;
  const numeric = Number(headerValue);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);
  const dateMs = Date.parse(headerValue);
  if (!Number.isFinite(dateMs) || dateMs <= Date.now()) return null;
  return Math.ceil((dateMs - Date.now()) / 1000);
}

async function extractApiErrorDetails(
  res: Response,
  fallback: string,
): Promise<ApiErrorDetails> {
  try {
    const data = (await res.json()) as {
      error?: string | { message?: string };
      code?: unknown;
      retry_after?: unknown;
    };
    const err = data.error;
    const message = typeof err === "string" ? err : err?.message;
    const code =
      typeof data.code === "string" && data.code.trim().length > 0
        ? data.code.trim().slice(0, 100)
        : null;
    return {
      message: message || fallback,
      code,
      retryAfterSeconds: parseRetryAfterSeconds(
        data.retry_after,
        res.headers.get("retry-after"),
      ),
    };
  } catch {
    return {
      message: res.statusText || fallback,
      code: null,
      retryAfterSeconds: parseRetryAfterSeconds(
        null,
        res.headers.get("retry-after"),
      ),
    };
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
  return (await extractApiErrorDetails(res, fallback)).message;
}

/**
 * Assert that a response is OK. Throws an `ApiError` with the status code
 * and a message extracted from the response body when it is not.
 */
export async function assertOk(res: Response, fallback: string): Promise<void> {
  if (!res.ok) {
    const details = await extractApiErrorDetails(res, fallback);
    throw new ApiError(res.status, details.message, details);
  }
}

export interface ApiRequestInit extends FetchWithTimeoutInit {}

export function apiFetch(
  url: string,
  options: ApiRequestInit = {},
): Promise<Response> {
  const transport = getYurucommuApiTransport();
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
