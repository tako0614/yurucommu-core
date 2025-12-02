import { describe, expect, it } from "vitest";
import { validateUiContractAgainstManifest, type UiContract } from "./ui-contract";
import type { AppManifest } from "./types";

describe("validateUiContractAgainstManifest", () => {
  it("surfaces reachability warnings when contract violates Plan 7.1 rules", () => {
    const manifest: AppManifest = {
      schemaVersion: "1.0.0",
      routes: [],
      views: {
        screens: [
          { id: "screen.home", layout: { type: "Column" } },
          { id: "screen.profile", layout: { type: "Column" } },
        ],
        insert: [],
      },
      ap: { handlers: [] },
      data: { collections: {} },
      storage: { buckets: {} },
    };

    const contract: UiContract = {
      schema_version: "1.0",
      screens: [
        { id: "screen.home", steps_from_home: 0 },
        { id: "screen.profile", steps_from_home: 3 },
      ],
      actions: [
        {
          id: "action.open_composer",
          available_on: ["screen.community"],
          max_steps_from_home: 2,
        },
      ],
    };

    const issues = validateUiContractAgainstManifest(manifest, contract, "test-contract");
    expect(issues.some((issue) => issue.message.includes("screen.profile must be reachable within 2 steps"))).toBe(
      true,
    );
    expect(
      issues.some((issue) =>
        issue.message.includes("action.open_composer must be available on screen.home"),
      ),
    ).toBe(true);
  });
});
