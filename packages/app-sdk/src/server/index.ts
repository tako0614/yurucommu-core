// Server-facing exports for @takos/app-sdk/server

// Export all types
export type {
  // Core types
  TakosApp,
  AppEnv,
  CoreServices,
  Collection,
  CollectionQuery,
  CollectionWhereClause,
  CollectionOrderBy,
  CollectionUpdateData,
  AppStorage,
  ActivityPubAPI,
  AiAPI,
  AuthInfo,
  AppInfo,
  Activity,
  AiCompleteOptions,
  AiEmbedOptions,
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
 * Helper to create an error response.
 */
export function error(message: string, status = 400): Response {
  return json({ error: message }, { status });
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
