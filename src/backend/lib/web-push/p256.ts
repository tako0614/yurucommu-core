/**
 * Minimal P-256 arithmetic for the one thing WebCrypto cannot do portably:
 * computing the public point of a private scalar we derived ourselves (VAPID
 * keys come from HKDF, not from `generateKey`). WebCrypto then imports the
 * {d, x, y} JWK and does all signing.
 *
 * Not constant-time. It runs once per isolate on a server-held secret, with no
 * attacker-controlled input, so there is no timing oracle to exploit.
 */

import { bigIntToBytes, bytesToBigInt, concatBytes } from "./bytes.ts";

const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
/** Order of the base point. A valid private scalar d satisfies 1 <= d < N. */
export const P256_ORDER =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

type Jacobian = readonly [x: bigint, y: bigint, z: bigint];
const INFINITY: Jacobian = [0n, 1n, 0n];

function mod(value: bigint): bigint {
  const result = value % P;
  return result >= 0n ? result : result + P;
}

function modPow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let factor = mod(base);
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = mod(result * factor);
    factor = mod(factor * factor);
    remaining >>= 1n;
  }
  return result;
}

// dbl-2001-b (a = -3)
function double([x1, y1, z1]: Jacobian): Jacobian {
  if (z1 === 0n || y1 === 0n) return INFINITY;
  const delta = mod(z1 * z1);
  const gamma = mod(y1 * y1);
  const beta = mod(x1 * gamma);
  const alpha = mod(3n * (x1 - delta) * (x1 + delta));
  const x3 = mod(alpha * alpha - 8n * beta);
  const z3 = mod((y1 + z1) * (y1 + z1) - gamma - delta);
  const y3 = mod(alpha * (4n * beta - x3) - 8n * gamma * gamma);
  return [x3, y3, z3];
}

// add-2007-bl
function add(left: Jacobian, right: Jacobian): Jacobian {
  const [x1, y1, z1] = left;
  const [x2, y2, z2] = right;
  if (z1 === 0n) return right;
  if (z2 === 0n) return left;
  const z1z1 = mod(z1 * z1);
  const z2z2 = mod(z2 * z2);
  const u1 = mod(x1 * z2z2);
  const u2 = mod(x2 * z1z1);
  const s1 = mod(y1 * z2 * z2z2);
  const s2 = mod(y2 * z1 * z1z1);
  const h = mod(u2 - u1);
  const r = mod(2n * (s2 - s1));
  if (h === 0n) return r === 0n ? double(left) : INFINITY;
  const i = mod(4n * h * h);
  const j = mod(h * i);
  const v = mod(u1 * i);
  const x3 = mod(r * r - j - 2n * v);
  const y3 = mod(r * (v - x3) - 2n * s1 * j);
  const z3 = mod(((z1 + z2) * (z1 + z2) - z1z1 - z2z2) * h);
  return [x3, y3, z3];
}

/**
 * Uncompressed SEC1 public point (0x04 || X || Y, 65 bytes) of a private
 * scalar given as 32 big-endian bytes.
 */
export function p256PublicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  if (privateKey.byteLength !== 32) {
    throw new RangeError("P-256 private key must be 32 bytes");
  }
  const scalar = bytesToBigInt(privateKey);
  if (scalar <= 0n || scalar >= P256_ORDER) {
    throw new RangeError("P-256 private key is out of range");
  }
  let result = INFINITY;
  let addend: Jacobian = [GX, GY, 1n];
  let remaining = scalar;
  while (remaining > 0n) {
    if (remaining & 1n) result = add(result, addend);
    addend = double(addend);
    remaining >>= 1n;
  }
  const [x, y, z] = result;
  const zInverse = modPow(z, P - 2n);
  const zInverse2 = mod(zInverse * zInverse);
  const affineX = mod(x * zInverse2);
  const affineY = mod(y * zInverse2 * zInverse);
  return concatBytes(
    Uint8Array.of(0x04),
    bigIntToBytes(affineX, 32),
    bigIntToBytes(affineY, 32),
  );
}

/**
 * True when `point` is an uncompressed SEC1 P-256 point that lies on the
 * curve (y² = x³ − 3x + b over the field). Used to refuse malformed
 * subscription keys at registration time, synchronously.
 */
export function isP256UncompressedPoint(point: Uint8Array): boolean {
  if (point.byteLength !== 65 || point[0] !== 0x04) return false;
  const x = bytesToBigInt(point.subarray(1, 33));
  const y = bytesToBigInt(point.subarray(33, 65));
  if (x >= P || y >= P) return false;
  return mod(y * y) === mod(x * x * x - 3n * x + B);
}
