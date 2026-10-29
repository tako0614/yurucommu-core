/**
 * VAPID (RFC 8292) for an instance's own Web Push sender.
 *
 * The key pair is not stored anywhere. It is derived from a secret the
 * instance already holds (ENCRYPTION_KEY) with HKDF-SHA256 under a fixed,
 * versioned label, so it is stable across restarts and deploys and needs no
 * new secret slot. Rotation = bump the label version; browsers notice the new
 * public key and resubscribe.
 */

import {
  base64UrlEncode,
  bigIntToBytes,
  bytesToBigInt,
  concatBytes,
  toArrayBuffer,
  utf8,
} from "./bytes.ts";
import { P256_ORDER, p256PublicKeyFromPrivate } from "./p256.ts";

export const VAPID_KEY_LABEL = "yurucommu/web-push/vapid/v1";

/** RFC 8292 caps `exp` at 24h; we stay at 12h as the design requires. */
export const VAPID_JWT_LIFETIME_SECONDS = 12 * 60 * 60;
/** Reuse a cached JWT only while it still has at least this much validity. */
export const VAPID_JWT_REUSE_MARGIN_SECONDS = 60 * 60;

const MAX_DERIVATION_ATTEMPTS = 256;
const MAX_CACHED_JWTS = 64;

export interface VapidKeyPair {
  /** ECDSA P-256 signing key (non-extractable). */
  readonly privateKey: CryptoKey;
  /** Uncompressed SEC1 point, 65 bytes. */
  readonly publicKey: Uint8Array;
  /** base64url of `publicKey`: the browser's applicationServerKey and VAPID `k`. */
  readonly publicKeyBase64Url: string;
}

/**
 * Derive the private scalar: HKDF-SHA256(IKM = secret, salt = empty,
 * info = label || 0x00 || counter) → 32 bytes, retried with the next counter
 * until 1 <= d < n (rejection sampling; a retry happens with p ≈ 2^-32).
 */
export async function deriveVapidPrivateScalar(
  secret: Uint8Array,
  label: string = VAPID_KEY_LABEL,
): Promise<Uint8Array> {
  if (secret.byteLength < 16) {
    throw new RangeError("VAPID derivation secret must be at least 16 bytes");
  }
  const ikm = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(secret),
    "HKDF",
    false,
    ["deriveBits"],
  );
  for (let counter = 0; counter < MAX_DERIVATION_ATTEMPTS; counter += 1) {
    const info = concatBytes(utf8(label), Uint8Array.of(0x00, counter));
    const candidate = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: new ArrayBuffer(0),
          info: toArrayBuffer(info),
        },
        ikm,
        256,
      ),
    );
    const scalar = bytesToBigInt(candidate);
    if (scalar > 0n && scalar < P256_ORDER) return candidate;
  }
  throw new Error("VAPID key derivation did not produce a valid scalar");
}

export async function deriveVapidKeyPair(
  secret: Uint8Array,
  label: string = VAPID_KEY_LABEL,
): Promise<VapidKeyPair> {
  const privateScalar = await deriveVapidPrivateScalar(secret, label);
  return importVapidKeyPair(privateScalar);
}

/** Import a known P-256 private scalar (32 bytes) as a VAPID signing pair. */
export async function importVapidKeyPair(
  privateScalar: Uint8Array,
): Promise<VapidKeyPair> {
  const publicKey = p256PublicKeyFromPrivate(privateScalar);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: base64UrlEncode(privateScalar),
      x: base64UrlEncode(publicKey.subarray(1, 33)),
      y: base64UrlEncode(publicKey.subarray(33, 65)),
      ext: false,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return {
    privateKey,
    publicKey,
    publicKeyBase64Url: base64UrlEncode(publicKey),
  };
}

/** ENCRYPTION_KEY is a 32-byte key spelled as 64 hex characters. */
export function parseVapidDerivationSecret(
  value: string | undefined,
): Uint8Array | null {
  const text = value?.trim() ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(text)) return null;
  return bigIntToBytes(BigInt(`0x${text}`), 32);
}

