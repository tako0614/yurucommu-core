import { describe, expect, it } from "vitest";
import activityPubMetadataRoutes from "./activitypub-metadata.js";
import {
  buildActivityPubWellKnown,
  getActivityPubMetadata,
} from "../profile/activitypub-metadata.js";

describe("getActivityPubMetadata", () => {
  it("returns http(s) contexts from takos-profile", () => {
    const metadata = getActivityPubMetadata();
    expect(metadata.contexts.length).toBeGreaterThan(0);
    metadata.contexts.forEach((value) => {
      expect(value.startsWith("http")).toBe(true);
    });
    expect(metadata.distro.name).toBeTruthy();
  });
});

describe("buildActivityPubWellKnown", () => {
  it("builds payload with node url and contexts", () => {
    const payload = buildActivityPubWellKnown("example.com");
    expect(payload.node).toBe("https://example.com");
    expect(payload.contexts.length).toBeGreaterThan(0);
    expect(payload.extensions).toEqual([]);
  });
});

describe("/.well-known/activitypub.json route", () => {
  it("serves metadata", async () => {
    const response = await activityPubMetadataRoutes.request(
      "/.well-known/activitypub.json",
      {},
      { INSTANCE_DOMAIN: "example.com" } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.node).toBe("https://example.com");
    expect(Array.isArray(body.contexts)).toBe(true);
    expect(body.contexts.length).toBeGreaterThan(0);
  });
});
