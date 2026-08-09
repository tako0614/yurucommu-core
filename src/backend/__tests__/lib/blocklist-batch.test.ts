import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  blockActor,
  blockDomain,
  filterBlockedActorApIds,
  isActorBlocked,
} from "../../lib/blocklist.ts";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
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
