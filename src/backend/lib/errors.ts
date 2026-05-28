/**
 * Standardized error handling for Yurucommu.
 * All errors extend AppError with code, message, statusCode, and optional details.
 */

import { logger } from "./logger.ts";
import { maskSensitiveData, maskSensitiveString } from "./log-mask.ts";

const log = logger.child({ component: "errors" });

const ErrorCodes = {
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.INTERNAL_ERROR,
    statusCode = 500,
    details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
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
}

// --- Concrete error classes ---
// Each binds a fixed error code and HTTP status to AppError.
// Only classes with actual consumers are kept.

export class NotFoundError extends AppError {
  constructor(resource = "Resource", details?: unknown) {
    super(`${resource} not found`, ErrorCodes.NOT_FOUND, 404, details);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(message = "Rate limit exceeded", retryAfter?: number) {
    super(message, ErrorCodes.RATE_LIMITED, 429);
    this.retryAfter = retryAfter;
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal server error", details?: unknown) {
    super(message, ErrorCodes.INTERNAL_ERROR, 500, details);
  }
}

// --- Utility functions ---

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function logError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  // Pass message / stack / details through the PII masker before
  // emitting. The logger applies the same masker again as a safety net,
  // but masking here keeps the structured `details` shape (which may be
  // a nested object) honest even if logger transports change.
  const errorInfo = isAppError(error)
    ? {
      name: error.name,
      code: error.code,
      message: maskSensitiveString(error.message),
      statusCode: error.statusCode,
      details: maskSensitiveData(error.details),
      stack: error.stack ? maskSensitiveString(error.stack) : undefined,
    }
    : {
      message: error instanceof Error
        ? maskSensitiveString(error.message)
        : maskSensitiveString(String(error)),
      stack: error instanceof Error && error.stack
        ? maskSensitiveString(error.stack)
        : undefined,
    };

  log.error("AppError", {
    event: "app.error",
    ...errorInfo,
    context: context ? maskSensitiveData(context) : undefined,
  });
}
