import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  AppError,
  BadRequestError,
  InternalError,
  isAppError,
  logError,
} from "../lib/errors.ts";

interface ErrorMiddlewareOptions {
  /** Custom error logger */
  logger?: (error: unknown, context?: Record<string, unknown>) => void;
}

function getCorrelationId(c: Context): string {
  return (
    c.req.header("x-request-id") ??
    c.req.header("CF-Ray") ??
    crypto.randomUUID()
  );
}

/**
 * Resolve the incoming error to an AppError, logging unknown errors.
 */
function resolveAppError(
  err: Error,
  c: Context,
  correlationId: string,
  logger: ErrorMiddlewareOptions["logger"],
): AppError {
  if (isAppError(err)) return err;

  // Client-input parse failures that reach the top-level handler are 400s, not
  // 500s, and are not logged as faults (they're expected client behavior):
  //  - SyntaxError: a malformed/empty JSON request body from `c.req.json()`
  //    (internal JSON parsing uses safeJsonParse, which never throws).
  //  - URIError: malformed percent-encoding in a route/query param decoded with
  //    decodeURIComponent (e.g. a bad `:encodedApId`).
  // TypeError/RangeError are deliberately NOT mapped here: they usually signal
  // an internal bug and must be fixed at the call site, not masked as 400.
  if (err instanceof SyntaxError) {
    return new BadRequestError("Invalid or malformed JSON request body");
  }
  if (err instanceof URIError) {
    return new BadRequestError("Malformed URL encoding in request");
  }

  logger?.(err, {
    correlationId,
    path: c.req.path,
    method: c.req.method,
    requestId: c.req.header("x-request-id"),
  });
  return new InternalError("An unexpected error occurred");
}

/**
 * Create Hono error middleware
 */
export function createErrorMiddleware(
  options: ErrorMiddlewareOptions = {},
): (err: Error, c: Context) => Response {
  const { logger = logError } = options;

  return (err: Error, c: Context): Response => {
    const correlationId = getCorrelationId(c);
    const appError = resolveAppError(err, c, correlationId, logger);

    const response = appError.toResponse();
    response.correlation_id = correlationId;

    return c.json(response, appError.statusCode as ContentfulStatusCode);
  };
}
