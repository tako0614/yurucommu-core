import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadMetadata = () => import("../profile/activitypub-metadata.js");
const loadRoutes = () => import("./activitypub-metadata.js");

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.doUnmock("../../../takos-profile.json");
});

describe("ActivityPub metadata", () => {
  it("returns http(s) contexts and extensions from takos-profile and app manifest", async () => {
    const { getActivityPubMetadata } = await loadMetadata();
    const metadata = getActivityPubMetadata();
    expect(metadata.contexts.length).toBeGreaterThan(0);
    metadata.contexts.forEach((value) => {
      expect(value.startsWith("http")).toBe(true);
    });
    expect(metadata.extensions.length).toBeGreaterThan(0);
    expect(metadata.extensions.some((ext) => ext.id === "takos-core-ap")).toBe(true);
    expect(metadata.extensions.some((ext) => ext.id === "ap_note_to_post")).toBe(true);
    metadata.extensions.forEach((ext) => {
      if (ext.spec_url) {
        expect(ext.spec_url.startsWith("http")).toBe(true);
      }
    });
    expect(metadata.distro.name).toBeTruthy();
  });

  it("builds payload with node url, contexts, and extensions", async () => {
    const { buildActivityPubWellKnown } = await loadMetadata();
    const payload = buildActivityPubWellKnown("example.com");
    expect(payload.node).toBe("https://example.com");
    expect(payload.contexts.length).toBeGreaterThan(0);
    expect(payload.extensions.some((ext) => ext.id === "takos-core-ap")).toBe(true);
  });

  it("rejects non-http extension spec urls", async () => {
    vi.doMock("../../../takos-profile.json", () => ({
      default: {
        name: "takos-oss",
        version: "0.0.1",
        base: { core_version: "1.0.0" },
        activitypub: {
          contexts: ["https://example.com/context.jsonld"],
          profile: "https://example.com/docs",
          extensions: [{ id: "bad-ext", spec_url: "ftp://example.com/spec" }],
        },
      },
    }));
    await expect(import("../profile/activitypub-metadata.js")).rejects.toThrow(/spec_url/);
  });
});

describe("/.well-known/activitypub.json route", () => {
  it("serves metadata with caching", async () => {
    const { default: activityPubMetadataRoutes } = await loadRoutes();
    const response = await activityPubMetadataRoutes.request(
      "/.well-known/activitypub.json",
      {},
      { INSTANCE_DOMAIN: "example.com" } as any,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300, immutable");
    const body = (await response.json()) as Record<string, any>;
    expect(body.node).toBe("https://example.com");
    expect(Array.isArray(body.contexts)).toBe(true);
    expect(body.contexts.length).toBeGreaterThan(0);
    expect(Array.isArray(body.extensions)).toBe(true);
    expect(body.extensions.length).toBeGreaterThan(0);
  });
});
