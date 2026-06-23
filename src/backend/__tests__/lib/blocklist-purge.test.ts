import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, objects } from "../../../db/index.ts";
import {
  purgeActorContent,
  purgeDomainContent,
} from "../../lib/blocklist-purge.ts";
import { blockDomain, isActorBlocked } from "../../lib/blocklist.ts";

// ---------------------------------------------------------------------------
// Audit #25 finding C — defederation must purge already-ingested content (the
// operator blocklist was otherwise ingest/delivery-only, leaving a blocked
// actor's/domain's prior posts live in timelines/search/object-serving) AND a
// domain block must cover subdomains.
// ---------------------------------------------------------------------------

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function seedActor(db: Database, apId: string, username: string) {
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
}

async function seedPost(db: Database, apId: string, author: string) {
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content: "x",
    visibility: "public",
    isLocal: 0,
  });
}

async function objectExists(db: Database, apId: string): Promise<boolean> {
  const row = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, apId))
    .get();
  return !!row;
}

test("purgeActorContent removes the blocked actor's posts and leaves others", async () => {
  const db = await freshDb();
  const evil = "https://evil.example/users/x";
  const other = "https://other.example/users/y";
  await seedActor(db, evil, "x");
  await seedActor(db, other, "y");
  await seedPost(db, "https://evil.example/objects/1", evil);
  await seedPost(db, "https://evil.example/objects/2", evil);
  await seedPost(db, "https://other.example/objects/1", other);

  await purgeActorContent(db, evil);

  expect(await objectExists(db, "https://evil.example/objects/1")).toBe(false);
  expect(await objectExists(db, "https://evil.example/objects/2")).toBe(false);
  // An unrelated actor's content is untouched.
  expect(await objectExists(db, "https://other.example/objects/1")).toBe(true);
});

test("purgeDomainContent removes the host AND its subdomains but NOT a similarly-named domain", async () => {
  const db = await freshDb();
  const apex = "https://evil.example/users/a";
  const sub = "https://node1.evil.example/users/b";
  const lookalike = "https://notevil.example/users/c"; // must NOT be purged
  await seedActor(db, apex, "a");
  await seedActor(db, sub, "b");
  await seedActor(db, lookalike, "c");
  await seedPost(db, "https://evil.example/objects/p", apex);
  await seedPost(db, "https://node1.evil.example/objects/p", sub);
  await seedPost(db, "https://notevil.example/objects/p", lookalike);

  await purgeDomainContent(db, "evil.example");

  expect(await objectExists(db, "https://evil.example/objects/p")).toBe(false);
  expect(await objectExists(db, "https://node1.evil.example/objects/p")).toBe(
    false,
  );
  // `notevil.example` ends with `evil.example` but is NOT a subdomain of it.
  expect(await objectExists(db, "https://notevil.example/objects/p")).toBe(
    true,
  );
});

test("a domain block is enforced on subdomains (isActorBlocked)", async () => {
  const db = await freshDb();
  await blockDomain(db, "evil.example", null);

  expect(await isActorBlocked(db, "https://evil.example/users/x")).toBe(true);
  expect(await isActorBlocked(db, "https://a.evil.example/users/x")).toBe(true);
  expect(await isActorBlocked(db, "https://deep.a.evil.example/users/x")).toBe(
    true,
  );
  // A different registrable domain that merely ends with the same labels.
  expect(await isActorBlocked(db, "https://notevil.example/users/x")).toBe(
    false,
  );
});
