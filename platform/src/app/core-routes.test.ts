import { describe, expect, it } from "vitest";
import { findCoreRouteOwner } from "./core-routes";

describe("core-routes", () => {
  it("matches both patterns and concrete paths", () => {
    expect(findCoreRouteOwner("/")).toEqual({ screenId: "screen.home", path: "/" });
    expect(findCoreRouteOwner("/onboarding")).toEqual({
      screenId: "screen.onboarding",
      path: "/onboarding",
    });
    expect(findCoreRouteOwner("/@alice")).toEqual({
      screenId: "screen.user_profile",
      path: "/@:handle",
    });
  });

  it("returns null for non-core routes", () => {
    expect(findCoreRouteOwner("/api/posts")).toBeNull();
    expect(findCoreRouteOwner("/-custom")).toBeNull();
  });
});