let cachedInstanceKeys:
  | { readonly secret: string; readonly promise: Promise<VapidKeyPair> }
  | undefined;

/**
 * The instance's VAPID pair, derived from ENCRYPTION_KEY and cached for the
 * isolate. Null when the instance has no valid ENCRYPTION_KEY (Web Push is
 * then unavailable, and the config endpoint advertises no public key).
 */
export async function getInstanceVapidKeyPair(env: {
  readonly ENCRYPTION_KEY?: string;
}): Promise<VapidKeyPair | null> {
  const secretText = env.ENCRYPTION_KEY?.trim() ?? "";
  const secret = parseVapidDerivationSecret(secretText);
  if (!secret) return null;
  if (cachedInstanceKeys?.secret !== secretText) {
    const promise = deriveVapidKeyPair(secret);
    cachedInstanceKeys = { secret: secretText, promise };
    // A failed derivation must not be cached forever.
    promise.catch(() => {
      if (cachedInstanceKeys?.promise === promise)
        cachedInstanceKeys = undefined;
    });
  }
  return cachedInstanceKeys.promise;
}

export interface VapidClaims {
  /** Origin of the push resource (endpoint), e.g. https://fcm.googleapis.com */
  readonly aud: string;
  /** Expiry, seconds since the epoch. */
  readonly exp: number;
  /** Contact URI; the instance's https origin. */
  readonly sub: string;
}

export async function signVapidJwt(
  keys: VapidKeyPair,
  claims: VapidClaims,
): Promise<string> {
  const header = base64UrlEncode(
    utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  );
  const payload = base64UrlEncode(
    utf8(JSON.stringify({ aud: claims.aud, exp: claims.exp, sub: claims.sub })),
  );
  const signingInput = `${header}.${payload}`;
  // WebCrypto ECDSA emits IEEE P1363 r||s (64 bytes), which is exactly the
  // JWS ES256 signature encoding.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      toArrayBuffer(utf8(signingInput)),
    ),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

const jwtCache = new Map<string, { jwt: string; exp: number }>();

/**
 * `Authorization: vapid t=<jwt>, k=<public key>` for one push resource. The
 * JWT is reused while it has more than VAPID_JWT_REUSE_MARGIN_SECONDS left.
 */
export async function vapidAuthorization(
  keys: VapidKeyPair,
  input: { readonly endpoint: string; readonly subject: string },
  nowMs: number = Date.now(),
): Promise<string> {
  const aud = new URL(input.endpoint).origin;
  const sub = normalizeVapidSubject(input.subject);
  const nowSeconds = Math.floor(nowMs / 1000);
  const cacheKey = `${keys.publicKeyBase64Url}\n${aud}\n${sub}`;
  const cached = jwtCache.get(cacheKey);
  let jwt: string;
  if (cached && cached.exp - nowSeconds > VAPID_JWT_REUSE_MARGIN_SECONDS) {
    jwt = cached.jwt;
  } else {
    const exp = nowSeconds + VAPID_JWT_LIFETIME_SECONDS;
    jwt = await signVapidJwt(keys, { aud, exp, sub });
    jwtCache.delete(cacheKey);
    jwtCache.set(cacheKey, { jwt, exp });
    while (jwtCache.size > MAX_CACHED_JWTS) {
      const oldest = jwtCache.keys().next().value;
      if (oldest === undefined) break;
      jwtCache.delete(oldest);
    }
  }
  return `vapid t=${jwt}, k=${keys.publicKeyBase64Url}`;
}

/** Test hook: forget reused JWTs. */
export function clearVapidJwtCache(): void {
  jwtCache.clear();
}

/** The VAPID `sub`: the instance's https origin (http only for loopback dev). */
export function normalizeVapidSubject(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("VAPID subject must be an https origin");
  }
  return url.origin;
}
