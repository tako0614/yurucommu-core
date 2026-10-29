/**
 * Message Encryption for Web Push (RFC 8291) with the aes128gcm content
 * coding (RFC 8188), single record.
 */

import { concatBytes, toArrayBuffer, utf8 } from "./bytes.ts";
import { isP256UncompressedPoint } from "./p256.ts";

/** Record size advertised in the header. One record carries the whole message. */
export const WEB_PUSH_RECORD_SIZE = 4096;
const SALT_BYTES = 16;
const AUTH_SECRET_BYTES = 16;
const TAG_BYTES = 16;
const HEADER_BYTES = SALT_BYTES + 4 + 1 + 65;
/**
 * Push services must accept 4096 bytes of body (RFC 8030 §7.2). The body is
 * header + plaintext + delimiter + tag, so the plaintext limit is 3993 bytes.
 */
export const MAX_WEB_PUSH_PLAINTEXT_BYTES = 4096 - HEADER_BYTES - 1 - TAG_BYTES;

export interface WebPushSenderKeyPair {
  readonly privateKey: CryptoKey;
  /** Uncompressed SEC1 point of the ephemeral sender key, 65 bytes. */
  readonly publicKey: Uint8Array;
}

export interface WebPushEncryptionInput {
  readonly plaintext: Uint8Array;
  /** Subscription `p256dh`: the user agent's uncompressed P-256 point. */
  readonly userAgentPublicKey: Uint8Array;
  /** Subscription `auth`: 16 bytes. */
  readonly authSecret: Uint8Array;
  /** Test hooks. Production always uses a fresh salt and ephemeral key. */
  readonly salt?: Uint8Array;
  readonly senderKeyPair?: WebPushSenderKeyPair;
}

export async function encryptWebPushPayload(
  input: WebPushEncryptionInput,
): Promise<Uint8Array> {
  const { plaintext, userAgentPublicKey, authSecret } = input;
  if (!isP256UncompressedPoint(userAgentPublicKey)) {
    throw new Error("p256dh is not an uncompressed P-256 point");
  }
  if (authSecret.byteLength !== AUTH_SECRET_BYTES) {
    throw new Error("auth secret must be 16 bytes");
  }
  if (plaintext.byteLength > MAX_WEB_PUSH_PLAINTEXT_BYTES) {
    throw new Error(
      `push plaintext exceeds ${MAX_WEB_PUSH_PLAINTEXT_BYTES} bytes`,
    );
  }
  const salt = input.salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  if (salt.byteLength !== SALT_BYTES) throw new Error("salt must be 16 bytes");
  const sender = input.senderKeyPair ?? (await generateSenderKeyPair());

  const userAgentKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(userAgentPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: userAgentKey },
      sender.privateKey,
      256,
    ),
  );

  // IKM = HKDF(salt = auth_secret, IKM = ecdh_secret,
  //            info = "WebPush: info" || 0x00 || ua_public || as_public, L = 32)
  const keyInfo = concatBytes(
    utf8("WebPush: info\0"),
    userAgentPublicKey,
    sender.publicKey,
  );
  const ikm = await hkdf(ecdhSecret, authSecret, keyInfo, 32);
  const cek = await hkdf(ikm, salt, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, utf8("Content-Encoding: nonce\0"), 12);

  const contentKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(cek),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  // Single (last) record: plaintext || 0x02, no further padding.
  const record = concatBytes(plaintext, Uint8Array.of(0x02));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(nonce), tagLength: 128 },
      contentKey,
      toArrayBuffer(record),
    ),
  );

  const header = new Uint8Array(HEADER_BYTES);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(SALT_BYTES, WEB_PUSH_RECORD_SIZE);
  header[SALT_BYTES + 4] = 65;
  header.set(sender.publicKey, SALT_BYTES + 5);
  return concatBytes(header, ciphertext);
}

async function generateSenderKeyPair(): Promise<WebPushSenderKeyPair> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  return { privateKey: pair.privateKey, publicKey };
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(ikm),
    "HKDF",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: toArrayBuffer(salt),
        info: toArrayBuffer(info),
      },
      key,
      length * 8,
    ),
  );
}
