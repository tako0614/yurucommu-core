/**
 * GA regression (#5 BLOCKLIST-OUT): the operator blocklist must be enforced on
 * the OUTBOUND delivery side, not only inbound. A defederated domain/actor must
 * receive no outbound delivery:
 *   - planEndpointsFromActorCache (fanout to followers / community) drops
 *     blocked recipients BEFORE grouping endpoints, and
 *   - enqueueDeliveryToActor (DMs, Accept/Follow, targeted interactions) skips
 *     a blocked actor instead of enqueueing a resolve_actor job.
 */

import { expect, test } from "bun:test";

import { stub } from "#test/mock";
import type { Database } from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import { planEndpointsFromActorCache } from "../../lib/delivery/planner.ts";
import { enqueueDeliveryToActor } from "../../lib/delivery/queue.ts";

type ActorCacheRow = {
  apId: string;
  inbox: string;
  sharedInbox: string | null;
  lastFetchedAt: string;
};

function extractValuesFromInArray(condition: unknown): string[] | null {
  const chunks = (condition as Record<string, unknown> | null | undefined)
    ?.queryChunks;
  if (!Array.isArray(chunks)) return null;
  for (const chunk of chunks) {
    const c = chunk as Record<string, unknown> | null | undefined;
    if (c?.constructor?.name === "Param" && Array.isArray(c.value)) {
      return c.value as string[];
    }
  }
  return null;
}

/**
 * Extract the compared scalar from a drizzle eq() condition. eq(col, value)
 * stores the value as a bare element of `queryChunks` (the chunks for the
 * column name and operator are wrapped `{ value: [...] }` StringChunk objects /
 * column refs, so the plain string is the operand).
 */
function extractEqOperand(condition: unknown): string | null {
  const chunks = (condition as Record<string, unknown> | null | undefined)
    ?.queryChunks;
  if (!Array.isArray(chunks)) return null;
  for (const chunk of chunks) {
    // eq(col, value) wraps the operand as a drizzle Param { value }.
    const c = chunk as Record<string, unknown> | null | undefined;
    if (c?.constructor?.name === "Param" && typeof c.value === "string") {
      return c.value;
    }
    // Fallback for inlined string operands.
    if (typeof chunk === "string") return chunk;
  }
  return null;
}

/**
 * Mock db that backs both the actor_cache batch select used by the planner and
 * the `db.query.blockedActors` / `db.query.blockedDomains` reads used by
 * isActorBlocked / isDomainBlocked.
 */
function createMockDb(
  rows: ActorCacheRow[],
  blocked: { actors?: string[]; domains?: string[] },
) {
  const blockedActors = new Set(blocked.actors ?? []);
  const blockedDomains = new Set(blocked.domains ?? []);
  return {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (...whereArgs: unknown[]) => {
          const requestedIds = extractValuesFromInArray(whereArgs[0]);
          const filtered = requestedIds
            ? rows.filter((r) => requestedIds.includes(r.apId))
            : rows;
          return Promise.resolve(filtered);
        },
      }),
    }),
    query: {
      blockedActors: {
        findFirst: (args: { where: unknown }) => {
          const value = extractEqOperand(args.where) ?? "";
          return Promise.resolve(
            blockedActors.has(value) ? { actorApId: value } : undefined,
          );
        },
      },
      blockedDomains: {
        findFirst: (args: { where: unknown }) => {
          const value = extractEqOperand(args.where) ?? "";
          return Promise.resolve(
            blockedDomains.has(value) ? { domain: value } : undefined,
          );
        },
      },
    },
  };
}

