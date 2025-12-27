/**
 * Local Email/Password Authentication Service
 * Uses PBKDF2 for password hashing (Cloudflare Workers compatible)
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { LocalUser } from '../../types';

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Generate a random salt
 */
function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Derive key from password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8
  );
}

/**
 * Convert ArrayBuffer or Uint8Array to hex string
 */
function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Hash password for storage
 * Returns format: salt$hash (both hex encoded)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const derivedKey = await deriveKey(password, salt);
  return `${bufferToHex(salt)}$${bufferToHex(derivedKey)}`;
}

/**
 * Verify password against stored hash
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split('$');
  if (!saltHex || !hashHex) {
    return false;
  }

  const salt = hexToBuffer(saltHex);
  const derivedKey = await deriveKey(password, salt);
  const derivedHex = bufferToHex(derivedKey);

  // Constant-time comparison
  if (derivedHex.length !== hashHex.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < derivedHex.length; i++) {
    result |= derivedHex.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
export function isValidPassword(password: string): {
  valid: boolean;
  message?: string;
} {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters' };
  }
  if (password.length > 128) {
    return { valid: false, message: 'Password must be at most 128 characters' };
  }
  return { valid: true };
}

/**
 * Register a new user with email/password
 */
export async function registerUser(
  db: D1Database,
  data: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
    publicKey: string;
    privateKey: string;
  }
): Promise<LocalUser> {
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(data.password);
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO local_users (
        id, username, display_name, summary, public_key, private_key,
        email, password_hash, auth_provider, created_at, updated_at
      ) VALUES (?, ?, ?, '', ?, ?, ?, ?, 'local', ?, ?)`
    )
    .bind(
      id,
      data.username,
      data.displayName ?? data.username,
      data.publicKey,
      data.privateKey,
      data.email,
      passwordHash,
      now,
      now
    )
    .run();

  const user = await db
    .prepare('SELECT * FROM local_users WHERE id = ?')
    .bind(id)
    .first<LocalUser>();

  if (!user) {
    throw new Error('Failed to create user');
  }

  return user;
}

/**
 * Login with email/password
 */
export async function loginWithPassword(
  db: D1Database,
  email: string,
  password: string
): Promise<LocalUser | null> {
  const user = await db
    .prepare('SELECT * FROM local_users WHERE email = ?')
    .bind(email)
    .first<LocalUser>();

  if (!user || !user.password_hash) {
    return null;
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    return null;
  }

  return user;
}

/**
 * Check if email is already registered
 */
export async function isEmailTaken(
  db: D1Database,
  email: string
): Promise<boolean> {
  const result = await db
    .prepare('SELECT 1 FROM local_users WHERE email = ?')
    .bind(email)
    .first();

  return result !== null;
}

/**
 * Check if username is already taken
 */
export async function isUsernameTaken(
  db: D1Database,
  username: string
): Promise<boolean> {
  const result = await db
    .prepare('SELECT 1 FROM local_users WHERE username = ?')
    .bind(username)
    .first();

  return result !== null;
}

/**
 * Update user password
 */
export async function updatePassword(
  db: D1Database,
  userId: string,
  newPassword: string
): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();

  await db
    .prepare(
      'UPDATE local_users SET password_hash = ?, updated_at = ? WHERE id = ?'
    )
    .bind(passwordHash, now, userId)
    .run();
}
