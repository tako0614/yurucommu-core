// Account-migration (ActivityPub Move) consent verification, shared by the
// INBOUND Move handler (which only honors a Move whose destination consents) and
// the OUTBOUND /me/move endpoint (which refuses to advertise a migration the
// destination has not consented to, so the local user gets an actionable error
// instead of a silent no-op on every compliant receiver).

import { fetchWithTimeout } from "./federation-fetch.ts";

const ALIAS_FETCH_TIMEOUT_MS = 15000;

/**
 * Verify the destination actor of a Move declares the origin actor in its
 * `alsoKnownAs` (the standard Mastodon account-migration consent check): a
 * signed Move only proves the ORIGIN consents to leave; the destination's
 * back-reference is what proves the two accounts are the same person and stops
 * a follower-stealing redirect to an unconsenting account.
 *
 * Fetches the destination actor document fresh and FAILS CLOSED on any error
 * (network failure, non-2xx, malformed document, id mismatch, missing alias).
 * Callers must SSRF-guard `newActorApId` before calling.
 */
export async function destinationDeclaresAlias(
  newActorApId: string,
  oldActorApId: string,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(newActorApId, {
      headers: { Accept: "application/activity+json, application/ld+json" },
      timeout: ALIAS_FETCH_TIMEOUT_MS,
    });
    if (!res.ok) return false;
    const raw: unknown = await res.json();
    if (!raw || typeof raw !== "object") return false;
    const doc = raw as { id?: unknown; alsoKnownAs?: unknown };
    if (doc.id !== newActorApId) return false;
    const aka = doc.alsoKnownAs;
    const aliases = Array.isArray(aka)
      ? aka
      : typeof aka === "string"
        ? [aka]
        : [];
    return aliases.includes(oldActorApId);
  } catch {
    return false;
  }
}
