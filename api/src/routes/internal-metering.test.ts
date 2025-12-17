import { describe, expect, it } from "vitest";
import internalMeteringRoutes from "./internal-metering";
import { createUsageTrackerFromEnv } from "../lib/usage-tracker";

function createMockKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

const getMetering = async (env: any, userId: string, token?: string) => {
  return internalMeteringRoutes.fetch(
    new Request(`http://takos.internal/-/internal/metering/users/${encodeURIComponent(userId)}`, {
      method: "GET",
      headers: token ? { "x-takos-internal-token": token } : undefined,
    }),
    env,
    {} as any,
  );
};

describe("/-/internal/metering/users/:userId", () => {
  it("rejects requests without a valid internal token", async () => {
    const env: any = { TAKOS_INTERNAL_TOKEN: "test-token" };
    const res = await getMetering(env, "u1");
    expect(res.status).toBe(403);
  });

  it("returns zero usage when KV is not configured", async () => {
    const env: any = { TAKOS_INTERNAL_TOKEN: "test-token" };
    const res = await getMetering(env, "u1", "test-token");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      data: {
        userId: "u1",
        ai: { monthRequests: 0 },
        dm: { dayMessages: 0 },
        ap: { minuteDeliveries: 0, dayDeliveries: 0 },
      },
    });
  });

  it("returns recorded usage from UsageTracker", async () => {
    const env: any = { TAKOS_INTERNAL_TOKEN: "test-token", APP_STATE: createMockKv() };
    const tracker = createUsageTrackerFromEnv(env);
    await tracker.recordAiRequest("u1", 5);
    await tracker.recordDmMessage("u1", 2);
    await tracker.recordApDelivery("u1", 7);

    const res = await getMetering(env, "u1", "test-token");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      data: {
        userId: "u1",
        ai: { monthRequests: 5 },
        dm: { dayMessages: 2 },
        ap: { minuteDeliveries: 7, dayDeliveries: 7 },
      },
    });
  });
});

