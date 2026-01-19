/**
 * Cryptography utilities for sensitive data encryption
 *
 * Uses AES-GCM for symmetric encryption of OAuth tokens and other sensitive data.
 * The encryption key should be set via ENCRYPTION_KEY environment variable.
 */

// Validate hex string format
function isValidHexString(hex: string, expectedLength?: number): boolean {
  // Check format: only hex characters (0-9, a-f, A-F)
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return false;
  }
  // Check length is even (each byte = 2 hex chars)
  if (hex.length % 2 !== 0) {
    return false;
  }
  // Check expected length if provided
  if (expectedLength !== undefined && hex.length !== expectedLength) {
    return false;
  }
  return true;
}

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  // Validate hex string format before processing
  if (!isValidHexString(hex)) {
    throw new Error('Invalid hex string: must contain only hexadecimal characters (0-9, a-f, A-F) with even length');
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    // Additional safety check (should never fail after validation, but defense in depth)
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex character at position ${i}`);
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}

// Convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Get or generate encryption key
async function getEncryptionKey(keyHex: string | undefined): Promise<CryptoKey | null> {
  // Key should be 32 bytes (64 hex chars) for AES-256
  if (!keyHex) {
    return null;
  }

  // Validate hex format: must be exactly 64 hex characters
  if (!isValidHexString(keyHex, 64)) {
    console.error('Invalid encryption key format: must be exactly 64 hex characters (0-9, a-f, A-F)');
    return null;
  }

  try {
    const keyBytes = hexToBytes(keyHex);
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

/**
 * Encrypt a string value using AES-GCM
 * Returns format: iv:ciphertext (both hex encoded)
 *
 * @throws Error if ENCRYPTION_KEY is not configured (required for security)
 */
export async function encrypt(plaintext: string, encryptionKey: string | undefined): Promise<string> {
  const key = await getEncryptionKey(encryptionKey);
  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY is not configured or invalid. ' +
      'A 32-byte (64 hex character) key is required to encrypt sensitive data. ' +
      'Generate one with: openssl rand -hex 32'
    );
  }

  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    data.buffer as ArrayBuffer
  );

  // Format: iv:ciphertext (hex encoded)
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypt a string value encrypted with encrypt()
 * Expects format: iv:ciphertext (both hex encoded)
 *
 * @throws Error if ENCRYPTION_KEY is not configured
 * @throws Error if encrypted data is not in expected format (legacy unencrypted data)
 */
export async function decrypt(encrypted: string, encryptionKey: string | undefined): Promise<string> {
  const key = await getEncryptionKey(encryptionKey);
  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY is not configured or invalid. ' +
      'Cannot decrypt data without the encryption key.'
    );
  }

  // Check if this looks like encrypted data (iv:ciphertext format)
  if (!encrypted.includes(':')) {
    // Legacy unencrypted data - throw error to force migration
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

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    // Decryption failed - could be wrong key or corrupted data
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

// ============================================
// Password Hashing with PBKDF2
// ============================================

const PBKDF2_ITERATIONS = 600000; // OWASP 2023 recommendation for SHA-256
const SALT_LENGTH = 32; // 256-bit salt
const HASH_LENGTH = 32; // 256-bit derived key

/**
 * Hash a password using PBKDF2-SHA256
 * Returns format: salt:hash (both hex encoded)
 *
 * Use this to generate AUTH_PASSWORD_HASH:
 *   const hash = await hashPassword('your-password');
 *   // Set AUTH_PASSWORD_HASH=<hash> in environment
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const passwordData = encoder.encode(password);

  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordData.buffer as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  // Derive key using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH * 8 // bits
  );

  const hash = new Uint8Array(derivedBits);
  return `${bytesToHex(salt)}:${bytesToHex(hash)}`;
}

/**
 * Verify a password against a stored hash
 *
 * @param password - The password to verify
 * @param storedHash - The stored hash in format: salt:hash (hex encoded)
 * @returns true if password matches, false otherwise
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Check format
  if (!storedHash.includes(':')) {
    return false;
  }

  const [saltHex, expectedHashHex] = storedHash.split(':');
  if (!saltHex || !expectedHashHex) {
    return false;
  }

  // Validate hex format
  if (!isValidHexString(saltHex) || !isValidHexString(expectedHashHex)) {
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);
    const salt = hexToBytes(saltHex);
    const expectedHash = hexToBytes(expectedHashHex);

    // Import password as key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordData.buffer as ArrayBuffer,
      'PBKDF2',
      false,
      ['deriveBits']
    );

    // Derive key using same parameters
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      expectedHash.length * 8 // Match stored hash length
    );

    const computedHash = new Uint8Array(derivedBits);

    // Constant-time comparison
    if (computedHash.length !== expectedHash.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash[i] ^ expectedHash[i];
    }

    return result === 0;
  } catch {
    return false;
  }
}
