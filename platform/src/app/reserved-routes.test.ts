import { describe, expect, it } from "vitest";
import { isReservedHttpPath } from "./reserved-routes";

describe("reserved routes", () => {
  it("detects core-reserved HTTP paths", () => {
    expect(isReservedHttpPath("/login")).toBe(true);
    expect(isReservedHttpPath("/logout")).toBe(true);
    expect(isReservedHttpPath("/-/health")).toBe(true);
    expect(isReservedHttpPath("/-/core")).toBe(true);
    expect(isReservedHttpPath("/-/core/recovery")).toBe(true);
    expect(isReservedHttpPath("/auth/login")).toBe(true);
    expect(isReservedHttpPath("/auth/logout")).toBe(true);
    expect(isReservedHttpPath("/.well-known/webfinger")).toBe(true);
  });

  it("does not reserve unrelated paths", () => {
    expect(isReservedHttpPath("/api/posts")).toBe(false);
    expect(isReservedHttpPath("/app/settings")).toBe(false);
    expect(isReservedHttpPath("/-custom")).toBe(false);
  });
});
