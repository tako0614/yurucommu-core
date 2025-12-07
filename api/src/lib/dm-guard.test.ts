import { describe, expect, it } from "vitest";
import { isEndpointDisabled } from "./dm-guard";

describe("isEndpointDisabled", () => {
  const config = {
    api: { disabled_api_endpoints: ["/dm/*", "/-/internal/*", "dm/send"] },
  } as any;

  it("matches dm routes when wildcard patterns are configured", () => {
    expect(isEndpointDisabled(config, "/dm/threads")).toBe(true);
    expect(isEndpointDisabled(config, "/dm/with/alice")).toBe(true);
    expect(isEndpointDisabled(config, "/dm/send")).toBe(true);
  });

  it("treats patterns without a leading slash as rooted paths", () => {
    const withoutSlash = { api: { disabled_api_endpoints: ["dm/threads"] } } as any;
    expect(isEndpointDisabled(withoutSlash, "/dm/threads")).toBe(true);
  });

  it("returns false when no pattern matches", () => {
    expect(isEndpointDisabled(config, "/posts")).toBe(false);
    expect(isEndpointDisabled(config, "/communities/1")).toBe(false);
  });
});
