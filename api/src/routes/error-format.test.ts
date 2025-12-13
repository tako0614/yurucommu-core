import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mapErrorToResponse } from "../lib/observability";
import appPreviewRoutes from "./app-preview";
import appDebugRoutes from "./app-debug";

vi.mock("../middleware/auth", () => ({
  auth: async (_c: any, next: any) => next(),
}));

vi.mock("../lib/workspace-guard", () => ({
  requireHumanSession: async (_c: any, next: any) => next(),
  requireWorkspacePlan: async (_c: any, next: any) => next(),
}));

describe("error response format", () => {
  it("app preview returns structured UNAUTHORIZED", async () => {
    const app = new Hono();
    app.onError((error) => mapErrorToResponse(error, { requestId: "test", env: { ENVIRONMENT: "development" } }));
    app.route("/", appPreviewRoutes as any);

    const res = await app.request(
      "/-/app/preview/screen",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
      {} as any,
    );

    expect(res.status).toBe(401);
    const body = await res.json<any>();
    expect(body).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(typeof body.message).toBe("string");
  });

  it("app debug returns structured INVALID_OPTION", async () => {
    const app = new Hono();
    app.onError((error) => mapErrorToResponse(error, { requestId: "test", env: { ENVIRONMENT: "development" } }));
    app.route("/", appDebugRoutes as any);

    const res = await app.request(
      "/-/app/debug/run",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "nope" }) },
      {} as any,
    );

    expect(res.status).toBe(400);
    const body = await res.json<any>();
    expect(body).toMatchObject({ status: 400, code: "INVALID_OPTION" });
    expect(typeof body.message).toBe("string");
  });
});

