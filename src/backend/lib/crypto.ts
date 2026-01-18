/**
 * Cryptography utilities for sensitive data encryption
 *
 * Uses AES-GCM for symmetric encryption of OAuth tokens and other sensitive data.
 * The encryption key should be set via ENCRYPTION_KEY environment variable.
 */

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
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
  if (!keyHex || keyHex.length !== 64) {
    // Key should be 32 bytes (64 hex chars) for AES-256
    return null;
  }

  const keyBytes = hexToBytes(keyHex);
  return await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
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
