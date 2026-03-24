import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  AppError,
  InternalError,
  isAppError,
  logError,
  RateLimitError,
} from '../lib/errors';

interface ErrorMiddlewareOptions {
  /** Custom error logger */
  logger?: (error: unknown, context?: Record<string, unknown>) => void;
}

function getCorrelationId(c: Context): string {
  return c.req.header('x-request-id') ?? c.req.header('CF-Ray') ?? crypto.randomUUID();
}

/**
 * Resolve the incoming error to an AppError, logging unknown errors.
 */
function resolveAppError(
  err: Error,
  c: Context,
  correlationId: string,
  logger: ErrorMiddlewareOptions['logger'],
): AppError {
  if (isAppError(err)) return err;

  logger?.(err, {
    correlationId,
    path: c.req.path,
    method: c.req.method,
    requestId: c.req.header('x-request-id'),
  });
  return new InternalError('An unexpected error occurred');
}

/**
 * Create Hono error middleware
 */
export function createErrorMiddleware(
  options: ErrorMiddlewareOptions = {}
): (err: Error, c: Context) => Response {
  const { logger = logError } = options;

  return (err: Error, c: Context): Response => {
    const correlationId = getCorrelationId(c);
    const appError = resolveAppError(err, c, correlationId, logger);

    const response = appError.toResponse();
    const errorBody = response.error as Record<string, unknown>;
    errorBody.correlation_id = correlationId;

    if (appError instanceof RateLimitError && appError.retryAfter) {
      c.header('Retry-After', String(appError.retryAfter));
    }

    return c.json(response, appError.statusCode as ContentfulStatusCode);
  };
}

