import { expect, test } from "bun:test";

import { normalizeActor } from "./normalize.ts";

test("normalizeActor uses a renamed preferredUsername instead of a stale AP-ID path", () => {
  expect(
    normalizeActor({
      ap_id: "https://remote.example/users/old-name",
      username: "old-name@remote.example",
      preferred_username: "new-name",
    }),
  ).toEqual({
    ap_id: "https://remote.example/users/old-name",
    username: "new-name@remote.example",
    preferred_username: "new-name",
  });
});

test("normalizeActor preserves an existing WebFinger domain across a rename", () => {
  expect(
    normalizeActor({
      ap_id: "https://social.internal.example/users/old-name",
      username: "old-name@example.com",
      preferred_username: "new-name",
    }).username,
  ).toBe("new-name@example.com");
});

test("normalizeActor derives a stable visible handle when profile fields are missing", () => {
  expect(
    normalizeActor({ ap_id: "https://remote.example/users/raider" }),
  ).toEqual({
    ap_id: "https://remote.example/users/raider",
    username: "raider@remote.example",
    preferred_username: "raider",
  });
});
