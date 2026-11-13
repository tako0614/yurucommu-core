/**
 * Preserve the legacy canonical spelling used by persisted actor keys.
 *
 * URL parsing folds scheme/host/default ports and fragments are removed. The
 * historical terminal-string slash rule also collapses a query ending in "/".
 * Authority comparisons must use isSameActivityPubActor, which checks queries
 * separately. Changing this stored representation needs its own data/key
 * compatibility work; an authority fix must not silently rewrite those keys.
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
  // Legacy canonical strings are persisted as keys. Do not change those keys
  // when enforcing the stricter, documented actor-authority comparison.
  try {
    if (new URL(left).search !== new URL(right).search) return false;
  } catch {
    return false;
  }
  const normalizedLeft = normalizeActivityPubActorId(left);
  const normalizedRight = normalizeActivityPubActorId(right);
  return (
    normalizedLeft !== null &&
    normalizedRight !== null &&
    normalizedLeft === normalizedRight
  );
}
