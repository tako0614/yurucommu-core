// Unified response helpers

import type { Context } from "hono";

export type ErrorResponse = {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

const defaultErrorCode = (status: number): string => {
  switch (status) {
    case 401:
      return "UNAUTHORIZED";
    case 402:
      return "PLAN_REQUIRED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 408:
      return "SANDBOX_TIMEOUT";
    case 409:
      return "ALREADY_EXISTS";
    case 413:
      return "FILE_TOO_LARGE";
    case 429:
      return "RATE_LIMIT_EXCEEDED";
    case 502:
      return "AI_PROVIDER_ERROR";
    case 503:
      return "SERVICE_UNAVAILABLE";
    case 507:
      return "STORAGE_LIMIT_EXCEEDED";
    case 500:
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "INVALID_INPUT";
  }
};

export const ok = <T = any>(c: Context, data: T, status: number = 200) =>
  c.json({ ok: true, data }, status as any);

export const fail = (
  c: Context,
  message: string,
  status: number = 400,
  options: { code?: string; details?: Record<string, unknown>; headers?: Record<string, string> } = {},
) => {
  const code = (options.code || defaultErrorCode(status)).toUpperCase();
  const body: ErrorResponse = {
    status,
    code,
    message,
    details: options.details,
  };
  return c.json(body, status as any, options.headers);
};

export class HttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    headers?: Record<string, string>,
  );
  constructor(
    status: number,
    message: string,
    details?: Record<string, unknown>,
    headers?: Record<string, string>,
  );
  constructor(
    status: number,
    codeOrMessage: string,
    messageOrDetails?: string | Record<string, unknown>,
    detailsOrHeaders?: Record<string, unknown> | Record<string, string>,
    maybeHeaders?: Record<string, string>,
  ) {
    const hasExplicitMessage = typeof messageOrDetails === "string";
    const message = hasExplicitMessage ? messageOrDetails : codeOrMessage;
    const details = (hasExplicitMessage ? detailsOrHeaders : messageOrDetails) as
      | Record<string, unknown>
      | undefined;
    const headers = (hasExplicitMessage ? maybeHeaders : detailsOrHeaders) as Record<string, string> | undefined;

    super(message ?? codeOrMessage);
    this.name = "HttpError";
    this.status = status;
    this.code = hasExplicitMessage ? codeOrMessage : defaultErrorCode(status);
    this.details = details;
    this.headers = headers;
  }

  toResponse(options: { requestId?: string } = {}): Response {
    const body: ErrorResponse = {
      status: this.status,
      code: (this.code || defaultErrorCode(this.status)).toUpperCase(),
      message: this.message,
      details: this.details,
    };

    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    if (options.requestId) {
      body.details = { ...(body.details ?? {}), requestId: options.requestId };
      headers.set("x-request-id", options.requestId);
    }

    if (this.headers) {
      for (const [key, value] of Object.entries(this.headers)) {
        headers.set(key, value);
      }
    }

    return new Response(JSON.stringify(body), {
      status: this.status,
      headers,
    });
  }
}

// Helper functions
export const nowISO = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export const addHours = (date: Date, h: number) =>
  new Date(date.getTime() + h * 3600 * 1000);
