/**
 * Standardized error handling for Yurucommu.
 * All errors extend AppError with code, message, statusCode, and optional details.
 */

export const ErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  BAD_GATEWAY: 'BAD_GATEWAY',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  DEPENDENCY_ERROR: 'DEPENDENCY_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ValidationErrorDetail {
  field: string;
  message: string;
  value?: unknown;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.INTERNAL_ERROR,
    statusCode = 500,
    details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toResponse(): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      stack: this.stack,
    };
  }
}

// --- Concrete error classes ---
// Each binds a fixed error code and HTTP status to AppError.

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(message, ErrorCodes.BAD_REQUEST, 400, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(message, ErrorCodes.UNAUTHORIZED, 401, details);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Access denied', details?: unknown) {
    super(message, ErrorCodes.FORBIDDEN, 403, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', details?: unknown) {
    super(`${resource} not found`, ErrorCodes.NOT_FOUND, 404, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details?: unknown) {
    super(message, ErrorCodes.CONFLICT, 409, details);
  }
}

export class ValidationError extends AppError {
  public readonly fieldErrors: ValidationErrorDetail[];

  constructor(
    message = 'Validation failed',
    fieldErrors: ValidationErrorDetail[] = []
  ) {
    super(
      message,
      ErrorCodes.VALIDATION_ERROR,
      422,
      fieldErrors.length > 0 ? { fields: fieldErrors } : undefined
    );
    this.fieldErrors = fieldErrors;
  }

  static forField(field: string, message: string, value?: unknown): ValidationError {
    return new ValidationError('Validation failed', [{ field, message, value }]);
  }

  static forFields(fields: ValidationErrorDetail[]): ValidationError {
    return new ValidationError('Validation failed', fields);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(message = 'Rate limit exceeded', retryAfter?: number) {
    super(message, ErrorCodes.RATE_LIMITED, 429);
    this.retryAfter = retryAfter;
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error', details?: unknown) {
    super(message, ErrorCodes.INTERNAL_ERROR, 500, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details?: unknown) {
    super(message, ErrorCodes.SERVICE_UNAVAILABLE, 503, details);
  }
}

// --- Utility functions ---

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function normalizeError(error: unknown): AppError {
  if (isAppError(error)) return error;
  console.error('[normalizeError] Converting to AppError:', error);
  return new InternalError('An unexpected error occurred');
}

export function logError(error: unknown, context?: Record<string, unknown>): void {
  const errorInfo = isAppError(error)
    ? error.toJSON()
    : {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };

  console.error('[Error]', {
    ...errorInfo,
    context,
    timestamp: new Date().toISOString(),
  });
}

const DB_CONSTRAINT_MAP: Array<{ pattern: string; toError: (entity: string) => AppError }> = [
  { pattern: 'UNIQUE constraint', toError: (e) => new ConflictError(`${e} already exists`) },
  { pattern: 'FOREIGN KEY constraint', toError: (e) => new BadRequestError(`Referenced ${e.toLowerCase()} does not exist`) },
  { pattern: 'NOT NULL constraint', toError: () => new ValidationError('Required field is missing') },
];

export function handleDatabaseError(error: unknown, entityName = 'Record'): AppError {
  const errorString = String(error);

  for (const { pattern, toError } of DB_CONSTRAINT_MAP) {
    if (errorString.includes(pattern)) return toError(entityName);
  }

  console.error(`[handleDatabaseError] Database error for ${entityName}:`, error);
  return new InternalError('Database operation failed');
}
