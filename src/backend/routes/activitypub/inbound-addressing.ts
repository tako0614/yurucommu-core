import type { Activity, ActivityObject } from "./inbox-types.ts";

export const MAX_INBOUND_ADDRESS_ENTRIES = 64;
export const MAX_INBOUND_ADDRESS_LENGTH = 2048;

const ADDRESS_FIELDS = ["to", "cc", "bto", "bcc", "audience"] as const;
type AddressField = (typeof ADDRESS_FIELDS)[number];
type AddressSource = Pick<
  Activity | ActivityObject,
  "to" | "cc" | "bto" | "bcc" | "audience"
>;

export type InboundAddressingFailureReason = "too_many" | "too_long";

export type InboundAddressingResult =
  | { ok: true; addresses: string[] }
  | {
      ok: false;
      reason: InboundAddressingFailureReason;
      addresses: string[];
    };

// The ActivityStreams public-collection magic value, including legacy short
// forms some implementations still emit.
const PUBLIC_COLLECTION = new Set([
  "https://www.w3.org/ns/activitystreams#Public",
  "as:Public",
  "Public",
]);

export function addressesPublic(addresses: readonly string[]): boolean {
  return addresses.some((address) => PUBLIC_COLLECTION.has(address));
}

/**
 * Validate one complete inbound addressing projection without truncation.
 *
 * A field/value pair is counted once across the envelope and embedded object,
 * so peers that repeat the same projection in both places remain compatible.
 * Field placement remains significant (`Public` in `to` and `cc` are distinct
 * reach declarations), while duplicate entries inside one field do not create
 * storage or lookup amplification. The returned flat list is de-duplicated for
 * shared-inbox routing; callers retain their field-specific arrays separately.
 */
export function collectBoundedInboundAddresses(
  sources: readonly AddressSource[],
): InboundAddressingResult {
  const seenByField = new Map<AddressField, Set<string>>();
  const addresses = new Set<string>();
  let entryCount = 0;

  for (const source of sources) {
    for (const field of ADDRESS_FIELDS) {
      const raw = source[field] as unknown;
      const candidates =
        typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
      let seen = seenByField.get(field);
      if (!seen) {
        seen = new Set<string>();
        seenByField.set(field, seen);
      }
      for (const candidate of candidates) {
        if (typeof candidate !== "string" || candidate.length === 0) continue;
        if (candidate.length > MAX_INBOUND_ADDRESS_LENGTH) {
          return {
            ok: false,
            reason: "too_long",
            addresses: [...addresses],
          };
        }
        if (seen.has(candidate)) continue;
        if (entryCount >= MAX_INBOUND_ADDRESS_ENTRIES) {
          return {
            ok: false,
            reason: "too_many",
            addresses: [...addresses],
          };
        }
        seen.add(candidate);
        addresses.add(candidate);
        entryCount += 1;
      }
    }
  }

  return { ok: true, addresses: [...addresses] };
}
