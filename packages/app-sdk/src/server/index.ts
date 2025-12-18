// Server-facing exports for @takos/app-sdk/server

// Export all types
export type {
  // Core types
  TakosApp,
  AppEnv,
  CoreServices,
  AppStorage,
  OpenAICompatibleClient,
  ObjectService,
  ActorService,
  NotificationService,
  TakosObject,
  TakosActor,
  TakosNotification,
  AuthInfo,
  AppInfo,
  InstanceInfo,
  // Manifest types
  AppManifest,
  AppEntry,
} from "../types/index.js";

/**
 * Helper to create a JSON response.
 */
export function json<T>(data: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

/**
 * Standard error response format.
 */
export interface ErrorResponse {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Helper to create an error response.
 *
 * Returns a standardized error response with the format:
 * `{ status, code, message, details? }`
 *
 * @param message - Human-readable error message
 * @param status - HTTP status code (default: 400)
 * @param code - Error code identifier (default: derived from status)
 * @param details - Additional error details (optional)
 *
 * @example
 * // Simple error
 * return error("Invalid input", 400);
 *
 * // With error code
 * return error("User not found", 404, "USER_NOT_FOUND");
 *
 * // With details
 * return error("Validation failed", 400, "VALIDATION_ERROR", { field: "email" });
 */
export function error(
  message: string,
  status = 400,
  code?: string,
  details?: Record<string, unknown>,
): Response {
  const errorCode = code ?? getDefaultErrorCode(status);
  const body: ErrorResponse = {
    status,
    code: errorCode,
    message,
  };
  if (details) {
    body.details = details;
  }
  return json(body, { status });
}

/**
 * Get default error code from HTTP status.
 */
function getDefaultErrorCode(status: number): string {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "ALREADY_EXISTS";
    case 429:
      return "RATE_LIMIT_EXCEEDED";
    case 500:
      return "INTERNAL_ERROR";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return "ERROR";
  }
}

/**
 * Helper to parse JSON body from request.
 */
export async function parseBody<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

/**
 * Helper to parse query parameters from URL.
 */
export function parseQuery(request: Request): Record<string, string> {
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/**
 * Helper to extract path parameters from pattern matching.
 * @example
 * const params = matchPath("/users/:id", "/users/123");
 * // { id: "123" }
 */
export function matchPath(
  pattern: string,
  path: string
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];

    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return null;
    }
  }

  return params;
}
