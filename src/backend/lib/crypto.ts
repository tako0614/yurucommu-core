/**
 * Cryptography utilities for sensitive data encryption
 *
 * Uses AES-GCM for symmetric encryption of OAuth tokens and other sensitive data.
 * The encryption key should be set via ENCRYPTION_KEY environment variable.
 */

function isValidHexString(hex: string, expectedLength?: number): boolean {
  if (!/^[0-9a-fA-F]+$/.test(hex)) return false;
  if (hex.length % 2 !== 0) return false;
  if (expectedLength !== undefined && hex.length !== expectedLength) return false;
  return true;
}

function hexToBytes(hex: string): Uint8Array {
  if (!isValidHexString(hex)) {
    throw new Error('Invalid hex string: must contain only hexadecimal characters (0-9, a-f, A-F) with even length');
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex character at position ${i}`);
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getEncryptionKey(keyHex: string | undefined): Promise<CryptoKey | null> {
  if (!keyHex) return null;

  if (!isValidHexString(keyHex, 64)) {
    console.error('Invalid encryption key format: must be exactly 64 hex characters (0-9, a-f, A-F)');
    return null;
  }

  try {
    const keyBytes = hexToBytes(keyHex);
    if (keyBytes.byteLength !== 32) {
      console.error('Invalid encryption key length: must decode to exactly 32 bytes');
      return null;
    }
    return await crypto.subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    console.error('Failed to import encryption key:', error);
    return null;
  }
}

async function requireEncryptionKey(keyHex: string | undefined, errorMessage: string): Promise<CryptoKey> {
  const key = await getEncryptionKey(keyHex);
  if (!key) throw new Error(errorMessage);
  return key;
}

/**
 * Encrypt a string value using AES-GCM.
 * Returns format: iv:ciphertext (both hex encoded)
 */
export async function encrypt(plaintext: string, encryptionKey: string | undefined): Promise<string> {
  const key = await requireEncryptionKey(encryptionKey,
    'ENCRYPTION_KEY is not configured or invalid. ' +
    'A 32-byte (64 hex character) key is required to encrypt sensitive data. ' +
    'Generate one with: openssl rand -hex 32'
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    data.buffer as ArrayBuffer
  );

  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypt a string value encrypted with encrypt().
 * Expects format: iv:ciphertext (both hex encoded)
 */
export async function decrypt(encrypted: string, encryptionKey: string | undefined): Promise<string> {
  const key = await requireEncryptionKey(encryptionKey,
    'ENCRYPTION_KEY is not configured or invalid. ' +
    'Cannot decrypt data without the encryption key.'
  );

  if (!encrypted.includes(':')) {
    throw new Error(
      'Data appears to be unencrypted (legacy format). ' +
      'Please re-authenticate to encrypt your tokens.'
    );
  }

  const [ivHex, ciphertextHex] = encrypted.split(':');
  if (!ivHex || !ciphertextHex) {
    return encrypted;
  }

  try {
    const iv = hexToBytes(ivHex);
    const ciphertext = hexToBytes(ciphertextHex);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext.buffer as ArrayBuffer
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error(
      'Failed to decrypt data. The encryption key may be incorrect or the data is corrupted.'
    );
  }
}

/**
 * Generate a new encryption key (32 bytes / 256 bits)
 * Run this once to generate a key for ENCRYPTION_KEY env var
 */
export function generateEncryptionKey(): string {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(key);
}

// PBKDF2 password hashing

const PBKDF2_ITERATIONS = 600000; // OWASP 2023 recommendation for SHA-256
const SALT_LENGTH = 32;
const HASH_LENGTH = 32;

/**
 * Derive bits from a password and salt using PBKDF2-SHA256.
 */
async function derivePasswordBits(password: string, salt: Uint8Array, hashLengthBytes: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password).buffer as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    hashLengthBytes * 8
  );

  return new Uint8Array(derivedBits);
}

/**
 * Constant-time comparison of two byte arrays.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Hash a password using PBKDF2-SHA256.
 * Returns format: salt:hash (both hex encoded)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await derivePasswordBits(password, salt, HASH_LENGTH);
  return `${bytesToHex(salt)}:${bytesToHex(hash)}`;
}

/**
 * Verify a password against a stored hash (salt:hash, hex encoded).
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash.includes(':')) return false;

  const [saltHex, expectedHashHex] = storedHash.split(':');
  if (!saltHex || !expectedHashHex) return false;
  if (!isValidHexString(saltHex) || !isValidHexString(expectedHashHex)) return false;

  try {
    const salt = hexToBytes(saltHex);
    const expectedHash = hexToBytes(expectedHashHex);
    const computedHash = await derivePasswordBits(password, salt, expectedHash.length);
    return timingSafeEqual(computedHash, expectedHash);
  } catch {
    return false;
  }
}
