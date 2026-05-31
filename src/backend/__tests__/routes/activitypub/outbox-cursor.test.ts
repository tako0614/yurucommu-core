import { expect, test } from "bun:test";

import { __outboxCursorInternals } from "../../../routes/activitypub/outbox.ts";

const { encodeCursor, decodeCursor, MAX_PAGE_LIMIT } = __outboxCursorInternals;

test("encodeCursor / decodeCursor round-trip preserves the tuple", () => {
  const value = {
    createdAt: "2026-03-21T12:34:56.789Z",
    id: "https://remote.example/activities/abc-123",
  };
  const encoded = encodeCursor(value);
  // The encoded form must be opaque (no obvious createdAt prefix).
  expect(!encoded.includes("2026")).toBeTruthy();
  const decoded = decodeCursor(encoded);
  expect(decoded).toEqual(value);
});

test("decodeCursor returns null for invalid / empty inputs", () => {
  expect(decodeCursor(undefined)).toEqual(null);
  expect(decodeCursor("")).toEqual(null);
  expect(decodeCursor("not-base64-!!")).toEqual(null);
  // Valid base64 but malformed payload (no space separator).
  expect(decodeCursor(btoa("no-separator"))).toEqual(null);
});

test("decodeCursor preserves UTF-8 identifiers", () => {
  const value = {
    createdAt: "2026-03-21T12:34:56.789Z",
    id: "https://日本語.example/users/さくら",
  };
  const encoded = encodeCursor(value);
  expect(decodeCursor(encoded)).toEqual(value);
});

test("MAX_PAGE_LIMIT is bounded at 100", () => {
  expect(MAX_PAGE_LIMIT).toEqual(100);
});
