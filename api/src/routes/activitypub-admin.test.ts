import { describe, expect, it } from "vitest";
import { mergeBlockedSources, normalizeBlockedInstance } from "./activitypub-admin";

describe("normalizeBlockedInstance", () => {
  it("extracts and lowercases hostnames", () => {
    expect(
      normalizeBlockedInstance("https://Sub.Example.com/ap/users/alice"),
    ).toBe("sub.example.com");
  });

  it("strips wildcard prefixes", () => {
    expect(normalizeBlockedInstance("*.Example.com")).toBe("example.com");
  });

  it("drops port numbers", () => {
    expect(normalizeBlockedInstance("example.com:8443")).toBe("example.com");
  });

  it("returns null for empty input", () => {
    expect(normalizeBlockedInstance("")).toBeNull();
  });
});

describe("mergeBlockedSources", () => {
  it("tracks config/env sources and merges duplicates", () => {
    const merged = mergeBlockedSources(
      ["spam.example", "shared.example"],
      ["shared.example", "env-only.example"],
    );
    const byDomain = new Map(merged.map((entry) => [entry.domain, entry]));

    expect(byDomain.get("spam.example")).toMatchObject({
      config: true,
      env: false,
      source: "config",
    });
    expect(byDomain.get("env-only.example")).toMatchObject({
      config: false,
      env: true,
      source: "env",
    });
    expect(byDomain.get("shared.example")).toMatchObject({
      config: true,
      env: true,
      source: "config+env",
    });
  });
});
