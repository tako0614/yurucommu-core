import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  blockActor,
  blockDomain,
  filterBlockedActorApIds,
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

test("filterBlockedActorApIds: empty input + all-allowed return an empty set", async () => {
  const db = await freshDb();
  expect((await filterBlockedActorApIds(db, [])).size).toBe(0);
  expect(
    (await filterBlockedActorApIds(db, ["https://ok.example/users/a"])).size,
  ).toBe(0);
});
