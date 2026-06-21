import { expect, test } from "bun:test";

import { stub } from "#test/mock";
import type { Database } from "../../../../db/index.ts";
import { blockedActors, blockedDomains } from "../../../../db/index.ts";
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

/**
 * Extract the single bound value from a drizzle eq() condition.
 * eq(col, value) stores the value as a Param object in queryChunks.
 */
function extractValueFromEq(condition: unknown): string | null {
  const chunks = (condition as Record<string, unknown> | null | undefined)
    ?.queryChunks;
  if (!Array.isArray(chunks)) return null;
  for (const chunk of chunks) {
    const c = chunk as Record<string, unknown> | null | undefined;
    if (c?.constructor?.name === "Param" && typeof c.value === "string") {
      return c.value;
    }
  }
  return null;
}

function createMockPlannerDb(
  rows: ActorCacheRow[],
  blocklist?: { actors?: string[]; domains?: string[] },
) {
  const blockedActorSet = new Set(blocklist?.actors ?? []);
  const blockedDomainSet = new Set(blocklist?.domains ?? []);
  return {
    // isActorBlocked() reads through db.query.blockedActors / blockedDomains.
    // Provide a real resolving mock so the outbound blocklist filter is
    // actually exercised (an undefined query makes isActorBlocked fail OPEN).
    query: {
      blockedActors: {
        findFirst: (args: { where?: unknown }) => {
          const actorApId = extractValueFromEq(args?.where);
          return Promise.resolve(
            actorApId && blockedActorSet.has(actorApId)
              ? { actorApId }
              : undefined,
          );
        },
      },
      blockedDomains: {
        findFirst: (args: { where?: unknown }) => {
          const domain = extractValueFromEq(args?.where);
          return Promise.resolve(
            domain && blockedDomainSet.has(domain) ? { domain } : undefined,
          );
        },
      },
    },
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (...whereArgs: unknown[]) => {
          const requestedIds = extractValuesFromInArray(whereArgs[0]);
          // filterBlockedActorApIds (the batched outbound blocklist filter)
          // selects from blocked_actors / blocked_domains; everything else is
          // the actorCache endpoint lookup.
          let data: unknown[];
          if (table === blockedActors) {
            data = [...blockedActorSet]
              .filter((id) => !requestedIds || requestedIds.includes(id))
              .map((actorApId) => ({ actorApId }));
          } else if (table === blockedDomains) {
            data = [...blockedDomainSet]
              .filter((d) => !requestedIds || requestedIds.includes(d))
              .map((domain) => ({ domain }));
          } else {
            data = requestedIds
              ? rows.filter((r) => requestedIds.includes(r.apId))
              : rows;
          }
          return Object.assign(Promise.resolve(data), {
            get: () => Promise.resolve(data[0] ?? undefined),
          });
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

test("delivery/planner - excludes blocked actor from planned endpoints", async () => {
  const nowMs = Date.now();
  const dateNowStub = stub(Date, "now", () => nowMs);
  try {
    const nowIso = new Date(nowMs).toISOString();

    const blocked = "https://blocked.example/ap/users/evil";
    const allowed = "https://a.example/ap/users/u1";

    const db = createMockPlannerDb(
      [
        {
          apId: blocked,
          inbox: "https://blocked.example/inbox",
          sharedInbox: null,
          lastFetchedAt: nowIso,
        },
        {
          apId: allowed,
          inbox: "https://a.example/inbox",
          sharedInbox: null,
          lastFetchedAt: nowIso,
        },
      ],
      { actors: [blocked] },
    );

    const res = await planEndpointsFromActorCache(db as unknown as Database, [
      blocked,
      allowed,
    ]);

    expect(res.blockedRecipients).toEqual([blocked]);
    // The blocked actor's endpoint must NOT be planned.
    const endpoints = res.groups.map((g) => g.endpoint);
    expect(endpoints).not.toContain("https://blocked.example/inbox");
    expect(endpoints).toContain("https://a.example/inbox");
    expect(res.unknownRecipients).toEqual([]);
  } finally {
    dateNowStub.restore();
  }
});

test("delivery/planner - excludes recipient on a blocked domain", async () => {
  const nowMs = Date.now();
  const dateNowStub = stub(Date, "now", () => nowMs);
  try {
    const nowIso = new Date(nowMs).toISOString();

    const onBlockedDomain = "https://evil.example/ap/users/u1";
    const allowed = "https://a.example/ap/users/u1";

    const db = createMockPlannerDb(
      [
        {
          apId: onBlockedDomain,
          inbox: "https://evil.example/inbox",
          sharedInbox: null,
          lastFetchedAt: nowIso,
        },
        {
          apId: allowed,
          inbox: "https://a.example/inbox",
          sharedInbox: null,
          lastFetchedAt: nowIso,
        },
      ],
      { domains: ["evil.example"] },
    );

    const res = await planEndpointsFromActorCache(db as unknown as Database, [
      onBlockedDomain,
      allowed,
    ]);

    expect(res.blockedRecipients).toEqual([onBlockedDomain]);
    const endpoints = res.groups.map((g) => g.endpoint);
    expect(endpoints).not.toContain("https://evil.example/inbox");
    expect(endpoints).toContain("https://a.example/inbox");
  } finally {
    dateNowStub.restore();
  }
});

test("delivery/planner - marks stale and missing recipients as unknown", async () => {
  const nowMs = Date.now();
  const dateNowStub = stub(Date, "now", () => nowMs);
  try {
    const staleIso = new Date(
      nowMs - DELIVERY_ENDPOINT_CACHE_TTL_MS - 1000,
    ).toISOString();

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
    expect(res.unknownRecipients.sort()).toEqual(
      [
        "https://a.example/ap/users/u1",
        "https://missing.example/ap/users/u2",
      ].sort(),
    );
  } finally {
    dateNowStub.restore();
  }
});
