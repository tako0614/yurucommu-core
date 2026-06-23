import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, communities, communityMembers } from "../../../db/index.ts";
import {
  demoteOwnerIfAnotherExists,
  removeOwnerIfAnotherExists,
} from "../../routes/communities/membership-shared.ts";

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

// demoteOwnerIfAnotherExists guards the ROLE-CHANGE path with the same ">=1
// owner" invariant. The EXISTS is keyed on the demotion TARGET, so it covers
// demoting yourself AND demoting a fellow owner identically — closing the gap
// where the old guard only fired for self-demote and let two owners demote each
// other concurrently into a zero-owner community.

const memberRole = async (
  db: Database,
  communityApId: string,
  actorApId: string,
) =>
  (
    await db
      .select({ role: communityMembers.role })
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityApId, communityApId),
          eq(communityMembers.actorApId, actorApId),
        ),
      )
      .get()
  )?.role;

test("demoteOwnerIfAnotherExists: with two owners, demotes the target and reports true", async () => {
  const db = await freshDb();
  const a = `${APP}/ap/users/a`;
  const b = `${APP}/ap/users/b`;
  const community = await seedCommunityWithOwners(db, [a, b]);

  const demoted = await demoteOwnerIfAnotherExists(db, community, a, "member");

  expect(demoted).toBe(true);
  expect(await memberRole(db, community, a)).toBe("member"); // a demoted
  expect(await ownerCount(db, community)).toBe(1); // b still owner
});

test("demoteOwnerIfAnotherExists: the LAST owner is NOT demoted and reports false", async () => {
  const db = await freshDb();
  const a = `${APP}/ap/users/a`;
  const community = await seedCommunityWithOwners(db, [a]);

  const demoted = await demoteOwnerIfAnotherExists(db, community, a, "member");

  expect(demoted).toBe(false);
  expect(await memberRole(db, community, a)).toBe("owner"); // invariant held
  expect(await ownerCount(db, community)).toBe(1);
});

test("demoteOwnerIfAnotherExists: two owners demoting EACH OTHER never reach zero owners", async () => {
  const db = await freshDb();
  const a = `${APP}/ap/users/a`;
  const b = `${APP}/ap/users/b`;
  const community = await seedCommunityWithOwners(db, [a, b]);

  // Serialized as D1 would: a's demote of b lands first; then b's demote of a
  // sees b already a member (no other owner besides a) and is refused.
  expect(await demoteOwnerIfAnotherExists(db, community, b, "member")).toBe(
    true,
  );
  expect(await demoteOwnerIfAnotherExists(db, community, a, "member")).toBe(
    false,
  );
  expect(await ownerCount(db, community)).toBe(1); // a kept — never zero owners
});

// Bulk role-change (POST /members/batch/role) now routes each owner demotion
// through demoteOwnerIfAnotherExists instead of a self-only count()-then-UPDATE.
// This simulates the handler's sequential per-target loop demoting BOTH owners
// in a SINGLE request — the second demotion must be refused so the community is
// never left ownerless (the deterministic single-request orphan the old path
// allowed).
test("bulk-path loop demoting both owners in one pass keeps the last owner", async () => {
  const db = await freshDb();
  const a = `${APP}/ap/users/a`;
  const b = `${APP}/ap/users/b`;
  const community = await seedCommunityWithOwners(db, [a, b]);

  // Loop order [a, b]: a demotes (b still owner), then b is the last owner → refused.
  expect(await demoteOwnerIfAnotherExists(db, community, a, "member")).toBe(
    true,
  );
  expect(await demoteOwnerIfAnotherExists(db, community, b, "member")).toBe(
    false,
  );
  expect(await ownerCount(db, community)).toBe(1);
  expect(await memberRole(db, community, b)).toBe("owner");
});
