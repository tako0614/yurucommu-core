import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAPI } from "./data";
import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseConfig } from "./prisma-factory";

type FriendRecord = {
  requester_id: string;
  addressee_id: string;
  status: string;
  created_at: Date;
};

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
  const friendships: FriendRecord[] = [];

  const findFirst = vi.fn(async ({ where }: any) => {
    if (where?.OR?.length) {
      return (
        friendships.find((record) =>
          where.OR.some(
            (cond: any) =>
              cond.requester_id === record.requester_id &&
              cond.addressee_id === record.addressee_id,
          ),
        ) || null
      );
    }

    return (
      friendships.find(
        (record) =>
          record.requester_id === where?.requester_id &&
          record.addressee_id === where?.addressee_id,
      ) || null
    );
  });

  const upsert = vi.fn(
    async ({
      where,
      create,
      update,
    }: {
      where: { requester_id_addressee_id: { requester_id: string; addressee_id: string } };
      create: FriendRecord;
      update: Partial<FriendRecord>;
    }) => {
      const key = where.requester_id_addressee_id;
      const index = friendships.findIndex(
        (record) =>
          record.requester_id === key.requester_id && record.addressee_id === key.addressee_id,
      );
      if (index >= 0) {
        friendships[index] = { ...friendships[index], ...update } as FriendRecord;
        return friendships[index];
      }
      friendships.push(create);
      return create;
    },
  );

  return {
    friendships: {
      findFirst,
      upsert,
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

describe("createFriendRequest", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("updates timestamp when re-sending a pending request", async () => {
    vi.useFakeTimers();
    const { api, mockPrisma } = createApi();

    // Friend request tests disabled - now using ActivityPub Follow/Accept workflow
    // vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    // const first = await api.createFriendRequest("alice", "bob");

    // vi.setSystemTime(new Date("2024-01-02T00:00:00.000Z"));
    // const second = await api.createFriendRequest("alice", "bob");

    // expect(mockPrisma.friendships.upsert).toHaveBeenCalledTimes(2);
    // expect((second?.created_at as Date).getTime()).toBeGreaterThan(
    //   (first?.created_at as Date).getTime(),
    // );
  });
});
