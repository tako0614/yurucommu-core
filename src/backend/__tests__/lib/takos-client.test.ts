import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { encrypt } from "../../lib/crypto.ts";
import { getTakosClient } from "../../lib/takos-client.ts";
import type { Database } from "../../../db/index.ts";
import type { Env } from "../../types.ts";

const KEY = "22".repeat(32);

function createDbMock() {
  const updates: unknown[] = [];
  const db = {
    update: () => ({
      set: (value: unknown) => {
        updates.push(value);
        return {
          where: () => Promise.resolve(undefined),
        };
      },
    }),
  } as unknown as Database;

  return { db, updates };
}

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    APP_URL: "https://yuru.example",
    TAKOS_URL: "https://takos.example",
    ENCRYPTION_KEY: KEY,
    ...overrides,
  } as Env;
}

Deno.test("takos client - clears Takos auth when access token cannot be decrypted", async () => {
  const { db, updates } = createDbMock();

  const client = await getTakosClient(createEnv(), db, {
    id: "session-1",
    provider: "takos",
    providerAccessToken: "malformed-token",
    providerRefreshToken: null,
    providerTokenExpiresAt: null,
  });

  assertEquals(client, null);
  assertEquals(updates.length, 1);
  assertObjectMatch(updates[0] as Record<string, unknown>, {
    provider: null,
    providerAccessToken: null,
    providerRefreshToken: null,
    providerTokenExpiresAt: null,
  });
});

Deno.test("takos client - clears Takos auth when refresh token cannot be decrypted", async () => {
  const { db, updates } = createDbMock();
  const accessToken = await encrypt("access-token", KEY);

  const client = await getTakosClient(createEnv(), db, {
    id: "session-2",
    provider: "takos",
    providerAccessToken: accessToken,
    providerRefreshToken: "bad-refresh-token",
    providerTokenExpiresAt: null,
  });

  assertEquals(client, null);
  assertEquals(updates.length, 1);
  assertObjectMatch(updates[0] as Record<string, unknown>, {
    provider: null,
    providerAccessToken: null,
    providerRefreshToken: null,
    providerTokenExpiresAt: null,
  });
});

Deno.test("takos client - missing encryption key fails closed without deleting stored auth", async () => {
  const { db, updates } = createDbMock();
  const accessToken = await encrypt("access-token", KEY);

  const client = await getTakosClient(
    createEnv({ ENCRYPTION_KEY: undefined }),
    db,
    {
      id: "session-3",
      provider: "takos",
      providerAccessToken: accessToken,
      providerRefreshToken: null,
      providerTokenExpiresAt: null,
    },
  );

  assertEquals(client, null);
  assertEquals(updates.length, 0);
});
