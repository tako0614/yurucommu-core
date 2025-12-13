import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../data", () => ({
  makeData: vi.fn(() => ({})),
}));

vi.mock("@takos/platform/server/session", () => ({
  authenticateSession: vi.fn(async () => null),
}));

vi.mock("@takos/platform/server", async () => {
  const actual = await vi.importActual<any>("@takos/platform/server");
  return {
    ...actual,
    authenticateJWT: vi.fn(async () => null),
    releaseStore: vi.fn(async () => undefined),
  };
});

import { auth } from "./auth";
import { ErrorCodes } from "../lib/error-codes";

const base64Url = (input: string): string =>
  Buffer.from(input, "utf-8").toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

const buildJwt = (payload: Record<string, unknown>): string => {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  return `${header}.${body}.signature`;
};

describe("auth middleware error codes", () => {
  it("returns TOKEN_EXPIRED when Bearer token is expired", async () => {
    const app = new Hono();
    app.get("/secure", auth as any, (c) => c.json({ ok: true }));

    const expired = buildJwt({ sub: "user", exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await app.request("/secure", { headers: { Authorization: `Bearer ${expired}` } }, {} as any);
    expect(res.status).toBe(401);
    const body = await res.json<any>();
    expect(body.code).toBe(ErrorCodes.TOKEN_EXPIRED);
  });

  it("returns INVALID_TOKEN when Bearer token is invalid", async () => {
    const app = new Hono();
    app.get("/secure", auth as any, (c) => c.json({ ok: true }));

    const res = await app.request("/secure", { headers: { Authorization: "Bearer not-a-jwt" } }, {} as any);
    expect(res.status).toBe(401);
    const body = await res.json<any>();
    expect(body.code).toBe(ErrorCodes.INVALID_TOKEN);
  });
});

