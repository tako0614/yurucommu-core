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
      buildEnv({ PLAN: "pro" }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data?.files?.length).toBeGreaterThan(0);
    expect(json.data?.files?.[0]?.content).toContain("declare module");
  });
});

