/// <reference types="@cloudflare/workers-types" />

import type { Context, MiddlewareHandler } from "hono";
import { HttpError } from "@takos/platform/server";
import type { AuthContext } from "./auth-context-model";
import { ErrorCodes } from "./error-codes";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogPayload = {
  ts: string;
  level: LogLevel;
  event: string;
  requestId?: string;
  path?: string;
  method?: string;
  status?: number;
  duration_ms?: number;
  userId?: string | null;
  sessionId?: string | null;
  details?: Record<string, unknown>;
};

const normalizeRequestId = (existing: string | null | undefined): string =>
  typeof existing === "string" && existing.trim() ? existing.trim() : crypto.randomUUID();

const baseLog = (c: Context | null, level: LogLevel, event: string, extra?: Record<string, unknown>): LogPayload => {
  const auth = c?.get?.("authContext") as AuthContext | undefined;
  const path = c ? new URL(c.req.url).pathname : undefined;
  const method = c?.req?.method;
  return {
    ts: new Date().toISOString(),
    level,
    event,
    requestId: c?.get?.("requestId") as string | undefined,
    path,
    method,
    userId: auth?.userId ?? null,
    sessionId: auth?.sessionId ?? null,
    ...(extra ?? {}),
  };
};

export const logEvent = (c: Context | null, level: LogLevel, event: string, extra?: Record<string, unknown>): void => {
  const payload = baseLog(c, level, event, extra);
  const logger =
    level === "error" ? console.error : level === "warn" ? console.warn : level === "debug" ? console.debug : console.log;
  logger(JSON.stringify(payload));
};

export const requestObservability: MiddlewareHandler = async (c, next) => {
  const requestId = normalizeRequestId(c.req.header("x-request-id"));
  c.set("requestId", requestId);
  const started = performance.now();
  logEvent(c, "info", "request.start", {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
  });

  try {
    await next();
  } finally {
    const durationMs = Number((performance.now() - started).toFixed(2));
    c.res.headers.set("x-request-id", requestId);
    logEvent(c, "info", "request.complete", {
      status: c.res?.status ?? 0,
      duration_ms: durationMs,
    });
  }
};

const isDevEnvironment = (env: unknown): boolean => {
  const raw =
    typeof (env as any)?.ENVIRONMENT === "string"
      ? (env as any).ENVIRONMENT
      : typeof (env as any)?.NODE_ENV === "string"
        ? (env as any).NODE_ENV
        : "";
  return raw.trim().toLowerCase() === "development";
};

type MapErrorOptions = {
  requestId?: string;
  env?: unknown;
};

export const mapErrorToResponse = (error: unknown, requestIdOrOptions?: string | MapErrorOptions): Response => {
  const options: MapErrorOptions =
    typeof requestIdOrOptions === "string"
      ? { requestId: requestIdOrOptions }
      : (requestIdOrOptions ?? {});
  const requestId = options.requestId;
  const isDev = isDevEnvironment(options.env);

  if (error instanceof Response) {
    return error;
  }

  let status = 500;
  let code: string = ErrorCodes.INTERNAL_ERROR;
  let message = "An unexpected error occurred";
  let details: Record<string, unknown> | undefined;

  const normalizeCode = (raw: string): string =>
    raw
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  if (error instanceof HttpError) {
    status = error.status ?? status;
    code = normalizeCode(error.code || code);
    message = error.message || message;
    details = error.details;
  } else {
    if (isDev) {
      message = String(error);
    }
  }

  const logDetails: Record<string, unknown> = {
    status,
    code,
    message,
  };
  if (details) {
    logDetails.details = details;
  }
  if (isDev && error instanceof Error && error.stack) {
    logDetails.stack = error.stack;
  }

  logEvent(null, status >= 500 ? "error" : "warn", "request.error", {
    requestId,
    details: logDetails,
  });

  const body = {
    status,
    code,
    message,
    details: requestId ? { ...(details ?? {}), requestId } : details,
  };

  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  if (requestId) headers.set("x-request-id", requestId);

  if (error instanceof HttpError && error.headers) {
    for (const [key, value] of Object.entries(error.headers)) {
      headers.set(key, value);
    }
  }

  return new Response(JSON.stringify(body), { status, headers });
};
