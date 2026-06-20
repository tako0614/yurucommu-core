import { describe, expect, it } from "bun:test";
import { decodeApIdParam } from "./routeApId.ts";

const AP = "https://test.yurucommu.com/ap/objects/abc123";
const REMOTE = "https://mastodon.social/users/x/statuses/9";

describe("decodeApIdParam", () => {
  it("decodes an in-session, fully percent-encoded path segment", () => {
    expect(decodeApIdParam(encodeURIComponent(AP))).toBe(AP);
  });

  it("reassembles a full-page-load value whose %2F was decoded to /", () => {
    // What the server hands the splat route after a refresh of /post/<enc>:
    // %2F -> "/", "//" collapses to "/", but %3A (the colon) survives.
    expect(
      decodeApIdParam("https%3A/test.yurucommu.com/ap/objects/abc123"),
    ).toBe(AP);
  });

  it("repairs an already-decoded value with a collapsed scheme separator", () => {
    expect(decodeApIdParam("https:/test.yurucommu.com/ap/objects/abc123")).toBe(
      AP,
    );
  });

  it("passes an already-correct absolute URL through unchanged", () => {
    expect(decodeApIdParam(AP)).toBe(AP);
  });

  it("handles remote ids the same way", () => {
    expect(decodeApIdParam(encodeURIComponent(REMOTE))).toBe(REMOTE);
    expect(decodeApIdParam("https%3A/mastodon.social/users/x/statuses/9")).toBe(
      REMOTE,
    );
  });

  it("returns empty string for missing input", () => {
    expect(decodeApIdParam(undefined)).toBe("");
    expect(decodeApIdParam(null)).toBe("");
    expect(decodeApIdParam("")).toBe("");
  });

  it("does not corrupt a value that has no scheme", () => {
    expect(decodeApIdParam("tako")).toBe("tako");
  });
});
