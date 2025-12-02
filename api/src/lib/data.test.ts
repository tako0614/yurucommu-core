import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAPI } from "./data";
import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseConfig } from "./prisma-factory";

const createMockDb = (): D1Database =>
  ({
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: [] }),
        run: async () => ({}),
      }),
      all: async () => ({ results: [] }),
      run: async () => ({}),
    }),
  }) as unknown as D1Database;

const createMockPrisma = () => {
  // ActivityPub-based follow/friend relationships
  const ap_follows: any[] = [];
  const ap_followers: any[] = [];

  return {
    ap_follows: {
      findMany: vi.fn(async () => ap_follows),
      findFirst: vi.fn(async () => null),
    },
    ap_followers: {
      findMany: vi.fn(async () => ap_followers),
      findFirst: vi.fn(async () => null),
    },
  };
};

const createApi = () => {
  const mockPrisma = createMockPrisma();
  const config: DatabaseConfig = {
    DB: createMockDb(),
    createPrismaClient: () => mockPrisma as any,
  };
  const api = createDatabaseAPI(config);
  return { api, mockPrisma };
};

const createApiWithPrisma = (prisma: any) => {
  const config: DatabaseConfig = {
    DB: createMockDb(),
    createPrismaClient: () => prisma as any,
  };
  return createDatabaseAPI(config);
};

describe("areFriends", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when users are not mutual followers", async () => {
    const { api } = createApi();
    // Friends are now determined by mutual ActivityPub Follow relationships
    const result = await api.areFriends("alice", "bob");
    expect(result).toBe(false);
  });
});

describe("listFriends", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when user has no mutual follows", async () => {
    const { api } = createApi();
    const result = await api.listFriends("alice");
    expect(result).toEqual([]);
  });
});

describe("ActivityPub follow persistence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the composite key when upserting follows", async () => {
    const upsert = vi.fn(async (args: any) => args);
    const api = createApiWithPrisma({
      ap_follows: { upsert },
    });

    const createdAt = new Date("2024-01-01T00:00:00.000Z");
    await api.upsertApFollow({
      local_user_id: "alice",
      remote_actor_id: "https://remote.example/ap/users/bob",
      activity_id: "act-1",
      status: "pending",
      created_at: createdAt,
      accepted_at: null,
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0]?.[0] || {};
    expect(call.where).toEqual({
      local_user_id_remote_actor_id: {
        local_user_id: "alice",
        remote_actor_id: "https://remote.example/ap/users/bob",
      },
    });
    expect(call.update).toEqual({
      activity_id: "act-1",
      status: "pending",
      accepted_at: null,
    });
    expect(call.create).toMatchObject({
      local_user_id: "alice",
      remote_actor_id: "https://remote.example/ap/users/bob",
      activity_id: "act-1",
      status: "pending",
      created_at: createdAt,
      accepted_at: null,
    });
  });

  it("uses the composite key when upserting followers", async () => {
    const upsert = vi.fn(async (args: any) => args);
    const api = createApiWithPrisma({
      ap_followers: { upsert },
    });

    const createdAt = new Date("2024-02-02T00:00:00.000Z");
    await api.upsertApFollower({
      local_user_id: "bob",
      remote_actor_id: "https://remote.example/ap/users/alice",
      activity_id: "act-2",
      status: "pending",
      created_at: createdAt,
      accepted_at: null,
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0]?.[0] || {};
    expect(call.where).toEqual({
      local_user_id_remote_actor_id: {
        local_user_id: "bob",
        remote_actor_id: "https://remote.example/ap/users/alice",
      },
    });
  });
});

describe("queue health summaries", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calculates post plan delay and failure metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-02T00:10:00.000Z"));

    const prisma = {
      post_plans: {
        count: vi.fn(async (args: any) => {
          if (args?.where?.status === "scheduled" && args?.where?.post_id === null && args?.where?.scheduled_at) {
            return 2;
          }
          if (args?.where?.status === "scheduled") {
            return 3;
          }
          if (args?.where?.status === "failed") {
            return 1;
          }
          return 0;
        }),
        findFirst: vi.fn(async (args: any) => {
          if (args?.where?.status === "scheduled") {
            return { scheduled_at: new Date("2024-01-02T00:00:00.000Z") };
          }
          if (args?.where?.status === "failed") {
            return { updated_at: new Date("2024-01-01T23:50:00.000Z"), last_error: "boom" };
          }
          return null;
        }),
      },
    };

    const api = createApiWithPrisma(prisma);
    const result = await api.getPostPlanQueueHealth!();

    expect(result.scheduled).toBe(3);
    expect(result.due).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.oldest_due_at).toBe("2024-01-02T00:00:00.000Z");
    expect(result.max_delay_ms).toBe(10 * 60 * 1000);
    expect(result.last_failed_at).toBe("2024-01-01T23:50:00.000Z");
    expect(result.last_error).toBe("boom");
  });

  it("summarizes ActivityPub delivery backlog", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-10T12:00:00.000Z"));

    const prisma = {
      ap_delivery_queue: {
        count: vi.fn(async ({ where }: any) => {
          switch (where?.status) {
            case "pending":
              return 4;
            case "processing":
              return 1;
            case "failed":
              return 2;
            case "delivered":
              return 7;
            default:
              return 0;
          }
        }),
        findFirst: vi.fn(async ({ where }: any) => {
          if (Array.isArray(where?.status?.in) && where.status.in.includes("pending")) {
            return { created_at: new Date("2024-03-10T11:40:00.000Z") };
          }
          if (where?.status === "failed") {
            return {
              last_attempt_at: new Date("2024-03-10T11:50:00.000Z"),
              last_error: "timeout",
            };
          }
          return null;
        }),
      },
    };

    const api = createApiWithPrisma(prisma);
    const result = await api.getApDeliveryQueueHealth!();

    expect(result.pending).toBe(4);
    expect(result.processing).toBe(1);
    expect(result.failed).toBe(2);
    expect(result.delivered).toBe(7);
    expect(result.oldest_pending_at).toBe("2024-03-10T11:40:00.000Z");
    expect(result.max_delay_ms).toBe(20 * 60 * 1000);
    expect(result.last_failed_at).toBe("2024-03-10T11:50:00.000Z");
    expect(result.last_error).toBe("timeout");
  });
});
