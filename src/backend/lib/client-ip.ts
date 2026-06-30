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

// How much an operator-declared reverse proxy is trusted for forwarding headers:
//  - "none":    no opt-in; only the genuine CF edge (request.cf) is trusted.
//  - "cf":      a Cloudflare front (edge OR cloudflared tunnel where request.cf
//               is absent at the origin) — CF-Connecting-IP is authoritative.
//  - "generic": a generic reverse proxy (nginx / Caddy / Traefik) that stamps
//               X-Forwarded-For / X-Real-IP but neither sets nor strips the
//               Cloudflare-specific header — trust XFF/X-Real-IP, NEVER a
//               client-supplied CF-Connecting-IP.
//  - "legacy":  the historical `TAKOS_TRUST_PROXY=true` / `1` opt-in. Treated
//               like "generic" for spoof-safe precedence (XFF/X-Real-IP win over
//               a forged CF header), but keeps a CF-Connecting-IP FALLBACK when
//               no XFF/X-Real-IP is present so an existing cloudflared/CF origin
//               configured with `true` is not regressed.
type ProxyTrust = "none" | "cf" | "generic" | "legacy";

function proxyTrust(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): ProxyTrust {
  const flag = c.env.TAKOS_TRUST_PROXY;
  if (typeof flag !== "string") return "none";
  const v = flag.trim().toLowerCase();
  if (v === "cf" || v === "cloudflare") return "cf";
  if (v === "generic" || v === "xff") return "generic";
  if (v === "true" || v === "1") return "legacy";
  return "none";
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
 *  - Falls back to the authentic TCP peer address that the self-host (Bun)
 *    entrypoint stamps onto the ExecutionContext props (server-side, not a
 *    client-settable header). This keeps a directly-exposed self-host from
 *    bucketing every caller as "unknown".
 *  - Only when none of the above resolve does it fall back to "unknown". Rate
 *    limiters bucket "unknown" together, so an attacker with no IP visibility
 *    shares a budget with every other anonymous caller (intentional: degraded
 *    mode, not bypass). Behind a reverse proxy whose socket address is constant,
 *    set `TAKOS_TRUST_PROXY=true` so the forwarded client IP is used instead.
 */
export function getClientIP(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): string {
  // SECURITY (spoofable trust header / auth bypass): a generic reverse proxy
  // (nginx / Caddy / Traefik) stamps X-Forwarded-For / X-Real-IP but does NOT
  // set or strip the Cloudflare-specific `CF-Connecting-IP`, so a client-supplied
  // copy passes through the proxy untouched. Honouring CF-Connecting-IP ahead of
  // the proxy's XFF let an attacker rotate a forged header per request to defeat
  // login-lockout / per-IP rate limits (or pin the owner's IP to lock them out).
  // We therefore split the trust sources by an operator-declared proxy TYPE:
  // CF-Connecting-IP is honoured only on the genuine CF edge or an explicit
  // `cf`/cloudflared front; a generic/legacy proxy prefers the XFF it controls.
  const trust = proxyTrust(c);

  // CF-Connecting-IP is authoritative when we are provably on the Cloudflare
  // edge (unspoofable `request.cf`) OR the operator declares a Cloudflare front
  // (`TAKOS_TRUST_PROXY=cf`, e.g. a cloudflared tunnel where request.cf is
  // absent at the origin). The canonical CF deployment works with no config.
  if (isCloudflareEdge(c) || trust === "cf") {
    const cfConnectingIp = c.req.header("CF-Connecting-IP");
    if (cfConnectingIp && isValidIP(cfConnectingIp)) {
      return cfConnectingIp;
    }
  }

  // X-Forwarded-For (leftmost) / X-Real-IP: the value a trusted reverse proxy
  // stamps. Honoured under any explicit proxy opt-in and PREFERRED over a
  // client-supplied CF-Connecting-IP (which a generic proxy never controls).
  if (trust === "generic" || trust === "legacy" || trust === "cf") {
    const xff = c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
    if (xff && isValidIP(xff)) return xff;

    const xRealIp = c.req.header("X-Real-IP");
    if (xRealIp && isValidIP(xRealIp)) return xRealIp;
  }

  // Back-compat: the historical `TAKOS_TRUST_PROXY=true` opt-in honoured
  // CF-Connecting-IP. A cloudflared tunnel sets it but ALSO stamps XFF, so the
  // block above already covered the common case; keep CF-Connecting-IP as a
  // last-resort fallback ONLY for the ambiguous legacy flag so an existing
  // `true`-configured CF/cloudflared origin that sends only the CF header is not
  // regressed. Explicit `generic` never honours a client-settable CF header.
  if (trust === "legacy") {
    const cfConnectingIp = c.req.header("CF-Connecting-IP");
    if (cfConnectingIp && isValidIP(cfConnectingIp)) {
      return cfConnectingIp;
    }
  }

  // Last resort: the authentic TCP peer address the self-host (Bun) entrypoint
  // stamps onto the ExecutionContext props. Unlike a header it is NOT
  // client-controllable, so it is safe to trust without an opt-in. This keeps a
  // directly-exposed self-host from collapsing every caller into one "unknown"
  // bucket (which would let any attacker trip the single owner's login-lockout).
  // On Cloudflare the worker runs without our entrypoint, so this is simply
  // absent there and the CF-Connecting-IP path above already returned.
  const socketIp = stampedSocketIp(c);
  if (socketIp) return socketIp;

  return "unknown";
}

/**
 * Read the server-stamped TCP peer address from the ExecutionContext props, if
 * present and valid. `c.executionCtx` throws when the context was created
 * without one (e.g. some unit tests), so access it defensively.
 */
function stampedSocketIp(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): string | null {
  try {
    const ctx = c.executionCtx as unknown as {
      props?: { socketIp?: unknown };
    };
    const ip = ctx?.props?.socketIp;
    return typeof ip === "string" && isValidIP(ip) ? ip : null;
  } catch {
    return null;
  }
}
