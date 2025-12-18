import { afterEach, describe, expect, it, vi } from "vitest";
import appIde from "./app-ide";
import { createJWT } from "@takos/platform/server";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";

const defaultFactory = getDefaultDataFactory();

const testUser = { id: "testuser", handle: "testuser", display_name: "Test User" };
const jwtSecret = "secret";

const buildEnv = (overrides?: Record<string, unknown>) => ({
  TAKOS_CONTEXT: "dev",
  DEV_DB: {},
  DEV_MEDIA: {},
  DEV_KV: {},
  ...overrides,
});

const buildStore = () =>
  ({
    getUser: vi.fn().mockResolvedValue(testUser),
    getUserJwtSecret: vi.fn().mockResolvedValue(jwtSecret),
    setUserJwtSecret: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
    disconnect: vi.fn(),
  }) as any;

const authHeaders = async () => ({
  Authorization: `Bearer ${await createJWT(testUser.id, jwtSecret)}`,
  "content-type": "application/json",
});

describe("/-/dev/ide", () => {
  afterEach(() => {
    setBackendDataFactory(defaultFactory);
    vi.restoreAllMocks();
  });

  it("serves built-in types", async () => {
    setBackendDataFactory(() => buildStore());

    const res = await appIde.request(
      "/-/dev/ide/types",
      { method: "GET", headers: await authHeaders() },
      buildEnv({ TAKOS_PLAN: "test", TAKOS_PLAN_FEATURES: "app_customization", TAKOS_PLAN_LIMITS: {} }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data?.files?.length).toBeGreaterThan(0);
    const files = json.data?.files ?? [];
    const handler = files.find((f: any) => f?.path === "takos/handler.d.ts");
    expect(handler?.content).toContain('declare module "takos/handler"');
    expect(handler?.content).toContain("OpenAICompatibleClient");
    expect(handler?.content).not.toContain("ActivityPubAPI");
  });

  it("returns diagnostics for invalid code", async () => {
    setBackendDataFactory(() => buildStore());

    const res = await appIde.request(
      "/-/dev/ide/diagnostics",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ path: "app-main.ts", content: "export const x = ;" }),
      },
      buildEnv({ TAKOS_PLAN: "test", TAKOS_PLAN_FEATURES: "app_customization", TAKOS_PLAN_LIMITS: {} }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(Array.isArray(json.data?.diagnostics)).toBe(true);
    expect(json.data?.diagnostics?.length).toBeGreaterThan(0);
    expect(json.data?.diagnostics?.[0]?.severity).toBe("error");
  });

  it("returns completions for local symbols", async () => {
    setBackendDataFactory(() => buildStore());

    const code = "export const alpha = 1;\nal";
    const res = await appIde.request(
      "/-/dev/ide/completions",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ path: "app-main.ts", content: code, position: { offset: code.length } }),
      },
      buildEnv({ TAKOS_PLAN: "test", TAKOS_PLAN_FEATURES: "app_customization", TAKOS_PLAN_LIMITS: {} }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(Array.isArray(json.data?.items)).toBe(true);
    expect(json.data?.items?.some((item: any) => item?.label === "alpha")).toBe(true);
  });
});
