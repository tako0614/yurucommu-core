import { assert, assertEquals } from "jsr:@std/assert";

import { __outboxCursorInternals } from "../../../routes/activitypub/outbox.ts";

const { encodeCursor, decodeCursor, MAX_PAGE_LIMIT } = __outboxCursorInternals;

Deno.test("encodeCursor / decodeCursor round-trip preserves the tuple", () => {
  const value = {
    createdAt: "2026-03-21T12:34:56.789Z",
    id: "https://remote.example/activities/abc-123",
  };
  const encoded = encodeCursor(value);
  // The encoded form must be opaque (no obvious createdAt prefix).
  assert(!encoded.includes("2026"));
  const decoded = decodeCursor(encoded);
  assertEquals(decoded, value);
});

Deno.test("decodeCursor returns null for invalid / empty inputs", () => {
  assertEquals(decodeCursor(undefined), null);
  assertEquals(decodeCursor(""), null);
  assertEquals(decodeCursor("not-base64-!!"), null);
  // Valid base64 but malformed payload (no space separator).
  assertEquals(decodeCursor(btoa("no-separator")), null);
});

Deno.test("decodeCursor preserves UTF-8 identifiers", () => {
  const value = {
    createdAt: "2026-03-21T12:34:56.789Z",
    id: "https://日本語.example/users/さくら",
  };
  const encoded = encodeCursor(value);
  assertEquals(decodeCursor(encoded), value);
});

Deno.test("MAX_PAGE_LIMIT is bounded at 100", () => {
  assertEquals(MAX_PAGE_LIMIT, 100);
});
