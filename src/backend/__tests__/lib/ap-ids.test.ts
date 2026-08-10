import { expect, test } from "bun:test";

import { formatPreferredUsername, formatUsername } from "../../lib/ap-ids.ts";

test("actor handle formatting prefers the current remote preferredUsername", () => {
  expect(
    formatUsername("https://remote.example/users/old-name", "new-name"),
  ).toBe("new-name@remote.example");
  expect(
    formatPreferredUsername(
      "https://remote.example/users/old-name",
      "new-name",
    ),
  ).toBe("new-name");
});

test("actor handle formatting degrades safely without a cached profile", () => {
  expect(formatUsername("https://remote.example/users/raider")).toBe(
    "raider@remote.example",
  );
  expect(formatPreferredUsername("https://remote.example/users/raider")).toBe(
    "raider",
  );
  expect(formatUsername("not a URL")).toBe("not a URL");
});
