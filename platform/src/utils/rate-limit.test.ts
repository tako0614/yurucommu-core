import { describe, expect, it, vi } from "vitest";
import { buildRateLimitExceededResponse } from "./rate-limit.js";

const makeContext = () =>
  ({
    json: (body: any, status: number, headers?: Record<string, string>) =>
      new Response(JSON.stringify(body), {
        status,
        headers,
      }),
  }) as any;

describe("rate-limit utils", () => {
  it("returns unified ErrorResponse with optional Retry-After header", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000 * 1000);
    const res = buildRateLimitExceededResponse(
      makeContext(),
      "Rate limit exceeded",
      { key: "k", limit: 10, reset: 1_000_100 },
      1_000_100,
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("100");
    const body: any = await res.json();
    expect(body).toEqual({
      status: 429,
      code: "RATE_LIMIT_EXCEEDED",
      message: "Rate limit exceeded",
      details: { key: "k", limit: 10, reset: 1_000_100 },
    });

    vi.restoreAllMocks();
  });
});

