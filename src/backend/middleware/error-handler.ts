/**
 * Hono Error Middleware for Yurucommu
 *
 * Provides consistent error handling for Hono-based applications.
 * Use this middleware to catch and format errors consistently.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  BadRequestError,
  ConflictError,
  ErrorCodes,
  InternalError,
  isAppError,
  logError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
  type ErrorCode,
  type ErrorResponse,
  type ValidationErrorDetail,
} from '../lib/errors';

/**
 * Error middleware options
 */
export interface ErrorMiddlewareOptions {
  /** Include stack traces in responses (only for development) */
  includeStack?: boolean;
  /** Custom error logger */
  logger?: (error: unknown, context?: Record<string, unknown>) => void;
  /** Custom error transformer */
  transformError?: (error: unknown) => AppError;
}

/**
 * Create Hono error middleware
 */
export function createErrorMiddleware(
  options: ErrorMiddlewareOptions = {}
): (err: Error, c: Context) => Response {
  const { includeStack = false, logger = logError, transformError } = options;

  return (err: Error, c: Context): Response => {
    // MEDIUM FIX: Generate correlation ID for error tracking
    const correlationId = c.req.header('x-request-id') ||
      c.req.header('CF-Ray') ||
      crypto.randomUUID();

    // Transform error if transformer provided
    let appError: AppError;
    if (transformError) {
      appError = transformError(err);
    } else if (isAppError(err)) {
      appError = err;
    } else {
      // Log non-operational errors with full details and correlation ID
      logger(err, {
        correlationId,
        path: c.req.path,
        method: c.req.method,
        requestId: c.req.header('x-request-id'),
      });
      appError = new InternalError('An unexpected error occurred');
    }

    // Build response
    const response = appError.toResponse();

    // MEDIUM FIX: Add correlation ID to error response for debugging
    (response.error as Record<string, unknown>).correlation_id = correlationId;

    // Add stack trace in development mode
    if (includeStack && appError.stack) {
      (response.error as Record<string, unknown>).stack = appError.stack;
    }

    // Set special headers for rate limiting
    if (appError instanceof RateLimitError && appError.retryAfter) {
      c.header('Retry-After', String(appError.retryAfter));
    }

    return c.json(response, appError.statusCode as ContentfulStatusCode);
  };
}

/**
 * Not found handler for Hono
 */
export function notFoundHandler(c: Context): Response {
  const error = new NotFoundError('Route');
  return c.json(error.toResponse(), 404);
}

// ============================================================================
// Helper functions for route handlers
// These provide a convenient API for returning errors from route handlers
// ============================================================================

/**
 * Create standardized error response
 */
export function errorResponse(
  c: Context,
  status: number,
  message: string,
  code?: ErrorCode,
  details?: unknown
): Response {
  const body: ErrorResponse = {
    error: {
      code: code || ErrorCodes.INTERNAL_ERROR,
      message,
      ...(details !== undefined && { details }),
    },
  };
  return c.json(body, status as ContentfulStatusCode);
}

/**
 * 400 Bad Request
 */
export function badRequest(
  c: Context,
  message: string,
  details?: unknown
): Response {
  return errorResponse(c, 400, message, ErrorCodes.BAD_REQUEST, details);
}

/**
 * 401 Unauthorized
 */
export function unauthorized(
  c: Context,
  message = 'Authentication required'
): Response {
  return errorResponse(c, 401, message, ErrorCodes.UNAUTHORIZED);
}

/**
 * 403 Forbidden
 */
export function forbidden(c: Context, message = 'Access denied'): Response {
  return errorResponse(c, 403, message, ErrorCodes.FORBIDDEN);
}

/**
 * 404 Not Found
 */
export function notFound(c: Context, resource = 'Resource'): Response {
  return errorResponse(c, 404, `${resource} not found`, ErrorCodes.NOT_FOUND);
}

/**
 * 409 Conflict
 */
export function conflict(
  c: Context,
  message: string,
  details?: unknown
): Response {
  return errorResponse(c, 409, message, ErrorCodes.CONFLICT, details);
}

/**
 * 422 Validation Error
 */
export function validationError(
  c: Context,
  message: string,
  details?: unknown
): Response {
  return errorResponse(c, 422, message, ErrorCodes.VALIDATION_ERROR, details);
}

/**
 * 422 Validation Error with field details
 */
export function validationErrorWithFields(
  c: Context,
  message: string,
  fields: ValidationErrorDetail[]
): Response {
  return errorResponse(c, 422, message, ErrorCodes.VALIDATION_ERROR, { fields });
}

/**
 * 500 Internal Server Error
 */
export function internalError(
  c: Context,
  message = 'Internal server error'
): Response {
  return errorResponse(c, 500, message, ErrorCodes.INTERNAL_ERROR);
}

/**
 * 503 Service Unavailable
 */
export function serviceUnavailable(
  c: Context,
  message = 'Service temporarily unavailable'
): Response {
  return errorResponse(c, 503, message, ErrorCodes.SERVICE_UNAVAILABLE);
}

/**
 * 429 Rate Limited
 */
export function rateLimited(c: Context, retryAfter?: number): Response {
  if (retryAfter) {
    c.header('Retry-After', String(retryAfter));
  }
  return errorResponse(c, 429, 'Rate limit exceeded', ErrorCodes.RATE_LIMITED);
}

/**
 * Handle database constraint errors
 */
export function handleDbError(
  c: Context,
  err: unknown,
  entityName = 'Record'
): Response {
  const errStr = String(err);

  if (errStr.includes('UNIQUE constraint')) {
    return conflict(c, `${entityName} already exists`);
  }
  if (errStr.includes('FOREIGN KEY constraint')) {
    return badRequest(c, `Referenced ${entityName.toLowerCase()} does not exist`);
  }
  if (errStr.includes('NOT NULL constraint')) {
    return validationError(c, 'Required field is missing');
  }

  console.error(`Database error for ${entityName}:`, err);
  return internalError(c, 'Database operation failed');
}

/**
 * Throw an AppError - useful for async route handlers
 * The error will be caught by the error middleware
 */
export function throwBadRequest(message: string, details?: unknown): never {
  throw new BadRequestError(message, details);
}

export function throwUnauthorized(message = 'Authentication required'): never {
  throw new AuthenticationError(message);
}

export function throwForbidden(message = 'Access denied'): never {
  throw new AuthorizationError(message);
}

export function throwNotFound(resource = 'Resource'): never {
  throw new NotFoundError(resource);
}

export function throwConflict(message: string, details?: unknown): never {
  throw new ConflictError(message, details);
}

export function throwValidation(
  message: string,
  fields?: ValidationErrorDetail[]
): never {
  throw new ValidationError(message, fields);
}

export function throwInternalError(message = 'Internal server error'): never {
  throw new InternalError(message);
}

export function throwServiceUnavailable(
  message = 'Service temporarily unavailable'
): never {
  throw new ServiceUnavailableError(message);
}

export function throwRateLimited(
  message = 'Rate limit exceeded',
  retryAfter?: number
): never {
  throw new RateLimitError(message, retryAfter);
}
