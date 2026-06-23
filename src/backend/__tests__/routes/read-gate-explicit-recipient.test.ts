import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, follows } from "../../../db/index.ts";
import {
  canViewerReadObjectFull,
  type ReadGateObject,
} from "../../lib/post-visibility.ts";

// A viewer the author EXPLICITLY addressed (to/cc) — e.g. an @mention — may read
// a followers-only / direct post even without an accepted-follow edge: the
// author chose to address them and it was delivered to their inbox. Previously
// the read gate (and the inline post-detail check) only honored accepted
// followers, so a mentioned non-follower got the notification but 404'd on open.

const APP_URL = "https://yuru.test";
const AUTHOR = `${APP_URL}/ap/users/author`;
const VIEWER = `${APP_URL}/ap/users/viewer`;

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const f of [
    "0001_init.sql",
    "0002_social_remote_actor_edges.sql",
    "0008_actor_fields_aka.sql",
  ]) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function seedActor(
  db: Database,
  apId: string,
  username: string,
): Promise<void> {
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

function followersPost(extra: Partial<ReadGateObject>): ReadGateObject {
  return {
    visibility: "followers",
    attributedTo: AUTHOR,
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    communityApId: null,
    ...extra,
  };
}

test("followers-only post: a mentioned (cc) non-follower CAN read it", async () => {
  const db = await freshDb();
  await seedActor(db, AUTHOR, "author");
  await seedActor(db, VIEWER, "viewer");
  // VIEWER is addressed in cc (a mention) but does NOT follow AUTHOR.
  const obj = followersPost({ ccJson: JSON.stringify([VIEWER]) });
  expect(await canViewerReadObjectFull(db, obj, VIEWER)).toBe(true);
});

test("followers-only post: a non-follower NOT addressed CANNOT read it", async () => {
  const db = await freshDb();
  await seedActor(db, AUTHOR, "author");
  await seedActor(db, VIEWER, "viewer");
  expect(await canViewerReadObjectFull(db, followersPost({}), VIEWER)).toBe(
    false,
  );
});

test("followers-only post: an accepted follower can still read it (unchanged)", async () => {
  const db = await freshDb();
  await seedActor(db, AUTHOR, "author");
  await seedActor(db, VIEWER, "viewer");
  await db.insert(follows).values({
    followerApId: VIEWER,
    followingApId: AUTHOR,
    status: "accepted",
  });
  expect(await canViewerReadObjectFull(db, followersPost({}), VIEWER)).toBe(
    true,
  );
});

test("followers-only post: an anonymous viewer can never read it (even if cc lists someone)", async () => {
  const db = await freshDb();
  const obj = followersPost({ ccJson: JSON.stringify([VIEWER]) });
  expect(await canViewerReadObjectFull(db, obj, null)).toBe(false);
});

test("direct post: a cc-addressed recipient can read it", async () => {
  const db = await freshDb();
  await seedActor(db, AUTHOR, "author");
  await seedActor(db, VIEWER, "viewer");
  const obj: ReadGateObject = {
    visibility: "direct",
    attributedTo: AUTHOR,
    toJson: "[]",
    ccJson: JSON.stringify([VIEWER]),
    audienceJson: "[]",
    communityApId: null,
  };
  expect(await canViewerReadObjectFull(db, obj, VIEWER)).toBe(true);
});

// Audit #19: a Story is stored visibility="public"/audienceJson="[]" but its reach
// is followers-only (personal) and it is revoked at endTime. canViewerReadObjectFull
// must apply that reach rule, not treat it as world-readable public.
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
function story(extra: Partial<ReadGateObject>): ReadGateObject {
  return {
    visibility: "public",
    attributedTo: AUTHOR,
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    communityApId: null,
    type: "Story",
    endTime: FUTURE,
    ...extra,
  };
}

test("personal Story: a non-follower CANNOT read it (despite the public default)", async () => {
  const db = await freshDb();
  await seedActor(db, AUTHOR, "author");
  await seedActor(db, VIEWER, "viewer");
  expect(await canViewerReadObjectFull(db, story({}), VIEWER)).toBe(false);
  expect(await canViewerReadObjectFull(db, story({}), null)).toBe(false);
});

test("personal Story: the author and an accepted follower CAN read it", async () => {
  const db = await freshDb();
  await seedActor(db, AUTHOR, "author");
  await seedActor(db, VIEWER, "viewer");
  expect(await canViewerReadObjectFull(db, story({}), AUTHOR)).toBe(true);
  await db.insert(follows).values({
    followerApId: VIEWER,
    followingApId: AUTHOR,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  expect(await canViewerReadObjectFull(db, story({}), VIEWER)).toBe(true);
});

test("personal Story: an EXPIRED story is revoked from a follower but not the author", async () => {
  const db = await freshDb();
  await seedActor(db, AUTHOR, "author");
  await seedActor(db, VIEWER, "viewer");
  await db.insert(follows).values({
    followerApId: VIEWER,
    followingApId: AUTHOR,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  expect(
    await canViewerReadObjectFull(db, story({ endTime: PAST }), VIEWER),
  ).toBe(false);
  // The author still reads their own expired story.
  expect(
    await canViewerReadObjectFull(db, story({ endTime: PAST }), AUTHOR),
  ).toBe(true);
});
