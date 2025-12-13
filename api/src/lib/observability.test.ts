import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpError } from "@takos/platform/server";
import { mapErrorToResponse } from "./observability";

describe("mapErrorToResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns structured HttpError payload and request id", async () => {
    const response = mapErrorToResponse(
      new HttpError(404, "OBJECT_NOT_FOUND", "The requested object does not exist", { objectId: "abc123" }),
      { requestId: "req_123", env: { ENVIRONMENT: "production" } },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBe("req_123");

    const json = await response.json();
    expect(json).toMatchObject({
      status: 404,
      code: "OBJECT_NOT_FOUND",
      message: "The requested object does not exist",
      details: { objectId: "abc123", requestId: "req_123" },
    });
  });

  it("hides unexpected error details in production", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = mapErrorToResponse(new Error("boom"), { requestId: "req_456", env: { ENVIRONMENT: "production" } });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    });
  });

  it("exposes unexpected error message in development", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = mapErrorToResponse(new Error("boom"), { requestId: "req_789", env: { ENVIRONMENT: "development" } });
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.message).toBe("Error: boom");
    expect(json.details.requestId).toBe("req_789");
  });
});
