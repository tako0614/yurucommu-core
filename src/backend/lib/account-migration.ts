// Account-migration (ActivityPub Move) consent verification, shared by the
// INBOUND Move handler (which only honors a Move whose destination consents) and
// the OUTBOUND /me/move endpoint (which refuses to advertise a migration the
// destination has not consented to, so the local user gets an actionable error
// instead of a silent no-op on every compliant receiver).

import { fetchWithTimeout } from "./federation-fetch.ts";
import { signRequest } from "./ap-signing.ts";
import type { RemoteFetchSigner } from "./activitypub-actor-cache.ts";
import { parseWebFinger } from "./activitypub-validators.ts";
import { isSafeRemoteUrl, normalizeRemoteDomain } from "./ssrf.ts";

const ALIAS_FETCH_TIMEOUT_MS = 15000;

// `@user@domain` or `user@domain` (a fediverse handle). Rejects embedded
// whitespace and extra `@` so it never matches a URL or a malformed string.
const HANDLE_RE = /^@?([^@\s]+)@([^@\s]+)$/;

/**
 * Resolve a migration target that may be EITHER a full actor URL or a
 * `@user@domain` fediverse handle (what users actually know — and what the
 * Settings move field's placeholder shows). A handle is resolved via WebFinger
 * to its `self` ActivityPub actor URL; a URL is returned untouched for the
 * caller to SSRF-validate. Returns null if the input is neither a usable URL
 * nor a resolvable handle. Fails closed on any error.
 */
export async function resolveMoveTarget(input: string): Promise<string | null> {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    // Full actor URL: the caller still runs isValidHttpUrl + isSafeRemoteUrl.
    return trimmed;
  }
  const match = trimmed.match(HANDLE_RE);
  if (!match) return null;
  const [, username, domain] = match;
  const safeDomain = normalizeRemoteDomain(domain);
  if (!safeDomain) return null;
  try {
    const webfingerUrl = `https://${safeDomain}/.well-known/webfinger?resource=acct:${username}@${safeDomain}`;
    const res = await fetchWithTimeout(webfingerUrl, {
      headers: { Accept: "application/jrd+json" },
      timeout: ALIAS_FETCH_TIMEOUT_MS,
    });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    const doc = parseWebFinger(raw);
    const self = doc.links?.find(
      (l) => l.rel === "self" && l.type === "application/activity+json",
    );
    if (!self?.href || !isSafeRemoteUrl(self.href)) return null;
    return self.href;
  } catch {
    return null;
  }
}

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
  signer?: RemoteFetchSigner,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(newActorApId, {
      headers: {
        Accept: "application/activity+json, application/ld+json",
        // Sign as the instance actor so a destination on a secure-mode
        // instance serves its actor doc — otherwise the alias (consent) check
        // 401s and the Move fails closed even when consent was declared.
        ...(signer
          ? await signRequest(
              signer.privateKeyPem,
              signer.keyId,
              "GET",
              newActorApId,
            )
          : {}),
      },
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
