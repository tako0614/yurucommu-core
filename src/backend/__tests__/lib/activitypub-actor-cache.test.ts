import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actorCache } from "../../../db/index.ts";
import { parseRemoteActor } from "../../lib/activitypub-validators.ts";
import { buildActorCacheFields } from "../../lib/activitypub-actor-cache.ts";

// Spin up an in-memory libsql database with the real actor_cache schema so we
// can assert the canonical cache fields round-trip through Drizzle to the
// physical columns (catching any column-name drift) — the regression that this
// helper unifies away.
async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const sql = await readFile(new URL("0001_init.sql", root), "utf8");
  await client.executeMultiple(sql);
  return drizzle(client, { schema }) as unknown as Database;
}

// The four previously-divergent delivery-relevant columns. Before unification,
// the inbox cache path omitted these, so whether a cached actor row carried
// them depended on whichever path fetched it first.
const DELIVERY_COLUMNS = [
  "outbox",
  "followersUrl",
  "followingUrl",
  "sharedInbox",
] as const;

test("buildActorCacheFields always emits the delivery columns, even for a minimal (inbox-only) actor document", () => {
  // The shape the inbox cold-cache path used to special-case: only inbox and
  // a public key. The old inbox-local buildActorCacheFields dropped outbox /
  // followersUrl / followingUrl / sharedInbox entirely for this shape.
  const minimal = parseRemoteActor({
    id: "https://remote.example/users/min",
    type: "Person",
    inbox: "https://remote.example/users/min/inbox",
    publicKey: {
      id: "https://remote.example/users/min#main-key",
      publicKeyPem: "PEM",
    },
  });

  const fields = buildActorCacheFields(minimal);

  for (const column of DELIVERY_COLUMNS) {
    expect(column in fields).toBe(true);
    // Absent in the document => explicitly null (not silently omitted).
    expect(fields[column]).toBeNull();
  }
});

test("buildActorCacheFields populates sharedInbox / outbox / followers from a full Mastodon actor", () => {
  const actor = parseRemoteActor({
    id: "https://mastodon.example/users/alice",
    type: "Person",
    preferredUsername: "alice",
    name: "Alice",
    inbox: "https://mastodon.example/users/alice/inbox",
    outbox: "https://mastodon.example/users/alice/outbox",
    followers: "https://mastodon.example/users/alice/followers",
    following: "https://mastodon.example/users/alice/following",
    endpoints: { sharedInbox: "https://mastodon.example/inbox" },
    publicKey: {
      id: "https://mastodon.example/users/alice#main-key",
      publicKeyPem: "PEM",
    },
  });

  const fields = buildActorCacheFields(actor);

  expect(fields.inbox).toBe("https://mastodon.example/users/alice/inbox");
  expect(fields.outbox).toBe("https://mastodon.example/users/alice/outbox");
  expect(fields.followersUrl).toBe(
    "https://mastodon.example/users/alice/followers",
  );
  expect(fields.followingUrl).toBe(
    "https://mastodon.example/users/alice/following",
  );
  // The primary fan-out target for Mastodon-scale servers — the column whose
  // loss the unification fixes.
  expect(fields.sharedInbox).toBe("https://mastodon.example/inbox");
});

test("buildActorCacheFields truncates oversized remote name / summary / preferredUsername", () => {
  // Remote display fields are attacker-controlled and bounded only by the fetch
  // size — an actor doc with megabyte-long fields would bloat every feed row /
  // search result that renders the cached actor. The cache chokepoint truncates
  // to the local profile caps (name 50, summary 500, username 100).
  const actor = parseRemoteActor({
    id: "https://remote.example/users/whale",
    type: "Person",
    preferredUsername: "u".repeat(5000),
    name: "N".repeat(5000),
    summary: "S".repeat(50000),
    inbox: "https://remote.example/users/whale/inbox",
    publicKey: {
      id: "https://remote.example/users/whale#main-key",
      publicKeyPem: "PEM",
    },
  });

  const fields = buildActorCacheFields(actor);

  expect(fields.name?.length).toBe(50);
  expect(fields.summary?.length).toBe(500);
  expect(fields.preferredUsername?.length).toBe(100);
  // An empty string still normalizes to null (not a 0-length string).
  const blank = buildActorCacheFields(
    parseRemoteActor({
      id: "https://remote.example/users/blank",
      type: "Person",
      name: "",
      summary: "",
      inbox: "https://remote.example/users/blank/inbox",
    }),
  );
  expect(blank.name).toBeNull();
  expect(blank.summary).toBeNull();
});

test("canonical cache fields round-trip to the actor_cache table including shared_inbox", async () => {
  const db = await freshDb();
  const apId = "https://mastodon.example/users/alice";
  const actor = parseRemoteActor({
    id: apId,
    type: "Person",
    inbox: "https://mastodon.example/users/alice/inbox",
    endpoints: { sharedInbox: "https://mastodon.example/inbox" },
    publicKey: {
      id: `${apId}#main-key`,
      publicKeyPem: "PEM",
    },
  });

  // Mirror the single upsert every fetch path now performs through the helper.
  const fields = buildActorCacheFields(actor);
  await db
    .insert(actorCache)
    .values({ apId, ...fields })
    .onConflictDoUpdate({ target: actorCache.apId, set: fields });

  const row = await db
    .select()
    .from(actorCache)
    .where(eq(actorCache.apId, apId))
    .get();

  expect(row).toBeTruthy();
  expect(row!.sharedInbox).toBe("https://mastodon.example/inbox");
  expect(row!.inbox).toBe("https://mastodon.example/users/alice/inbox");
});
