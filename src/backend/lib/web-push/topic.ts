/**
 * The Web Push `Topic` header for a direct-message conversation.
 *
 * `Topic` travels unencrypted to the push service (and a relay may turn it
 * into an APNs collapse id or an FCM collapse key), so it must not be a value
 * an outsider can compute. A plain hash of the conversation id would be: DM
 * conversation ids are derived from the two participants' public actor ids,
 * so anyone could hash candidate pairs and learn who messages whom, and the
 * same value on both participants' devices would link them.
 *
 * The topic is therefore a keyed MAC over (recipient, conversation) with a key
 * only the instance holds: HKDF-SHA256(IKM = ENCRYPTION_KEY, salt = empty,
 * info = "yurucommu/web-push/topic/v1") → 32-byte HMAC-SHA256 key. The first
 * 24 bytes of the MAC, base64url encoded, give 32 characters (the RFC 8030
 * limit). Each recipient gets a different topic for the same conversation,
 * and nothing about it is reproducible without ENCRYPTION_KEY.
 */

import { base64UrlEncode, concatBytes, toArrayBuffer, utf8 } from "./bytes.ts";
import { parseVapidDerivationSecret } from "./vapid.ts";

export const WEB_PUSH_TOPIC_KEY_LABEL = "yurucommu/web-push/topic/v1";

/** 24 bytes → 32 base64url characters, the RFC 8030 §5.4 maximum. */
const TOPIC_BYTES = 24;

export async function deriveWebPushTopicKey(
  secret: Uint8Array,
  label: string = WEB_PUSH_TOPIC_KEY_LABEL,
): Promise<CryptoKey> {
  if (secret.byteLength < 16) {
    throw new RangeError(
      "Topic key derivation secret must be at least 16 bytes",
    );
  }
  const ikm = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(secret),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new ArrayBuffer(0),
      info: toArrayBuffer(utf8(label)),
    },
    ikm,
    256,
  );
  return crypto.subtle.importKey(
    "raw",
    bits,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * HMAC(key, len(recipient) as uint32 big-endian ‖ recipient ‖ conversation),
 * truncated to 24 bytes. The length prefix keeps the two fields unambiguous.
 */
export async function computeWebPushTopic(
  key: CryptoKey,
  recipient: string,
  conversation: string,
): Promise<string> {
  const recipientBytes = utf8(recipient);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, recipientBytes.byteLength);
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      toArrayBuffer(concatBytes(length, recipientBytes, utf8(conversation))),
    ),
  );
  return base64UrlEncode(mac.subarray(0, TOPIC_BYTES));
}

let cachedTopicKey:
  { readonly secret: string; readonly promise: Promise<CryptoKey> } | undefined;

/**
 * The instance's topic for one recipient's view of one conversation, or null
 * when the instance has no valid ENCRYPTION_KEY (the message then carries no
 * Topic; delivery itself is unavailable without the key anyway).
 */
export async function instanceWebPushTopic(
  env: { readonly ENCRYPTION_KEY?: string },
  recipient: string,
  conversation: string,
): Promise<string | null> {
  const secretText = env.ENCRYPTION_KEY?.trim() ?? "";
  const secret = parseVapidDerivationSecret(secretText);
  if (!secret) return null;
  if (cachedTopicKey?.secret !== secretText) {
    const promise = deriveWebPushTopicKey(secret);
    cachedTopicKey = { secret: secretText, promise };
    promise.catch(() => {
      if (cachedTopicKey?.promise === promise) cachedTopicKey = undefined;
    });
  }
  return computeWebPushTopic(
    await cachedTopicKey.promise,
    recipient,
    conversation,
  );
}
