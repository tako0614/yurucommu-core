/**
 * `If-None-Match` against RFC 9110 §8.8.3 and §13.1.2.
 *
 * The backend used to compare the raw field to the raw etag with `===`, which
 * is wrong three ways: the field is a LIST, the comparison is WEAK, and `*` is
 * a wildcard. Each of those is a case where the client HAS a fresh copy and
 * would have been sent the whole representation anyway.
 */

import { describe, expect, test } from "bun:test";

import { ifNoneMatchIsFresh } from "../../lib/conditional-request.ts";

const ETAG = '"ebf4f635"';

describe("ifNoneMatchIsFresh", () => {
  test("matches the exact entity-tag the response emitted", () => {
    expect(ifNoneMatchIsFresh(ETAG, ETAG)).toBe(true);
    expect(ifNoneMatchIsFresh('"other"', ETAG)).toBe(false);
  });

  test("uses the WEAK comparison function, on either side", () => {
    // §13.1.2. Only the opaque-tags are compared; the marker is ignored.
    expect(ifNoneMatchIsFresh(`W/${ETAG}`, ETAG)).toBe(true);
    expect(ifNoneMatchIsFresh(ETAG, `W/${ETAG}`)).toBe(true);
    expect(ifNoneMatchIsFresh(`W/${ETAG}`, `W/${ETAG}`)).toBe(true);
  });

  test("reads the whole list, with the OWS the grammar allows", () => {
    expect(ifNoneMatchIsFresh(`"a", "b", ${ETAG}`, ETAG)).toBe(true);
    expect(ifNoneMatchIsFresh(`"a",${ETAG}`, ETAG)).toBe(true);
    expect(ifNoneMatchIsFresh(`  W/"a" ,\t${ETAG}  `, ETAG)).toBe(true);
    expect(ifNoneMatchIsFresh('"a", "b"', ETAG)).toBe(false);
  });

  test("does not split on a comma INSIDE an opaque-tag", () => {
    // `etagc` admits every VCHAR but DQUOTE, so a comma is legal tag content
    // and `split(",")` would have torn this one into two malformed halves.
    const comma = '"a,b"';
    expect(ifNoneMatchIsFresh(comma, comma)).toBe(true);
    expect(ifNoneMatchIsFresh(`${comma}, ${ETAG}`, ETAG)).toBe(true);
    // ...and the halves a naive split would produce must not match anything.
    expect(ifNoneMatchIsFresh(comma, '"a')).toBe(false);
  });

  test("treats `*` as the whole field, matching any representation", () => {
    expect(ifNoneMatchIsFresh("*", ETAG)).toBe(true);
    expect(ifNoneMatchIsFresh(" * ", ETAG)).toBe(true);
    // Not a list member: `If-None-Match = "*" / 1#entity-tag`.
    expect(ifNoneMatchIsFresh(`*, ${ETAG}`, ETAG)).toBe(false);
  });

  test("a BARE etag never matches — that was the defect", () => {
    // Both directions: a client echoing the unquoted digest the route used to
    // emit, and a caller that passed the port's verbatim `etag` by mistake.
    expect(ifNoneMatchIsFresh("ebf4f635", ETAG)).toBe(false);
    expect(ifNoneMatchIsFresh(ETAG, "ebf4f635")).toBe(false);
  });

  test("ignores a condition it cannot evaluate", () => {
    // §13.1: an unparsable field is not a match, so the representation is sent.
    expect(ifNoneMatchIsFresh('"unterminated', ETAG)).toBe(false);
    expect(ifNoneMatchIsFresh(`${ETAG} "adjacent"`, ETAG)).toBe(false);
    expect(ifNoneMatchIsFresh("", ETAG)).toBe(false);
    expect(ifNoneMatchIsFresh(undefined, ETAG)).toBe(false);
    expect(ifNoneMatchIsFresh(null, ETAG)).toBe(false);
    // No validator to compare against is likewise not a match.
    expect(ifNoneMatchIsFresh(ETAG, undefined)).toBe(false);
    expect(ifNoneMatchIsFresh("*", undefined)).toBe(false);
  });
});
