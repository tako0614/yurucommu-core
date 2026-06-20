/**
 * Decode an ActivityPub id that was carried in a URL PATH segment
 * (`/post/<id>`, `/profile/<id>`). An AP id is a full URL, so it is
 * percent-encoded into the segment. On a full-page load (refresh / opening a
 * shared or bookmarked link) the server round-trip decodes `%2F` back to `/`
 * and collapses the scheme's `://` to `:/`, which also splits the single route
 * segment into several — hence the matching routes use a splat (`*param`) so the
 * whole tail is captured here and reassembled.
 *
 * Handles every arrival shape idempotently:
 *   - in-session client nav:  `https%3A%2F%2Fhost%2Fap%2Fobjects%2Fx`
 *   - full-page load (splat):  `https%3A/host/ap/objects/x`
 *   - already-decoded splat:   `https:/host/ap/objects/x` or `https://host/...`
 */
export function decodeApIdParam(raw: string | undefined | null): string {
  if (!raw) return "";
  let value = raw;
  // Only decode when still percent-encoded, to avoid double-decoding a value the
  // router already decoded.
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // Leave the raw value if it is not valid percent-encoding.
    }
  }
  // Restore the scheme separator collapsed by path normalisation.
  return value.replace(/^(https?):\/(?!\/)/i, "$1://");
}
