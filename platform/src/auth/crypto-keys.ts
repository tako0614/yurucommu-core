/**
 * RSA keypair generation for ActivityPub HTTP Signatures
 *
 * Uses Web Crypto API available in Cloudflare Workers
 */

export interface KeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

const ENCRYPTED_PREFIX = "enc:v1:";

type EnvWithEncryptionKey = { DB_ENCRYPTION_KEY?: string | undefined };

let cachedKey: { secret: string; cryptoKey: CryptoKey } | null = null;

/**
 * Generate RSA-2048 keypair for HTTP Signatures
 */
export async function generateRsaKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), // 65537
      hash: "SHA-256",
    },
    true, // extractable
    ["sign", "verify"]
  ) as CryptoKeyPair;

  // Export public key
  const publicKeySpki = await crypto.subtle.exportKey("spki", keyPair.publicKey) as ArrayBuffer;
  const publicKeyPem = arrayBufferToPem(publicKeySpki, "PUBLIC KEY");

  // Export private key
  const privateKeyPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey) as ArrayBuffer;
  const privateKeyPem = arrayBufferToPem(privateKeyPkcs8, "PRIVATE KEY");

  return {
    publicKeyPem,
    privateKeyPem,
  };
}

/**
 * Convert ArrayBuffer to PEM format
 */
function arrayBufferToPem(buffer: ArrayBuffer, label: string): string {
  const base64 = arrayBufferToBase64(buffer);
  const lines: string[] = [];

  lines.push(`-----BEGIN ${label}-----`);

  // Split base64 into 64-character lines
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.slice(i, i + 64));
  }

  lines.push(`-----END ${label}-----`);

  return lines.join("\n");
}

/**
 * Convert ArrayBuffer to Base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert PEM to ArrayBuffer
 */
export function pemToArrayBuffer(pem: string): ArrayBuffer {
  // Remove PEM headers/footers and whitespace
  const base64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");

  // Decode base64
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Import RSA private key from PEM
 */
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const keyData = pemToArrayBuffer(pem);
  return await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    true,
    ["sign"]
  );
}

/**
 * Import RSA public key from PEM
 */
export async function importPublicKey(pem: string): Promise<CryptoKey> {
  const keyData = pemToArrayBuffer(pem);
  return await crypto.subtle.importKey(
    "spki",
    keyData,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    true,
    ["verify"]
  );
}

/**
 * Ensure user has a keypair, generate if not exists
 */
export async function ensureUserKeyPair(
  store: any,
  env: EnvWithEncryptionKey,
  instance_id: string,
  userId?: string
): Promise<KeyPair> {
  const actualUserId = userId ?? instance_id;
  const encryptionKey = await getEncryptionKey(env);

  // Check if keypair exists
  // Note: In multi-tenant setup, instance_id is the tenant_id
  // The column name in DB might be 'instance_id' (OSS) or 'tenant_id' (SaaS)
  // We try to detect which one to use based on the error or context, but for now
  // we'll use a try-catch approach or check the schema if possible.
  // However, since this is shared code, we should probably use the store abstraction
  // instead of raw SQL if possible, OR handle both column names.
  
  // Better approach: Use store.getApKeypair if available (it abstracts the query)
  if (typeof store.getApKeypair === 'function') {
    const existing = await store.getApKeypair(actualUserId);
    if (existing) {
      const { public_key_pem, private_key_pem: storedPrivate } = existing;
      const privateKeyPem = await decryptPrivateKey(
        store,
        encryptionKey,
        storedPrivate,
        instance_id,
        actualUserId
      );
      return {
        publicKeyPem: public_key_pem,
        privateKeyPem,
      };
    }
  } else {
    // Fallback to raw SQL for legacy support (OSS version)
    const existing = await store.query(
      "SELECT public_key_pem, private_key_pem FROM ap_keypairs WHERE instance_id = ? AND user_id = ?",
      [instance_id, actualUserId]
    );

    if (existing && existing.length > 0) {
      const publicKeyPem = existing[0].public_key_pem;
      const storedPrivate = existing[0].private_key_pem;
      const privateKeyPem = await decryptPrivateKey(
        store,
        encryptionKey,
        storedPrivate,
        instance_id,
        actualUserId
      );
      return {
        publicKeyPem,
        privateKeyPem,
      };
    }
  }

  // Generate new keypair
  console.log(`Generating new RSA keypair for instance ${instance_id}, user: ${actualUserId}`);
  const keyPair = await generateRsaKeyPair();
  const encryptedPrivateKey = await encryptPrivateKey(encryptionKey, keyPair.privateKeyPem);

  // Store in database
  if (typeof store.createApKeypair === 'function') {
    await store.createApKeypair({
      user_id: actualUserId,
      public_key_pem: keyPair.publicKeyPem,
      private_key_pem: encryptedPrivateKey,
    });
  } else {
    // Fallback to raw SQL
    await store.query(
      `INSERT INTO ap_keypairs (instance_id, user_id, public_key_pem, private_key_pem, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [instance_id, actualUserId, keyPair.publicKeyPem, encryptedPrivateKey]
    );
  }

  return keyPair;
}

async function getEncryptionKey(env: EnvWithEncryptionKey): Promise<CryptoKey> {
  const secret = env.DB_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new Error("DB_ENCRYPTION_KEY must be configured to protect ActivityPub private keys");
  }
  if (cachedKey && cachedKey.secret === secret) {
    return cachedKey.cryptoKey;
  }
  let raw: ArrayBuffer;
  try {
    raw = base64ToArrayBuffer(secret);
  } catch (error) {
    throw new Error("DB_ENCRYPTION_KEY must be base64-encoded");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  cachedKey = { secret, cryptoKey: key };
  return key;
}

async function encryptPrivateKey(key: CryptoKey, privateKeyPem: string): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(privateKeyPem)
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return ENCRYPTED_PREFIX + arrayBufferToBase64(combined.buffer);
}

async function decryptPrivateKey(
  store: any,
  key: CryptoKey,
  storedValue: string,
  instance_id: string,
  userId: string
): Promise<string> {
  const trimmed = (storedValue || "").trim();
  if (trimmed.startsWith(ENCRYPTED_PREFIX)) {
    const encoded = trimmed.slice(ENCRYPTED_PREFIX.length);
    const buffer = base64ToArrayBuffer(encoded);
    const iv = buffer.slice(0, 12);
    const ciphertext = buffer.slice(12);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      key,
      ciphertext
    );
    return new TextDecoder().decode(plain);
  }

  if (trimmed.startsWith("-----BEGIN")) {
    console.warn("Detected legacy plaintext ActivityPub key; re-encrypting");
    const encrypted = await encryptPrivateKey(key, trimmed);
    try {
      await store.query(
        "UPDATE ap_keypairs SET private_key_pem = ? WHERE instance_id = ? AND user_id = ?",
        [encrypted, instance_id, userId]
      );
    } catch (error) {
      console.error("failed to re-encrypt legacy private key", error);
    }
    return trimmed;
  }

  throw new Error("Unable to decrypt ActivityPub private key; invalid format");
}
