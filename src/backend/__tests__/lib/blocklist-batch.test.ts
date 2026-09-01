import { expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import { blockedActors } from "../../../db/index.ts";
import { isSameActivityPubActor } from "../../lib/activitypub-actor-identity.ts";
import {
  blockActor,
  blockDomain,
  filterBlockedActorApIds,
  isActorBlocked,
  unblockActor,
} from "../../lib/blocklist.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

test("filterBlockedActorApIds: blocks by actor AND transitively by domain, in one pass", async () => {
  const db = await freshDb();
  const blockedActorId = "https://evil.example/users/mallory";
  const onBlockedDomain = "https://bad.example/users/eve";
  const allowed = "https://good.example/users/alice";

  await blockActor(db, blockedActorId, "spam");
  await blockDomain(db, "bad.example", "defederated");

  const blocked = await filterBlockedActorApIds(db, [
    blockedActorId,
    onBlockedDomain,
    allowed,
    allowed, // duplicate — must not affect the result
  ]);

  expect(blocked.has(blockedActorId)).toBe(true); // blocked actor
  expect(blocked.has(onBlockedDomain)).toBe(true); // transitively (domain)
  expect(blocked.has(allowed)).toBe(false); // not blocked
  expect(blocked.size).toBe(2);
});

test("filterBlockedActorApIds: actor blocks survive cosmetic URL spelling changes", async () => {
  const db = await freshDb();
  await blockActor(db, "https://EVIL.example/users/mallory/", "spam");

  const canonical = "https://evil.example/users/mallory";
  const sibling = "https://evil.example/users/alice";
  const blocked = await filterBlockedActorApIds(db, [canonical, sibling]);

  expect(await isActorBlocked(db, canonical)).toBe(true);
  expect(await isActorBlocked(db, sibling)).toBe(false);
  expect(blocked.has(canonical)).toBe(true);
  expect(blocked.has(sibling)).toBe(false);
});

test("operator actor blocks reach a cosmetic identity beyond 512 retained rows", async () => {
  const db = await freshDb();
  await db.run(sql`
    WITH RECURSIVE numbers(n) AS (
      VALUES (0)
      UNION ALL
      SELECT n + 1 FROM numbers WHERE n < 511
    )
    INSERT INTO blocked_actors (actor_ap_id, reason, created_at)
    SELECT
      'https://decoy-' || n || '.example/users/actor',
      'decoy',
      '2026-08-09T00:00:00.000Z'
    FROM numbers
  `);
  await blockActor(
    db,
    "https://zzzz-blocked.example/users/alice/#legacy",
    "spam",
  );

  const canonical = "https://zzzz-blocked.example/users/alice";
  const pathCaseSibling = "https://zzzz-blocked.example/users/Alice";
  const blocked = await filterBlockedActorApIds(db, [
    canonical,
    pathCaseSibling,
  ]);

  expect({
    singular: await isActorBlocked(db, canonical),
    sibling: await isActorBlocked(db, pathCaseSibling),
    batch: blocked.has(canonical),
    batchSibling: blocked.has(pathCaseSibling),
  }).toEqual({
    singular: true,
    sibling: false,
    batch: true,
    batchSibling: false,
  });
});

test("actor block mutations converge duplicate spellings and unblock the complete identity", async () => {
  const db = await freshDb();
  const canonical = "https://remote.example/users/alice";
  const cosmeticA = "https://REMOTE.example:443/users/alice/#first";
  const cosmeticB = "https://remote.example/users/alice/";
  const pathCaseSibling = "https://remote.example/users/Alice";
  await db.insert(blockedActors).values([
    {
      actorApId: cosmeticA,
      reason: "old-a",
      createdAt: "2020-01-01T00:00:00.000Z",
    },
    {
      actorApId: cosmeticB,
      reason: "old-b",
      createdAt: "2021-01-01T00:00:00.000Z",
    },
    {
      actorApId: pathCaseSibling,
      reason: "sibling",
      createdAt: "2022-01-01T00:00:00.000Z",
    },
  ]);

  await blockActor(db, canonical, "refreshed");
  const afterReblock = await db.select().from(blockedActors);
  await unblockActor(db, canonical);
  const afterUnblock = await db.select().from(blockedActors);

  const logicalTargetRows = afterReblock.filter((row) =>
    isSameActivityPubActor(row.actorApId, canonical),
  );
  expect({
    logicalTargetCount: logicalTargetRows.length,
    logicalTargetReason: logicalTargetRows[0]?.reason,
    retainedHistoricalCreatedAt: logicalTargetRows[0]?.createdAt,
    siblingAfterReblock: afterReblock.some(
      (row) => row.actorApId === pathCaseSibling && row.reason === "sibling",
    ),
    logicalTargetAfterUnblock: afterUnblock.filter((row) =>
      isSameActivityPubActor(row.actorApId, canonical),
    ).length,
    siblingAfterUnblock: afterUnblock.some(
      (row) => row.actorApId === pathCaseSibling,
    ),
  }).toEqual({
    logicalTargetCount: 1,
    logicalTargetReason: "refreshed",
    retainedHistoricalCreatedAt: expect.stringMatching(/^202[01]-/),
    siblingAfterReblock: true,
    logicalTargetAfterUnblock: 0,
    siblingAfterUnblock: true,
  });
});

test("actor re-block rolls back its reason update when duplicate convergence fails", async () => {
  const db = await freshDb();
  const canonical = "https://remote.example/users/alice";
  await db.insert(blockedActors).values([
    {
      actorApId: "https://REMOTE.example:443/users/alice/#first",
      reason: "old-a",
    },
    {
      actorApId: "https://remote.example/users/alice/",
      reason: "old-b",
    },
  ]);
  await db.run(sql`
    CREATE TRIGGER reject_actor_block_convergence
    BEFORE DELETE ON blocked_actors
    BEGIN
      SELECT RAISE(ABORT, 'simulated block convergence failure');
    END
  `);

  let failed = false;
  try {
    await blockActor(db, canonical, "must-roll-back");
  } catch {
    failed = true;
  }
  const retained = (await db.select().from(blockedActors))
    .map((row) => ({ actorApId: row.actorApId, reason: row.reason }))
    .sort((a, b) => a.actorApId.localeCompare(b.actorApId));

  expect({ failed, retained }).toEqual({
    failed: true,
    retained: [
      {
        actorApId: "https://remote.example/users/alice/",
        reason: "old-b",
      },
      {
        actorApId: "https://REMOTE.example:443/users/alice/#first",
        reason: "old-a",
      },
    ].sort((a, b) => a.actorApId.localeCompare(b.actorApId)),
  });
});

test("filterBlockedActorApIds: empty input + all-allowed return an empty set", async () => {
  const db = await freshDb();
  expect((await filterBlockedActorApIds(db, [])).size).toBe(0);
  expect(
    (await filterBlockedActorApIds(db, ["https://ok.example/users/a"])).size,
  ).toBe(0);
});

test("filterBlockedActorApIds: a >chunk recipient set is filtered without throwing (no param-ceiling bypass)", async () => {
  const db = await freshDb();
  // A large fan-out (e.g. a big community's remote audience). The IN(...) lookups
  // must be chunked: an un-chunked query would exceed SQLite's bound-parameter
  // ceiling and throw, which the fail-open catch would turn into a SILENT
  // disable of the blocklist for this whole batch (a defederation bypass).
  const N = 1500; // > BLOCKLIST_IN_CHUNK (500), spanning multiple chunks
  const recipients: string[] = [];
  for (let i = 0; i < N; i++) {
    recipients.push(`https://host${i}.example/users/u`);
  }
  // Block one actor in the FIRST chunk and one in the LAST chunk + a domain.
  const blockedFirst = recipients[3];
  const blockedLast = recipients[N - 2];
  await blockActor(db, blockedFirst, "spam");
  await blockActor(db, blockedLast, "spam");
  await blockDomain(db, "host1000.example", "defederated");

  const blocked = await filterBlockedActorApIds(db, recipients);

  expect(blocked.has(blockedFirst)).toBe(true);
  expect(blocked.has(blockedLast)).toBe(true);
  expect(blocked.has("https://host1000.example/users/u")).toBe(true); // domain
  expect(blocked.has(recipients[0])).toBe(false);
  // The blocklist is enforced (NOT a silent empty fail-open): exactly 3 blocked.
  expect(blocked.size).toBe(3);
});
