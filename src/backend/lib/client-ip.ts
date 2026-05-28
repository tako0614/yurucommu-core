import type { Context } from "hono";
import type { Env, Variables } from "../types.ts";

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]+$/;

/**
 * Validate IP address format (basic check).
 */
function isValidIP(ip: string): boolean {
  if (IPV4_PATTERN.test(ip)) {
    return ip.split(".").map(Number).every((part) => part >= 0 && part <= 255);
  }
  return IPV6_PATTERN.test(ip) && ip.includes(":");
}

function isProxyTrusted(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): boolean {
  const flag = c.env.TAKOS_TRUST_PROXY;
  if (typeof flag !== "string") return false;
  return flag.toLowerCase() === "true" || flag === "1";
}

/**
 * Extract client IP with proper validation.
 *
 * Trust model:
 *  - `CF-Connecting-IP` is set by the Cloudflare edge and is always
 *    preferred when present. The edge strips any client-supplied
 *    `CF-Connecting-IP` before invoking the worker, so accepting it is
 *    safe even when no upstream proxy is configured.
 *  - `X-Forwarded-For` / `X-Real-IP` are accepted only when the operator
 *    has opted in via `TAKOS_TRUST_PROXY=true`. A client speaking
 *    directly to the worker can set these headers, so trusting them by
 *    default would let arbitrary callers spoof their source IP and
 *    bypass per-IP rate limiting / abuse detection.
 *  - Falls back to "unknown" when no header is present (or trusted).
 *    Rate limiters bucket "unknown" together which means an attacker
 *    with no IP visibility shares a budget with every other anonymous
 *    caller (intentional: degraded mode, not bypass).
 */
export function getClientIP(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): string {
  const cfConnectingIp = c.req.header("CF-Connecting-IP");
  if (cfConnectingIp && isValidIP(cfConnectingIp)) {
    return cfConnectingIp;
  }

  if (isProxyTrusted(c)) {
    const xff = c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
    if (xff && isValidIP(xff)) return xff;

    const xRealIp = c.req.header("X-Real-IP");
    if (xRealIp && isValidIP(xRealIp)) return xRealIp;
  }

  return "unknown";
}
