import { expect, test } from "bun:test";

import { stub } from "#test/mock";
import type { Database } from "../../../../db/index.ts";
import { planEndpointsFromActorCache } from "../../../lib/delivery/planner.ts";
import { DELIVERY_ENDPOINT_CACHE_TTL_MS } from "../../../lib/delivery/transformers.ts";

/**
 * Extract bound values from a drizzle inArray() condition.
 * inArray(col, values) stores the values as Param objects in queryChunks.
 */
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

type ActorCacheRow = {
  apId: string;
  inbox: string;
  sharedInbox: string | null;
  lastFetchedAt: string;
};

function createMockPlannerDb(rows: ActorCacheRow[]) {
  return {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (...whereArgs: unknown[]) => {
          const requestedIds = extractValuesFromInArray(whereArgs[0]);
          const filtered = requestedIds
            ? rows.filter((r) => requestedIds.includes(r.apId))
            : rows;
          const result: Promise<ActorCacheRow[]> & {
            get?: () => Promise<ActorCacheRow | undefined>;
          } = Object.assign(Promise.resolve(filtered), {
            get: () => Promise.resolve(filtered[0] ?? undefined),
          });
          return result;
        },
      }),
    }),
  };
}

test("delivery/planner - aggregates by sharedInbox and prefers sharedInbox", async () => {
  const nowMs = Date.now();
  const dateNowStub = stub(Date, "now", () => nowMs);
  try {
    const nowIso = new Date(nowMs).toISOString();

    const db = createMockPlannerDb([
      {
        apId: "https://a.example/ap/users/u1",
        inbox: "https://a.example/inbox",
        sharedInbox: "https://a.example/shared",
        lastFetchedAt: nowIso,
      },
      {
        apId: "https://a.example/ap/users/u2",
        inbox: "https://a.example/inbox2",
        sharedInbox: "https://a.example/shared",
        lastFetchedAt: nowIso,
      },
      {
        apId: "https://b.example/ap/users/u3",
        inbox: "https://b.example/inbox",
        sharedInbox: null,
        lastFetchedAt: nowIso,
      },
    ]);

    const res = await planEndpointsFromActorCache(db as unknown as Database, [
      "https://a.example/ap/users/u1",
      "https://a.example/ap/users/u2",
      "https://b.example/ap/users/u3",
    ]);

    expect(res.totalRecipients).toEqual(3);
    expect(res.sharedInboxRecipients).toEqual(2);
    expect(res.unknownRecipients).toEqual([]);

    const byEndpoint = new Map(
      res.groups.map((g) => [g.endpoint, g.recipientCount]),
    );
    expect(byEndpoint.get("https://a.example/shared")).toEqual(2);
    expect(byEndpoint.get("https://b.example/inbox")).toEqual(1);
  } finally {
    dateNowStub.restore();
  }
});

test("delivery/planner - marks stale and missing recipients as unknown", async () => {
  const nowMs = Date.now();
  const dateNowStub = stub(Date, "now", () => nowMs);
  try {
    const staleIso = new Date(nowMs - DELIVERY_ENDPOINT_CACHE_TTL_MS - 1000)
      .toISOString();

    const db = createMockPlannerDb([
      {
        apId: "https://a.example/ap/users/u1",
        inbox: "https://a.example/inbox",
        sharedInbox: null,
        lastFetchedAt: staleIso,
      },
    ]);

    const res = await planEndpointsFromActorCache(db as unknown as Database, [
      "https://a.example/ap/users/u1",
      "https://missing.example/ap/users/u2",
    ]);

    expect(res.groups).toEqual([]);
    expect(res.totalRecipients).toEqual(2);
    expect(res.unknownRecipients.sort()).toEqual(["https://a.example/ap/users/u1", "https://missing.example/ap/users/u2"]
        .sort());
  } finally {
    dateNowStub.restore();
  }
});
