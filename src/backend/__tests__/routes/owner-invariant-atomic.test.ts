import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, communities, communityMembers } from "../../../db/index.ts";
import { removeOwnerIfAnotherExists } from "../../routes/communities/membership-shared.ts";

// removeOwnerIfAnotherExists enforces the "a community always keeps >=1 owner"
// invariant ATOMICALLY (replacing a count(owners)>1 check-then-delete TOCTOU
// that two concurrent owners could both pass, orphaning the community). It must
// remove an owner only when another owner remains, and report whether it did.

const APP = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const f of [
    "0001_init.sql",
    "0002_social_remote_actor_edges.sql",
    "0003_activity_remote_object_edges.sql",
    "0004_blocklist.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
  ]) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function seedActor(db: Database, apId: string): Promise<void> {
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: apId.split("/").pop()!,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
}

async function seedCommunityWithOwners(
  db: Database,
  ownerApIds: string[],
): Promise<string> {
  const apId = `${APP}/ap/groups/town`;
  await db.insert(communities).values({
    apId,
    preferredUsername: "town",
    name: "town",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility: "public",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: ownerApIds[0],
    memberCount: ownerApIds.length,
  });
  for (const a of ownerApIds) {
    await seedActor(db, a);
    await db
      .insert(communityMembers)
      .values({ communityApId: apId, actorApId: a, role: "owner" });
  }
  return apId;
}

const ownerCount = async (db: Database, communityApId: string) =>
  (
    await db
      .select()
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityApId, communityApId),
          eq(communityMembers.role, "owner"),
        ),
      )
  ).length;

test("removeOwnerIfAnotherExists: with two owners, removes one and reports true", async () => {
  const db = await freshDb();
  const a = `${APP}/ap/users/a`;
  const b = `${APP}/ap/users/b`;
  const community = await seedCommunityWithOwners(db, [a, b]);

  const removed = await removeOwnerIfAnotherExists(db, community, a);

  expect(removed).toBe(true);
  expect(await ownerCount(db, community)).toBe(1); // b survives
  const comm = await db
    .select({ memberCount: communities.memberCount })
    .from(communities)
    .where(eq(communities.apId, community))
    .get();
  expect(comm?.memberCount).toBe(1); // decremented exactly once
});

test("removeOwnerIfAnotherExists: the LAST owner is NOT removed and reports false", async () => {
  const db = await freshDb();
  const a = `${APP}/ap/users/a`;
  const community = await seedCommunityWithOwners(db, [a]);

  const removed = await removeOwnerIfAnotherExists(db, community, a);

  expect(removed).toBe(false);
  expect(await ownerCount(db, community)).toBe(1); // still there — invariant held
  const comm = await db
    .select({ memberCount: communities.memberCount })
    .from(communities)
    .where(eq(communities.apId, community))
    .get();
  expect(comm?.memberCount).toBe(1); // NOT decremented
});

test("removeOwnerIfAnotherExists: a SECOND last-owner removal is a no-op (race convergence)", async () => {
  const db = await freshDb();
  const a = `${APP}/ap/users/a`;
  const b = `${APP}/ap/users/b`;
  const community = await seedCommunityWithOwners(db, [a, b]);

  // Serialized, as D1 executes the two deletes: a leaves (ok), then b tries.
  expect(await removeOwnerIfAnotherExists(db, community, a)).toBe(true);
  expect(await removeOwnerIfAnotherExists(db, community, b)).toBe(false);
  expect(await ownerCount(db, community)).toBe(1); // b kept — never zero owners
});
