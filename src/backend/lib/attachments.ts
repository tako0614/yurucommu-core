/**
 * Shared attachment bounds + validation.
 *
 * Owner of the attachment payload limits used by every write surface (post
 * create, DM messages, community chat) and by inbound-federation bounding.
 * Route files must import from here instead of copy-pasting the checks or
 * reaching into another route's transformers module.
 */

// Bound the attachments payload. An attachment is an open-ended record, so cap
// both the COUNT and the serialized SIZE — the size cap bounds row/federated-doc
// bloat regardless of internal shape (key count / field length). 16 KiB is ample
// for MAX_ATTACHMENTS media descriptors with alt text + blurhash.
export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENTS_JSON_LENGTH = 16 * 1024;

/** Drop an oversized inbound attachments blob to "[]" rather than store it. */
export function boundAttachmentsJson(json: string): string {
  return json.length > MAX_ATTACHMENTS_JSON_LENGTH ? "[]" : json;
}

export type ChatAttachment = Record<string, unknown>;

export type ChatAttachmentsResult =
  | { readonly ok: true; readonly attachments: ChatAttachment[] }
  | { readonly ok: false; readonly error: string };

/**
 * Validate a chat message's attachments array (mirrors the post-create bounds:
 * records only, capped count + serialized size). Returns the validated array
 * ([] when absent) or an error message. Used by both the DM and community-chat
 * send routes so the two cannot drift.
 */
export function validateChatAttachments(raw: unknown): ChatAttachmentsResult {
  if (raw === undefined || raw === null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "attachments must be an array" };
  }
  if (raw.some((a) => !a || typeof a !== "object" || Array.isArray(a))) {
    return { ok: false, error: "attachments must be objects" };
  }
  if (raw.length > MAX_ATTACHMENTS) {
    return {
      ok: false,
      error: `Too many attachments (max ${MAX_ATTACHMENTS})`,
    };
  }
  if (JSON.stringify(raw).length > MAX_ATTACHMENTS_JSON_LENGTH) {
    return { ok: false, error: "attachments payload too large" };
  }
  return { ok: true, attachments: raw as ChatAttachment[] };
}
