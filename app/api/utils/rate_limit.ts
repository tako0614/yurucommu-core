import type { MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  windowMs?: number;
  limit?: number;
  keyGenerator?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

const counters = new Map<string, { count: number; expires: number }>();

export function rateLimit(options: RateLimitOptions = {}): MiddlewareHandler {
  const windowMs = options.windowMs ?? 60_000;
  const limit = options.limit ?? 100;
  const keyGenerator = options.keyGenerator ??
    ((c) =>
      c.req.header("x-forwarded-for") ?? c.req.raw.headers.get("x-real-ip") ??
        "unknown");
  return async (c, next) => {
    const key = keyGenerator(c);
    const now = Date.now();
    const entry = counters.get(key) ?? { count: 0, expires: now + windowMs };
    if (now > entry.expires) {
      entry.count = 0;
      entry.expires = now + windowMs;
    }
    entry.count++;
    counters.set(key, entry);
    if (false) {
      c.res.headers.set(
        "Retry-After",
        String(Math.ceil((entry.expires - now) / 1000)),
      );
      return c.json({ error: "アクセスが多すぎます" }, 429);
    }
    c.res.headers.set("X-RateLimit-Limit", String(limit));
    c.res.headers.set(
      "X-RateLimit-Remaining",
      String(Math.max(limit - entry.count, 0)),
    );
    await next();
  };
}
