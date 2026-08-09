import { isLocal, isSafeRemoteUrl } from "../../../federation-helpers.ts";

export const MAX_INBOUND_OBJECT_ID_LENGTH = 2048;

export type InboundObjectIdentityResult =
  | { ok: true; objectId: string }
  | {
      ok: false;
      reason:
        | "missing"
        | "too_long"
        | "unsafe"
        | "local_origin"
        | "actor_origin_mismatch";
    };

/**
 * Bind an inbound object's durable identity to the verified remote actor.
 *
 * Server-to-server Create needs a stable remote object IRI: minting a local IRI
 * for an anonymous remote object would make this instance appear to own bytes
 * controlled by another server and would generate a different row on retry.
 * Exact URL origin (scheme + host + port), credential-free HTTP(S), the local
 * origin exclusion, and a storage-safe length are all one ownership decision.
 */
export function validateInboundObjectIdentity(
  objectId: unknown,
  actorApId: string,
  baseUrl: string,
): InboundObjectIdentityResult {
  if (objectId === undefined || objectId === null || objectId === "") {
    return { ok: false, reason: "missing" };
  }
  if (typeof objectId !== "string") {
    return { ok: false, reason: "unsafe" };
  }
  if (objectId.length > MAX_INBOUND_OBJECT_ID_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  if (!isSafeRemoteUrl(objectId)) {
    return { ok: false, reason: "unsafe" };
  }
  if (isLocal(objectId, baseUrl)) {
    return { ok: false, reason: "local_origin" };
  }
  try {
    if (new URL(objectId).origin !== new URL(actorApId).origin) {
      return { ok: false, reason: "actor_origin_mismatch" };
    }
  } catch {
    return { ok: false, reason: "unsafe" };
  }
  return { ok: true, objectId };
}
