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
