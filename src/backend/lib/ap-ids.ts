import { logger } from "./logger.ts";
import { bytesToHex } from "./hex.ts";

const utilsLog = logger.child({ component: "utils" });

export function safeJsonParse<T>(
  json: string | null | undefined,
  defaultValue: T,
): T {
  if (!json) return defaultValue;
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    // MEDIUM FIX: Log the error for debugging
    utilsLog.warn("safeJsonParse failed", {
      event: "utils.json.parse_failed",
      error: err,
    });
    return defaultValue;
  }
}

export function parseLimit(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

export function parseOffset(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), max);
}

export function generateId(): string {
  // 256-bit (32-byte) session/OAuth identifiers. Session ids in particular are
  // bearer credentials, so we keep the entropy high; 96-bit was too low.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function actorApId(baseUrl: string, username: string): string {
  return `${baseUrl}/ap/users/${username}`;
}

export function objectApId(baseUrl: string, id: string): string {
  return `${baseUrl}/ap/objects/${id}`;
}

export function activityApId(baseUrl: string, id: string): string {
  return `${baseUrl}/ap/activities/${id}`;
}

export function communityApId(baseUrl: string, name: string): string {
  // Normalize a trailing slash so the apId minted at community CREATION matches
  // the one reconstructed on every federation READ (actor doc / inbox / outbox /
  // followers / moderators / webfinger). Without this, a `APP_URL` configured
  // with a trailing slash would store `…//ap/groups/<name>` while reads look up
  // `…/ap/groups/<name>`, 404ing every community.
  return `${baseUrl.replace(/\/+$/, "")}/ap/groups/${name}`;
}

export function getDomain(apId: string): string {
  return new URL(apId).host;
}

export function isLocal(apId: string, baseUrl: string): boolean {
  // Compare hostname (and port, if specified by `baseUrl`) rather than
  // string-prefix `baseUrl`. Prefix comparison is unsafe because a remote
  // host like `https://yurucommu.example.evil` would match a baseUrl of
  // `https://yurucommu.example`.
  try {
    const apUrl = new URL(apId);
    const baseUrlObj = new URL(baseUrl);
    if (apUrl.hostname !== baseUrlObj.hostname) return false;
    if (baseUrlObj.port !== "") {
      return apUrl.port === baseUrlObj.port;
    }
    return true;
  } catch {
    return false;
  }
}

function cleanPreferredUsername(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Render an actor handle without treating the actor-id path as fresher than
 * ActivityPub's preferredUsername. Actor ids are stable across a profile rename,
 * so `/users/old-name` may legitimately describe `preferredUsername=new-name`.
 */
export function formatUsername(
  apId: string,
  preferredUsername?: string | null,
): string {
  const preferred = cleanPreferredUsername(preferredUsername);
  try {
    const url = new URL(apId);
    if (preferred) return `${preferred}@${url.host}`;
    const match = url.pathname.match(/\/(?:users|groups)\/([^/]+)\/?$/u);
    if (match) return `${match[1]}@${url.host}`;
  } catch {
    // Retained legacy rows must remain displayable/removable even if their id
    // predates the current absolute-URL validation boundary.
  }
  return preferred || apId;
}

/** Always return a non-empty primary label for an actor roster row. */
export function formatPreferredUsername(
  apId: string,
  preferredUsername?: string | null,
): string {
  const preferred = cleanPreferredUsername(preferredUsername);
  if (preferred) return preferred;
  const formatted = formatUsername(apId);
  const separator = formatted.lastIndexOf("@");
  return separator > 0 ? formatted.slice(0, separator) : formatted;
}
