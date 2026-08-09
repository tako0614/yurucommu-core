/**
 * Small Durable-Object ticket primitive shared by realtime and call sockets.
 *
 * Browser WebSocket constructors cannot attach an Authorization header. The
 * authenticated fetch path therefore mints an opaque, short-lived ticket in
 * the exact per-user DO that will accept the upgrade. Only its SHA-256 hash is
 * stored, and a consume attempt deletes it before returning a verdict.
 */

export interface OneTimeTicketStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

export interface OneTimeTicketOptions {
  prefix: string;
  ttlMs?: number;
  maxOutstanding?: number;
  now?: () => number;
}

interface StoredTicket {
  hash: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_OUTSTANDING = 8;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Compare strings through fixed-width digests using the Workers primitive. */
async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [aDigest, bDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (left: BufferSource, right: BufferSource) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(aDigest, bDigest);
  }

  // Bun/self-host portability fallback. Both values are SHA-256 digests, so
  // their length is fixed and the loop never short-circuits on content.
  const left = new Uint8Array(aDigest);
  const right = new Uint8Array(bDigest);
  let diff = 0;
  for (let index = 0; index < left.length; index++) {
    diff |= left[index]! ^ right[index]!;
  }
  return diff === 0;
}

export async function mintOneTimeTicket(
  storage: OneTimeTicketStorage,
  options: OneTimeTicketOptions,
): Promise<string> {
  const ticket =
    crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "");
  const hash = await sha256Hex(ticket);
  const now = (options.now ?? Date.now)();
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxOutstanding = options.maxOutstanding ?? DEFAULT_MAX_OUTSTANDING;

  const stored = await storage.list<StoredTicket>({ prefix: options.prefix });
  const live = [...stored.entries()]
    .filter(([, value]) => value.expiresAt > now)
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt);

  const liveKeys = new Set(live.map(([key]) => key));
  for (const [key] of stored) {
    if (!liveKeys.has(key)) await storage.delete(key);
  }
  while (live.length >= maxOutstanding) {
    const [oldestKey] = live.shift()!;
    await storage.delete(oldestKey);
  }

  await storage.put(`${options.prefix}${hash}`, {
    hash,
    expiresAt: now + ttlMs,
  } satisfies StoredTicket);
  return ticket;
}

export async function consumeOneTimeTicket(
  storage: OneTimeTicketStorage,
  ticket: string,
  options: OneTimeTicketOptions,
): Promise<boolean> {
  const hash = await sha256Hex(ticket);
  const key = `${options.prefix}${hash}`;
  const stored = await storage.get<StoredTicket>(key);
  if (!stored) return false;

  // Delete before validating so expired or malformed replay attempts also
  // consume the only matching record.
  await storage.delete(key);
  const now = (options.now ?? Date.now)();
  if (stored.expiresAt <= now) return false;
  return timingSafeEqualStrings(stored.hash, hash);
}
