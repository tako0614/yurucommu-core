import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@takos/platform/server";
import { mapErrorToResponse } from "./observability";

describe("mapErrorToResponse logging", () => {
  it("logs warn for HttpError 4xx", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = mapErrorToResponse(new HttpError(400, "INVALID_INPUT", "bad"), { requestId: "r1" });
    expect(res.status).toBe(400);
    expect(warnSpy).toHaveBeenCalled();
    const payload = JSON.parse(String(warnSpy.mock.calls[0]?.[0] ?? "{}"));
    expect(payload).toMatchObject({
      level: "warn",
      event: "request.error",
      requestId: "r1",
      details: { status: 400, code: "INVALID_INPUT" },
    });
    warnSpy.mockRestore();
  });

  it("logs error for unhandled exceptions", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = mapErrorToResponse(new Error("boom"), { requestId: "r2" });
    expect(res.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
    const payload = JSON.parse(String(errorSpy.mock.calls[0]?.[0] ?? "{}"));
    expect(payload).toMatchObject({
      level: "error",
      event: "request.error",
      requestId: "r2",
      details: { status: 500, code: "INTERNAL_ERROR" },
    });
    errorSpy.mockRestore();
  });
});