test("blocklist-out: planner drops a blocked DOMAIN before grouping endpoints", async () => {
  const nowMs = Date.now();
  const dateNowStub = stub(Date, "now", () => nowMs);
  try {
    const nowIso = new Date(nowMs).toISOString();
    const db = createMockDb(
      [
        {
          apId: "https://blocked.example/ap/users/u1",
          inbox: "https://blocked.example/inbox",
          sharedInbox: null,
          lastFetchedAt: nowIso,
        },
        {
          apId: "https://ok.example/ap/users/u2",
          inbox: "https://ok.example/inbox",
          sharedInbox: null,
          lastFetchedAt: nowIso,
        },
      ],
      { domains: ["blocked.example"] },
    );

    const res = await planEndpointsFromActorCache(db as unknown as Database, [
      "https://blocked.example/ap/users/u1",
      "https://ok.example/ap/users/u2",
    ]);

    // Blocked domain produces no endpoint group at all.
    const endpoints = res.groups.map((g) => g.endpoint);
    expect(endpoints).not.toContain("https://blocked.example/inbox");
    expect(endpoints).toContain("https://ok.example/inbox");
    expect(res.blockedRecipients).toEqual([
      "https://blocked.example/ap/users/u1",
    ]);
    // Blocked recipient is NOT queued for resolution either.
    expect(res.unknownRecipients).not.toContain(
      "https://blocked.example/ap/users/u1",
    );
  } finally {
    dateNowStub.restore();
  }
});

test("blocklist-out: planner drops a blocked ACTOR (exact AP-ID)", async () => {
  const nowMs = Date.now();
  const dateNowStub = stub(Date, "now", () => nowMs);
  try {
    const nowIso = new Date(nowMs).toISOString();
    const db = createMockDb(
      [
        {
          apId: "https://shared.example/ap/users/bad",
          inbox: "https://shared.example/inbox-bad",
          sharedInbox: null,
          lastFetchedAt: nowIso,
        },
        {
          apId: "https://shared.example/ap/users/good",
          inbox: "https://shared.example/inbox-good",
          sharedInbox: null,
          lastFetchedAt: nowIso,
        },
      ],
      { actors: ["https://shared.example/ap/users/bad"] },
    );

    const res = await planEndpointsFromActorCache(db as unknown as Database, [
      "https://shared.example/ap/users/bad",
      "https://shared.example/ap/users/good",
    ]);

    const endpoints = res.groups.map((g) => g.endpoint);
    expect(endpoints).toContain("https://shared.example/inbox-good");
    expect(endpoints).not.toContain("https://shared.example/inbox-bad");
    expect(res.blockedRecipients).toEqual([
      "https://shared.example/ap/users/bad",
    ]);
  } finally {
    dateNowStub.restore();
  }
});

test("blocklist-out: enqueueDeliveryToActor skips a blocked actor (no queue send)", async () => {
  const sent: unknown[] = [];
  const db = createMockDb([], {
    actors: ["https://blocked.example/ap/users/dm"],
  });
  const env = {
    DB_INSTANCE: db as unknown as Database,
    DELIVERY_QUEUE: {
      send: (body: unknown) => {
        sent.push(body);
        return Promise.resolve();
      },
    },
    DELIVERY_DLQ: { send: () => Promise.resolve() },
  } as unknown as Env;

  await enqueueDeliveryToActor(
    env,
    "https://local.example/ap/activities/dm1",
    "https://blocked.example/ap/users/dm",
  );

  // A blocked DM recipient produces zero queue sends.
  expect(sent).toEqual([]);
});

test("blocklist-out: enqueueDeliveryToActor still delivers to an allowed actor", async () => {
  const sent: unknown[] = [];
  const db = createMockDb([], {
    domains: ["blocked.example"],
  });
  const env = {
    DB_INSTANCE: db as unknown as Database,
    DELIVERY_QUEUE: {
      send: (body: unknown) => {
        sent.push(body);
        return Promise.resolve();
      },
    },
    DELIVERY_DLQ: { send: () => Promise.resolve() },
  } as unknown as Env;

  await enqueueDeliveryToActor(
    env,
    "https://local.example/ap/activities/dm2",
    "https://ok.example/ap/users/dm",
  );

  expect(sent.length).toEqual(1);
});
