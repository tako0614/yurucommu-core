import { isSafeRemoteUrl } from "../../../federation-helpers.ts";

export const MAX_INBOUND_REPLY_TARGET_LENGTH = 2048;

export type InboundReplyTargetResult =
  | { ok: true; parentId: string | null | undefined }
  | {
      ok: false;
      reason: "malformed" | "too_long" | "unsafe";
    };

/**
 * Normalize one inbound Note reply edge before it reaches storage or SQL.
 *
 * Absence preserves partial-Update compatibility and explicit null clears an
 * existing edge. A concrete parent must be one bounded, credential-free
 * HTTP(S) IRI. Unlike remote object identity, the parent may be local or on a
 * different remote origin: cross-origin replies are the normal federation
 * case. Unknown parents remain valid links and are never fetched here.
 */
export function validateInboundReplyTarget(
  value: unknown,
): InboundReplyTargetResult {
  if (value === undefined) return { ok: true, parentId: undefined };
  if (value === null) return { ok: true, parentId: null };
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  if (value.length > MAX_INBOUND_REPLY_TARGET_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  if (!isSafeRemoteUrl(value)) return { ok: false, reason: "unsafe" };
  return { ok: true, parentId: value };
}
