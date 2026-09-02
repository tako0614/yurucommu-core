/**
 * `If-None-Match` evaluation (RFC 9110 §8.8.3, §13.1.2).
 *
 * Two rules from the RFC are easy to get wrong and are both pinned here.
 *
 * The FIELD IS A LIST, and a comma is not a separator it can be split on.
 * `etagc` admits every VCHAR except DQUOTE, so `","` is a legal opaque-tag and
 * `header.split(",")` would tear one in half. The scan below reads a tag at a
 * time — an optional `W/`, an opening DQUOTE, then everything up to the next
 * DQUOTE, which is unambiguous precisely because the tag body cannot contain
 * one.
 *
 * The COMPARISON IS WEAK. §13.1.2 evaluates `If-None-Match` with the weak
 * comparison function, so the weakness marker is ignored on both sides and only
 * the quoted opaque-tags are compared, character for character. (The strong
 * function is for `If-Match` and `If-Range`, where a weak validator may not be
 * used to reassemble a representation.)
 *
 * A field value the grammar does not admit yields no tags at all and therefore
 * no match: §13.1 says to ignore a condition that cannot be evaluated, which
 * for a cache validator means serving the full representation.
 */

/**
 * Would the client's cached copy still be valid — i.e. should the caller answer
 * `304 Not Modified` instead of the representation?
 *
 * `httpEtag` must be the SAME value the response emits in `ETag`: the quoted,
 * header-safe spelling. A bare backend etag never matches anything a client
 * echoes back, which is the whole reason this takes the header form.
 *
 * Call this only once the requested representation is known to exist and the
 * requester is known to be allowed to read it. `*` matches whenever there is a
 * current representation, and answering 304 to someone who may not read the
 * object would leak its existence.
 */
export function ifNoneMatchIsFresh(
  header: string | undefined | null,
  httpEtag: string | undefined,
): boolean {
  if (!header || !httpEtag) return false;
  const field = header.trim();
  // `If-None-Match = "*" / 1#entity-tag`: the wildcard is the WHOLE field, not
  // a member of the list, and it matches because a representation exists.
  if (field === "*") return true;
  const target = opaqueTagOf(httpEtag);
  if (target === null) return false;
  return entityTags(field).includes(target);
}

/** One entity-tag reduced to its quoted opaque-tag, or `null` if malformed. */
function opaqueTagOf(tag: string): string | null {
  const bare = tag.startsWith("W/") ? tag.slice(2) : tag;
  if (bare.length < 2 || !bare.startsWith('"') || !bare.endsWith('"')) {
    return null;
  }
  return bare;
}

/** Every entity-tag in a list field value, or none at all if it is malformed. */
function entityTags(field: string): string[] {
  const tags: string[] = [];
  let index = 0;
  while (index < field.length) {
    const char = field[index];
    if (char === "," || char === " " || char === "\t") {
      index += 1;
      continue;
    }
    // The weakness marker is consumed and discarded: the weak comparison
    // function does not distinguish `W/"x"` from `"x"`.
    if (field.startsWith("W/", index)) index += 2;
    if (field[index] !== '"') return [];
    const end = field.indexOf('"', index + 1);
    if (end === -1) return [];
    tags.push(field.slice(index, end + 1));
    index = end + 1;
    while (index < field.length) {
      const next = field[index];
      if (next !== " " && next !== "\t") break;
      index += 1;
    }
    // Nothing but a comma may follow an entity-tag.
    if (index < field.length && field[index] !== ",") return [];
  }
  return tags;
}
