import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, communities, communityMembers } from "../../../db/index.ts";
import {
  canViewerReadObject,
  communityReadableApIds,
} from "../../lib/community-visibility.ts";

// The batched community read-gate (communityReadableApIds) replaced a per-row
// canViewerReadObject loop on the notifications / bookmarks / replies pages.
// Because it is a PRIVACY gate, this asserts the batched result is byte-for-byte
// identical to the per-row form across every case: no community, public
// community, private community (member / non-member / anonymous).

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

async function seedCommunity(
  db: Database,
  username: string,
  visibility: "public" | "private",
): Promise<string> {
  const apId = `${APP}/ap/groups/${username}`;
  await db.insert(communities).values({
    apId,
    preferredUsername: username,
    name: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: `${APP}/ap/users/owner`,
  });
  return apId;
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

function obj(apId: string, communityApId: string | null) {
  return {
    apId,
    communityApId,
    audienceJson: communityApId ? JSON.stringify([communityApId]) : "[]",
  };
}

test("communityReadableApIds matches per-row canViewerReadObject across all gate cases", async () => {
  const db = await freshDb();
  const viewer = `${APP}/ap/users/viewer`;
  await seedActor(db, viewer);

  const pub = await seedCommunity(db, "pub", "public");
  const privIn = await seedCommunity(db, "privin", "private");
  const privOut = await seedCommunity(db, "privout", "private");
  // Viewer is a member of the private community they're "in", not the other.
  await db
    .insert(communityMembers)
    .values({ communityApId: privIn, actorApId: viewer, role: "member" });

  const objs = [
    obj("o-none", null), // not community-addressed
    obj("o-pub", pub), // public community
    obj("o-privin", privIn), // private, viewer is a member
    obj("o-privout", privOut), // private, viewer is NOT a member
  ];

  // --- authenticated viewer ---
  const batched = await communityReadableApIds(db, objs, viewer);
  expect([...batched].sort()).toEqual(["o-none", "o-privin", "o-pub"]);
  // Per-row agreement.
  for (const o of objs) {
    const perRow = await canViewerReadObject(db, o, viewer);
    expect(batched.has(o.apId)).toBe(perRow);
  }

  // --- anonymous viewer: both private communities fail closed ---
  const anon = await communityReadableApIds(db, objs, null);
  expect([...anon].sort()).toEqual(["o-none", "o-pub"]);
  for (const o of objs) {
    const perRow = await canViewerReadObject(db, o, null);
    expect(anon.has(o.apId)).toBe(perRow);
  }
});

test("communityReadableApIds: empty input and all-non-community pages", async () => {
  const db = await freshDb();
  const viewer = `${APP}/ap/users/viewer`;

  expect((await communityReadableApIds(db, [], viewer)).size).toBe(0);

  const objs = [obj("a", null), obj("b", null)];
  const all = await communityReadableApIds(db, objs, viewer);
  expect([...all].sort()).toEqual(["a", "b"]);
});
