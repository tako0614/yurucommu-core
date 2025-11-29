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
