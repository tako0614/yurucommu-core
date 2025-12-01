import { describe, expect, it } from "vitest";
import { resolveDevDataIsolation } from "./dev-data-isolation";

describe("resolveDevDataIsolation", () => {
  it("is a no-op when not in dev context", () => {
    const result = resolveDevDataIsolation({ TAKOS_CONTEXT: "prod" });

    expect(result.required).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails fast in dev context when required bindings are missing", () => {
    const result = resolveDevDataIsolation({
      TAKOS_CONTEXT: "dev",
      TAKOS_REQUIRE_DEV_DATA_ISOLATION: "true",
    });

    expect(result.required).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.join(" ")).toContain("missing D1 binding");
  });

  it("uses dedicated dev bindings when provided", () => {
    const devDb = { name: "dev-db" };
    const devMedia = { name: "dev-media" };
    const devKv = { name: "dev-kv" };

    const result = resolveDevDataIsolation({
      TAKOS_CONTEXT: "dev",
      TAKOS_REQUIRE_DEV_DATA_ISOLATION: "true",
      DEV_DB: devDb,
      DEV_MEDIA: devMedia,
      DEV_KV: devKv,
    });

    expect(result.required).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.resolved.db).toBe(devDb);
    expect(result.resolved.media).toBe(devMedia);
    expect(result.resolved.kv).toBe(devKv);
    expect(result.warnings).toHaveLength(0);
  });

  it("emits warnings when dev bindings intentionally point at prod names", () => {
    const result = resolveDevDataIsolation({
      TAKOS_CONTEXT: "dev",
      TAKOS_REQUIRE_DEV_DATA_ISOLATION: "true",
      DEV_D1_BINDING: "DB",
      DEV_R2_BINDING: "MEDIA",
      DEV_KV_BINDING: "KV",
      DB: {},
      MEDIA: {},
      KV: {},
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.join(" ")).toContain("not shared with prod");
  });
});
