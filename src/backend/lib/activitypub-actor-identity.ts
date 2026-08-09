/**
 * Normalize the deliberately-small set of cosmetic actor-IRI differences that
 * the HTTP-signature boundary accepts.
 *
 * URL parsing lowercases the scheme/host and removes default ports. Fragments
 * never identify an ActivityPub actor, and a single trailing slash is treated
 * as cosmetic. Path case, query strings, and every other component remain
 * identity-significant so sibling actors on one origin are never conflated.
 */
export function normalizeActivityPubActorId(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    let normalized = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
    if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Compare two actor IRIs using exactly the equivalence accepted when binding
 * an Activity actor to its verified HTTP-signature key owner.
 */
export function isSameActivityPubActor(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const normalizedLeft = normalizeActivityPubActorId(left);
  const normalizedRight = normalizeActivityPubActorId(right);
  return (
    normalizedLeft !== null &&
    normalizedRight !== null &&
    normalizedLeft === normalizedRight
  );
}
