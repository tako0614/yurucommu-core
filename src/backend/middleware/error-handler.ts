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

export interface ErrorMiddlewareOptions {
  /** Include stack traces in responses (only for development) */
  includeStack?: boolean;
  /** Custom error logger */
  logger?: (error: unknown, context?: Record<string, unknown>) => void;
  /** Custom error transformer */
  transformError?: (error: unknown) => AppError;
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
  transformError: ErrorMiddlewareOptions['transformError']
): AppError {
  if (transformError) return transformError(err);
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
  const { includeStack = false, logger = logError, transformError } = options;

  return (err: Error, c: Context): Response => {
    const correlationId = getCorrelationId(c);
    const appError = resolveAppError(err, c, correlationId, logger, transformError);

    const response = appError.toResponse();
    const errorBody = response.error as Record<string, unknown>;
    errorBody.correlation_id = correlationId;

    if (includeStack && appError.stack) {
      errorBody.stack = appError.stack;
    }

    if (appError instanceof RateLimitError && appError.retryAfter) {
      c.header('Retry-After', String(appError.retryAfter));
    }

    return c.json(response, appError.statusCode as ContentfulStatusCode);
  };
}

export function notFoundHandler(c: Context): Response {
  const error = new NotFoundError('Route');
  return c.json(error.toResponse(), 404);
}

// --- Route handler helpers ---

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

export function badRequest(
  c: Context,
  message: string,
  details?: unknown
): Response {
  return errorResponse(c, 400, message, ErrorCodes.BAD_REQUEST, details);
}

export function unauthorized(
  c: Context,
  message = 'Authentication required'
): Response {
  return errorResponse(c, 401, message, ErrorCodes.UNAUTHORIZED);
}

export function forbidden(c: Context, message = 'Access denied'): Response {
  return errorResponse(c, 403, message, ErrorCodes.FORBIDDEN);
}

export function notFound(c: Context, resource = 'Resource'): Response {
  return errorResponse(c, 404, `${resource} not found`, ErrorCodes.NOT_FOUND);
}

export function conflict(
  c: Context,
  message: string,
  details?: unknown
): Response {
  return errorResponse(c, 409, message, ErrorCodes.CONFLICT, details);
}

export function validationError(
  c: Context,
  message: string,
  details?: unknown
): Response {
  return errorResponse(c, 422, message, ErrorCodes.VALIDATION_ERROR, details);
}

export function validationErrorWithFields(
  c: Context,
  message: string,
  fields: ValidationErrorDetail[]
): Response {
  return errorResponse(c, 422, message, ErrorCodes.VALIDATION_ERROR, { fields });
}

export function internalError(
  c: Context,
  message = 'Internal server error'
): Response {
  return errorResponse(c, 500, message, ErrorCodes.INTERNAL_ERROR);
}

export function serviceUnavailable(
  c: Context,
  message = 'Service temporarily unavailable'
): Response {
  return errorResponse(c, 503, message, ErrorCodes.SERVICE_UNAVAILABLE);
}

export function rateLimited(c: Context, retryAfter?: number): Response {
  if (retryAfter) {
    c.header('Retry-After', String(retryAfter));
  }
  return errorResponse(c, 429, 'Rate limit exceeded', ErrorCodes.RATE_LIMITED);
}

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

// --- Throw helpers for async route handlers (caught by error middleware) ---

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
