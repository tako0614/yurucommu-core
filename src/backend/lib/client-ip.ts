import type { Context } from "hono";
import type { Env, Variables } from "../types.ts";

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]+$/;

/**
 * Validate IP address format (basic check).
 */
function isValidIP(ip: string): boolean {
  if (IPV4_PATTERN.test(ip)) {
    return ip
      .split(".")
      .map(Number)
      .every((part) => part >= 0 && part <= 255);
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
 * True when the request provably transits the genuine Cloudflare edge. The
 * Cloudflare Workers runtime injects `request.cf` (colo / country / etc.) on
 * real edge requests; a client CANNOT forge it, and it is absent on the Bun /
 * node-postgres / Caddy distributions. This lets the canonical Cloudflare
 * deployment trust `CF-Connecting-IP` WITHOUT requiring `TAKOS_TRUST_PROXY` to
 * be set, while non-Cloudflare deployments still reject the spoofable header
 * unless the operator explicitly opts in.
 */
function isCloudflareEdge(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): boolean {
  const raw = c.req.raw as Request & { cf?: unknown };
  return raw.cf != null && typeof raw.cf === "object";
}

/**
 * Extract client IP with proper validation.
 *
 * Trust model:
 *  - `CF-Connecting-IP` is set by the Cloudflare edge, which strips any
 *    client-supplied copy before invoking the worker. That guarantee only
 *    holds when the request actually transits a trusted edge/proxy, so the
 *    header is honoured ONLY when the operator has opted in via
 *    `TAKOS_TRUST_PROXY=true`. On the Bun (`bun src/backend/server.ts`) and
 *    node-postgres/Caddy distributions nothing strips this header, so an
 *    untrusted caller could otherwise rotate a forged `CF-Connecting-IP`
 *    per request to get a fresh rate-limit / login-lockout bucket.
 *  - `X-Forwarded-For` / `X-Real-IP` are likewise accepted only when the
 *    operator has opted in via `TAKOS_TRUST_PROXY=true`. A client speaking
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
  // SECURITY (spoofable trust header / auth bypass): `CF-Connecting-IP` is
  // only authoritative when the request provably transits the Cloudflare
  // edge, which strips a client-supplied copy. Non-Cloudflare deployments
  // (Bun entrypoint, node-postgres/Caddy distribution) do not strip it, so
  // honouring it unconditionally let an attacker forge a fresh source IP per
  // request and defeat login-lockout / per-IP rate limits. Gate it behind the
  // same `TAKOS_TRUST_PROXY` operator opt-in already used for X-Forwarded-For,
  // falling through to "unknown" when the edge/proxy is not trusted.
  const trusted = isProxyTrusted(c);

  // CF-Connecting-IP is authoritative when we are provably on the Cloudflare
  // edge (unspoofable `request.cf`) OR the operator explicitly trusts the proxy.
  // This keeps the canonical Cloudflare deployment working with no extra config
  // while blocking forged headers on direct-to-worker (Bun/self-host) access.
  if (trusted || isCloudflareEdge(c)) {
    const cfConnectingIp = c.req.header("CF-Connecting-IP");
    if (cfConnectingIp && isValidIP(cfConnectingIp)) {
      return cfConnectingIp;
    }
  }

  // X-Forwarded-For / X-Real-IP are generic, client-settable proxy headers
  // (Cloudflare forwards the client's X-Forwarded-For verbatim), so honour them
  // ONLY under an explicit operator opt-in, never merely because we are on CF.
  if (trusted) {
    const xff = c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
    if (xff && isValidIP(xff)) return xff;

    const xRealIp = c.req.header("X-Real-IP");
    if (xRealIp && isValidIP(xRealIp)) return xRealIp;
  }

  return "unknown";
}
