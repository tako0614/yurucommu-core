import type { Context, MiddlewareHandler, Next } from "hono";

import type { Env, Variables } from "../types.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ component: "middleware.body_limit" });

/**
 * DoS body-size guard.
 *
 * Reads `Content-Length` before any handler runs and rejects the request with
 * a `413 body_too_large` envelope when the declared body exceeds the
 * configured cap. The check is conservative on purpose:
 *
 * - HEAD / GET / OPTIONS / DELETE without a body are skipped.
 * - The cap is bytes. `1 MiB = 1024 * 1024`.
 *
 * Missing `Content-Length` is allowed by default because the Fetch `Request`
 * constructor does not auto-populate the header for string bodies in tests,
 * and many real callers omit it for chunked encoded uploads. A declared
 * `Content-Length` is NOT trusted as the only line of defense: when the
 * header is absent (chunked transfer-encoding), the request body is wrapped
 * in a streaming counter that aborts once the byte count exceeds the cap, so
 * an attacker cannot bypass the limit by simply omitting `Content-Length`.
 * Set `requireContentLength: true` on routes that must refuse chunked-only
 * requests outright with 411 instead (= the strict mode rejects the request
 * before the body is even read).
 *
 * Per-route caps stack on top of the global default cap — the middleware is
 * normally registered globally first, with stricter caps mounted on specific
 * route paths afterward. The first registered middleware wins because Hono
 * runs middleware in registration order; a per-route override should
 * therefore be mounted BEFORE the global gate when it needs to LIFT the
 * cap (e.g. media uploads). When it merely TIGHTENS the cap, mounting it
 * after the global gate also works because the global gate already let the
 * smaller body through.
 */

const BODY_BEARING_METHODS = new Set(["POST", "PUT", "PATCH"]);

export interface BodyLimitOptions {
  /** Maximum body size in bytes. */
  maxBytes: number;
  /**
   * When true, requests without a `Content-Length` header are rejected with
   * 411 on body-bearing methods. Defaults to false — the middleware then
   * only validates the header value when present and lets chunked-only
   * traffic through to the next layer (which can still enforce a stream
   * cap).
   */
  requireContentLength?: boolean;
}

export const DEFAULT_BODY_LIMIT_BYTES = 1 * 1024 * 1024; // 1 MiB

function parseContentLength(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  // RFC 7230 forbids non-digit characters; treat anything else as missing
  // rather than zero (zero would silently pass the cap).
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export type BodyLimitDecision =
  | { ok: true }
  | {
      ok: false;
      reason: "body_too_large" | "body_length_required";
      limit: number;
      declared: number | null;
    };

/**
 * Pure decision function. Exposed for unit tests; the middleware below is a
 * thin Hono wrapper.
 */
export function evaluateBodyLimit(
  request: Request,
  options: BodyLimitOptions,
): BodyLimitDecision {
  const method = request.method.toUpperCase();
  if (!BODY_BEARING_METHODS.has(method)) return { ok: true };

  const declared = parseContentLength(request.headers.get("content-length"));
  if (declared === null) {
    if (!options.requireContentLength) return { ok: true };
    return {
      ok: false,
      reason: "body_length_required",
      limit: options.maxBytes,
      declared: null,
    };
  }
  if (declared > options.maxBytes) {
    return {
      ok: false,
      reason: "body_too_large",
      limit: options.maxBytes,
      declared,
    };
  }
  return { ok: true };
}

/** Sentinel error thrown by the stream counter when the cap is exceeded. */
export class BodyTooLargeError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`Request body exceeds the ${limit} byte cap`);
    this.name = "BodyTooLargeError";
    this.limit = limit;
  }
}

/**
 * Wrap a request body stream so that it errors (cancelling the source) once
 * more than `maxBytes` have flowed through. This closes the chunked-transfer
 * bypass: a request without a trusted `Content-Length` is still capped while
 * its body is consumed downstream, instead of relying on the (omittable)
 * header alone.
 */
export function capRequestBodyStream(
  request: Request,
  maxBytes: number,
): Request {
  const body = request.body;
  if (!body) return request;

  let seen = 0;
  const capped = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          controller.error(new BodyTooLargeError(maxBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  // `duplex: "half"` is required when constructing a Request with a stream
  // body. The cloned Request keeps method / headers / url so downstream
  // handlers and signature verification see an unchanged request shape.
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: capped,
    redirect: request.redirect,
    signal: request.signal,
    // @ts-expect-error duplex is a valid RequestInit field at runtime but is
    // not yet in the lib.dom typings shipped with this TypeScript target.
    duplex: "half",
  });
}

export function bodyLimit(
  options: BodyLimitOptions,
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next,
  ) => {
    const decision = evaluateBodyLimit(c.req.raw, options);
    if (decision.ok) {
      // The header check above only guards declared `Content-Length`. For
      // body-bearing requests that omit it (chunked transfer-encoding), wrap
      // the stream so the cap is still enforced as the body is consumed.
      const method = c.req.method.toUpperCase();
      if (
        BODY_BEARING_METHODS.has(method) &&
        c.req.raw.headers.get("content-length") === null &&
        c.req.raw.body !== null
      ) {
        const capped = capRequestBodyStream(c.req.raw, options.maxBytes);
        if (capped !== c.req.raw) {
          // Replace the underlying Request so downstream `c.req.*` readers
          // consume the length-capped stream.
          c.req.raw = capped;
        }
      }
      return await next();
    }

    log.warn("body limit exceeded", {
      event: "body_limit.rejected",
      reason: decision.reason,
      limit: decision.limit,
      declared: decision.declared,
      path: new URL(c.req.url).pathname,
      method: c.req.method,
    });

    const status = decision.reason === "body_length_required" ? 411 : 413;
    return c.json(
      {
        error: decision.reason,
        message:
          decision.reason === "body_too_large"
            ? `Request body exceeds the ${decision.limit} byte cap`
            : "Content-Length header is required",
        limit: decision.limit,
      },
      status,
    );
  };
}
