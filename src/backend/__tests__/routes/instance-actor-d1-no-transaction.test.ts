import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  getInstanceActor,
  __instanceActorInternals,
} from "../../routes/activitypub/query-helpers.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function fakeContext(db: Database) {
  return {
    get: (key: string) => (key === "db" ? db : undefined),
    env: { APP_URL },
  } as unknown as Parameters<typeof getInstanceActor>[0];
}

// The production runtime is Cloudflare D1, whose drizzle driver throws on
// db.transaction(). getInstanceActor's lazy-create must therefore NOT use an
// interactive transaction. Simulate D1 by making transaction() throw and assert
// the cold-create still succeeds (the old transaction-wrapped code 500'd here).
test("getInstanceActor lazy-creates without an interactive transaction (D1-safe)", async () => {
  __instanceActorInternals.clear();
  const db = await freshDb();
  (db as unknown as { transaction: () => never }).transaction = () => {
    throw new Error("D1 does not support interactive transactions");
  };

  const created = await getInstanceActor(fakeContext(db));
  expect(created.apId).toEqual(`${APP_URL}/ap/actor`);
  expect(created.publicKeyPem).toContain("BEGIN PUBLIC KEY");
  expect(created.privateKeyPem).toContain("BEGIN PRIVATE KEY");

  // Second call hits the hot path (row exists) and returns the SAME identity +
  // keypair — no split-brain key from the transaction-free create.
  const again = await getInstanceActor(fakeContext(db));
  expect(again.apId).toEqual(created.apId);
  expect(again.publicKeyPem).toEqual(created.publicKeyPem);
  expect(again.privateKeyPem).toEqual(created.privateKeyPem);
});
