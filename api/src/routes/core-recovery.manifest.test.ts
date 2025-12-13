import { describe, it, expect } from "vitest";
import { createInMemoryAppSource, loadAppManifest } from "@takos/platform/app/manifest-loader";

import takosAppJson from "../../../app/manifest.json";
import screensCoreJson from "../../../app/views/screens-core.json";
import insertCoreJson from "../../../app/views/insert-core.json";
import apCoreJson from "../../../app/ap/core.json";

describe("core recovery static app manifest source", () => {
  it("loads core app manifest fragments with no errors", async () => {
    const source = createInMemoryAppSource({
      "app/manifest.json": JSON.stringify(takosAppJson),
      "app/views/screens-core.json": JSON.stringify(screensCoreJson),
      "app/views/insert-core.json": JSON.stringify(insertCoreJson),
      "app/ap/core.json": JSON.stringify(apCoreJson),
    });

    const result = await loadAppManifest({
      rootDir: "app",
      source,
      availableHandlers: new Set(["mapActivityNote"]),
    });

    expect(result.issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    expect(result.manifest?.ap.handlers.length).toBeGreaterThan(0);
  });
});

