import { describe, expect, it } from "vitest";
import { fail } from "./response-helpers.js";

const makeContext = () =>
  ({
    json: (body: any, status: number, headers?: Record<string, string>) =>
      new Response(JSON.stringify(body), {
        status,
        headers,
      }),
  }) as any;

describe("response helpers", () => {
  it("maps 507 to STORAGE_LIMIT_EXCEEDED by default", async () => {
    const res = fail(makeContext(), "storage exceeded", 507);
    expect(res.status).toBe(507);
    const body: any = await res.json();
    expect(body.code).toBe("STORAGE_LIMIT_EXCEEDED");
  });

  it("maps 408 to SANDBOX_TIMEOUT by default", async () => {
    const res = fail(makeContext(), "timeout", 408);
    expect(res.status).toBe(408);
    const body: any = await res.json();
    expect(body.code).toBe("SANDBOX_TIMEOUT");
  });

  it("maps 502 to AI_PROVIDER_ERROR by default", async () => {
    const res = fail(makeContext(), "provider error", 502);
    expect(res.status).toBe(502);
    const body: any = await res.json();
    expect(body.code).toBe("AI_PROVIDER_ERROR");
  });

  it("maps 400 to INVALID_INPUT by default", async () => {
    const res = fail(makeContext(), "bad", 400);
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.code).toBe("INVALID_INPUT");
  });
});

