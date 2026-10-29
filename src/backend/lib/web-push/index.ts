/**
 * Standard Web Push sending for yurucommu-family instances (ADR 0026 in
 * takos-control): VAPID derived from the instance secret, RFC 8291 aes128gcm,
 * Declarative Web Push payloads. Nothing here knows about Takosumi.
 */

export { base64UrlDecode, base64UrlEncode } from "./bytes.ts";
export {
  encryptWebPushPayload,
  MAX_WEB_PUSH_PLAINTEXT_BYTES,
  WEB_PUSH_RECORD_SIZE,
  type WebPushEncryptionInput,
  type WebPushSenderKeyPair,
} from "./encrypt.ts";
export { isP256UncompressedPoint, p256PublicKeyFromPrivate } from "./p256.ts";
export {
  buildDeclarativeWebPushMessage,
  DECLARATIVE_WEB_PUSH_MAGIC,
  MAX_DECLARATIVE_WEB_PUSH_BYTES,
  type DeclarativeWebPushInput,
  type DeclarativeWebPushMessage,
  type DeclarativeWebPushNotification,
} from "./payload.ts";
export {
  classifyWebPushResponse,
  DEFAULT_WEB_PUSH_TTL_SECONDS,
  isValidTopic,
  sendWebPush,
  type WebPushMessageOptions,
  type WebPushOutcome,
  type WebPushSendContext,
  type WebPushSubscriptionTarget,
  type WebPushUrgency,
} from "./send.ts";
export {
  computeWebPushTopic,
  deriveWebPushTopicKey,
  instanceWebPushTopic,
  WEB_PUSH_TOPIC_KEY_LABEL,
} from "./topic.ts";
export {
  clearVapidJwtCache,
  deriveVapidKeyPair,
  deriveVapidPrivateScalar,
  getInstanceVapidKeyPair,
  importVapidKeyPair,
  parseVapidDerivationSecret,
  signVapidJwt,
  vapidAuthorization,
  VAPID_JWT_LIFETIME_SECONDS,
  VAPID_JWT_REUSE_MARGIN_SECONDS,
  VAPID_KEY_LABEL,
  type VapidClaims,
  type VapidKeyPair,
} from "./vapid.ts";
