import { describe, expect, it } from "vitest";
import { createInMemoryAppSource, loadAppManifest } from "./manifest-loader";

describe("App Manifest loader", () => {
  it("merges manifest fragments with default layout", async () => {
    const source = createInMemoryAppSource({
      "manifest.json": JSON.stringify({ schema_version: "1.0", version: "1.2.3" }),
      "routes/core.json": JSON.stringify({
        schema_version: "1.0",
        routes: [
          {
            id: "home_timeline",
            method: "GET",
            path: "/api/core/home",
            auth: true,
            handler: "homeTimeline",
          },
        ],
      }),
      "views/home.json": JSON.stringify({
        schema_version: "1.0",
        screens: [
          {
            id: "screen.home",
            route: "/",
            title: "Home",
            layout: { type: "Stack" },
          },
        ],
      }),
      "views/home-insert.json": JSON.stringify({
        schema_version: "1.0",
        insert: [
          {
            screen: "screen.home",
            position: "right-sidebar",
            order: 10,
            node: { type: "Panel" },
          },
        ],
      }),
      "ap/core.json": JSON.stringify({
        handlers: [
          { id: "ap_question_to_poll", match: { type: ["Question"] }, handler: "mapQuestionToPollView" },
        ],
      }),
      "data/notes.json": JSON.stringify({
        collections: {
          "app:notes": { engine: "sqlite" },
        },
      }),
      "storage/assets.json": JSON.stringify({
        buckets: {
          "app:assets": { base_path: "assets/" },
        },
      }),
    });

    const result = await loadAppManifest({ source });
    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors).toHaveLength(0);
    expect(result.issues.some((issue) => issue.message.includes("minor version differs"))).toBe(true);
    expect(result.manifest?.schemaVersion).toBe("1.0");
    expect(result.manifest?.version).toBe("1.2.3");
    expect(result.manifest?.routes[0]).toMatchObject({ id: "home_timeline", auth: true });
    expect(result.manifest?.views.screens[0].id).toBe("screen.home");
    expect(result.manifest?.views.insert[0].screen).toBe("screen.home");
    expect(result.manifest?.ap.handlers[0].id).toBe("ap_question_to_poll");
    expect(result.manifest?.data.collections["app:notes"]).toBeDefined();
    expect(result.manifest?.storage.buckets["app:assets"]).toBeDefined();
  });

  it("honors layout overrides and reports structural errors", async () => {
    const source = createInMemoryAppSource({
      "manifest.json": JSON.stringify({
        schema_version: "1.0",
        layout: {
          base_dir: "custom",
          routes_dir: "r",
          views_dir: "v",
          ap_dir: "ap",
          data_dir: "data",
          storage_dir: "storage",
        },
      }),
      "custom/r/routes-a.json": JSON.stringify({
        schema_version: "1.0",
        routes: [{ id: "dup", method: "GET", path: "/one", handler: "handlerA" }],
      }),
      "custom/r/routes-b.json": JSON.stringify({
        schema_version: "1.0",
        routes: [{ id: "dup", method: "POST", path: "/two", handler: "handlerB" }],
      }),
      "custom/v/screens.json": JSON.stringify({
        schema_version: "1.0",
        screens: [{ id: "screen.one", route: "/one", layout: {} }],
      }),
      "custom/v/inserts.json": JSON.stringify({
        schema_version: "1.0",
        insert: [{ screen: "missing", position: "sidebar", node: {} }],
      }),
      "custom/ap/handlers.json": JSON.stringify({
        handlers: [{ id: "ap-1", handler: "notRegistered" }],
      }),
      "custom/data/collections.json": JSON.stringify({
        collections: { "app:first": { engine: "sqlite" } },
      }),
      "custom/storage/buckets.json": JSON.stringify({
        buckets: { "app:bucket": { base_path: "b/" } },
      }),
    });

    const result = await loadAppManifest({ source, availableHandlers: ["handlerA"] });
    expect(result.manifest).toBeUndefined();
    expect(result.issues.some((issue) => issue.message.includes("Duplicate route id"))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes("Insert references unknown screen"))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('Handler "handlerB"'))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('Handler "notRegistered"'))).toBe(true);
  });

  it("validates schema fields for invalid entries", async () => {
    const source = createInMemoryAppSource({
      "manifest.json": JSON.stringify({ schema_version: "1.0" }),
      "routes/invalid.json": JSON.stringify({
        schema_version: "1.0",
        routes: [{ id: "", method: "FETCH", path: "api", handler: "" }],
      }),
      "views/invalid.json": JSON.stringify({
        schema_version: "1.0",
        screens: [{ id: "", layout: "nope" }],
        insert: [{ screen: "screen.missing", position: "", node: null }],
      }),
      "ap/invalid.json": JSON.stringify({
        handlers: [{ id: "", handler: "" }],
      }),
      "data/invalid.json": JSON.stringify({
        collections: { "app:notes": "not-object" },
      }),
      "storage/invalid.json": JSON.stringify({
        buckets: { "app:assets": [] },
      }),
    });

    const result = await loadAppManifest({ source });
    expect(result.manifest).toBeUndefined();
    expect(result.issues.some((issue) => issue.path === "routes[0].path")).toBe(true);
    expect(result.issues.some((issue) => issue.path === "routes[0].handler")).toBe(true);
    expect(result.issues.some((issue) => issue.path === "screens[0].layout")).toBe(true);
    expect(result.issues.some((issue) => issue.path === "insert[0].position")).toBe(true);
    expect(result.issues.some((issue) => issue.path === "collections.app:notes")).toBe(true);
    expect(result.issues.some((issue) => issue.path === "buckets.app:assets")).toBe(true);
  });

  it("requires schema_version on routes and views fragments", async () => {
    const source = createInMemoryAppSource({
      "manifest.json": JSON.stringify({ schema_version: "1.10" }),
      "routes/no-version.json": JSON.stringify({
        routes: [],
      }),
      "views/no-version.json": JSON.stringify({
        screens: [{ id: "screen.missing", layout: {} }],
      }),
    });

    const result = await loadAppManifest({ source });
    expect(result.manifest).toBeUndefined();
    expect(
      result.issues.some(
        (issue) => issue.path === "schema_version" && issue.file?.includes("routes/no-version"),
      ),
    ).toBe(true);
    expect(
      result.issues.some(
        (issue) => issue.path === "schema_version" && issue.file?.includes("views/no-version"),
      ),
    ).toBe(true);
  });

  it("rejects reserved routes and moved core routes", async () => {
    const source = createInMemoryAppSource({
      "manifest.json": JSON.stringify({ schema_version: "1.10" }),
      "views/reserved.json": JSON.stringify({
        schema_version: "1.10",
        screens: [
          { id: "screen.custom_login", route: "/login", layout: {} },
          { id: "screen.home", route: "/welcome", layout: {} },
        ],
      }),
    });

    const result = await loadAppManifest({ source });
    expect(result.manifest).toBeUndefined();
    expect(result.issues.some((issue) => issue.message.includes("Reserved route"))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('Core screen "screen.home"'))).toBe(true);
  });

  it("rejects reserved /-/ paths and core route overlaps", async () => {
    const source = createInMemoryAppSource({
      "manifest.json": JSON.stringify({ schema_version: "1.10" }),
      "routes/bad.json": JSON.stringify({
        schema_version: "1.10",
        routes: [{ id: "actor_override", method: "GET", path: "/@alice", handler: "noop" }],
      }),
      "views/bad.json": JSON.stringify({
        schema_version: "1.10",
        screens: [
          { id: "screen.bad_user", route: "/@alice", layout: {} },
          { id: "screen.bad_reserved", route: "/-/anything", layout: {} },
        ],
      }),
    });

    const result = await loadAppManifest({ source });
    expect(result.manifest).toBeUndefined();
    expect(result.issues.some((issue) => issue.message.includes('Core route "/@:handle"'))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('Reserved route "/-/anything"'))).toBe(true);
  });
});
