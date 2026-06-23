import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  activities,
  blocks,
  inbox as inboxTable,
  objects,
} from "../../../db/index.ts";
import { handleCreate } from "../../routes/activitypub/handlers/inbox-content-handlers.ts";
import { parseActivity } from "../../lib/activitypub-validators.ts";
import type { ActivityContext } from "../../routes/activitypub/inbox-types.ts";

// ---------------------------------------------------------------------------
// Audit #23 / finding B — federated @-mentions must notify the mentioned local
// user, mirroring the local processMentions fan-in. Before the fix handleCreate
// never parsed object.tag/Mention, so a cross-instance @-mention produced no
// notification at all (mention is a first-class notification type that only
// fired for local-origin posts).
// ---------------------------------------------------------------------------

const APP_URL = "https://yuru.test";
const REMOTE_ACTOR = "https://remote.example/users/alice";
const LOCAL_CAROL = `${APP_URL}/ap/users/carol`;
const LOCAL_BOB = `${APP_URL}/ap/users/bob`;
const REMOTE_OTHER = "https://remote.example/users/dave";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of [
    "0001_init.sql",
    "0004_blocklist.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
  ]) {
    const migration = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(migration);
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

function ctxFor(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
    env: { MEDIA: undefined },
  } as unknown as ActivityContext;
}

function recipientRow() {
  return { apId: LOCAL_BOB } as unknown as Parameters<typeof handleCreate>[2];
}

// A top-level public Note that @-mentions the actors in `mentionHrefs`. Routed
// through the REAL parseActivity() narrowing layer — NOT a hand-built Activity —
// so the test fails if the parser drops object.tag (which it did before audit
// #25, silently disabling the whole federated-mention path in production).
const mentionNote = (id: string, actor: string, mentionHrefs: string[]) =>
  parseActivity({
    id: `${id}/activity`,
    type: "Create",
    actor,
    object: {
      id,
      type: "Note",
      attributedTo: actor,
      content: "hey there",
      to: ["https://www.w3.org/ns/activitystreams#Public", ...mentionHrefs],
      tag: mentionHrefs.map((href) => ({
        type: "Mention",
        href,
        name: "@someone",
      })),
    },
  });

async function mentionInboxRows(db: Database, recipientApId: string) {
  return db
    .select({ activityApId: inboxTable.activityApId, type: activities.type })
    .from(inboxTable)
    .innerJoin(activities, eq(inboxTable.activityApId, activities.apId))
    .where(eq(inboxTable.actorApId, recipientApId))
    .all();
}

test("a federated top-level @-mention notifies the mentioned LOCAL user", async () => {
  const db = await freshDb();
  await seedActor(db, REMOTE_ACTOR, "alice");
  await seedActor(db, LOCAL_CAROL, "carol");
  await seedActor(db, LOCAL_BOB, "bob");

  await handleCreate(
    ctxFor(db),
    mentionNote("https://remote.example/objects/m1", REMOTE_ACTOR, [
      LOCAL_CAROL,
    ]),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );

  const rows = await mentionInboxRows(db, LOCAL_CAROL);
  expect(rows.length).toBe(1);
  // A Create referencing a non-reply object → classified as a "mention".
  expect(rows[0].type).toBe("Create");
});

test("a federated @-mention of a REMOTE actor creates no local inbox row", async () => {
  const db = await freshDb();
  await seedActor(db, REMOTE_ACTOR, "alice");
  await seedActor(db, LOCAL_BOB, "bob");

  await handleCreate(
    ctxFor(db),
    mentionNote("https://remote.example/objects/m2", REMOTE_ACTOR, [
      REMOTE_OTHER,
    ]),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );

  expect((await mentionInboxRows(db, REMOTE_OTHER)).length).toBe(0);
});

test("a federated @-mention from an actor the mentioned user has BLOCKED is suppressed", async () => {
  const db = await freshDb();
  await seedActor(db, REMOTE_ACTOR, "alice");
  await seedActor(db, LOCAL_CAROL, "carol");
  await seedActor(db, LOCAL_BOB, "bob");
  // Carol blocks the remote sender.
  await db.insert(blocks).values({
    blockerApId: LOCAL_CAROL,
    blockedApId: REMOTE_ACTOR,
  });

  await handleCreate(
    ctxFor(db),
    mentionNote("https://remote.example/objects/m3", REMOTE_ACTOR, [
      LOCAL_CAROL,
    ]),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );

  expect((await mentionInboxRows(db, LOCAL_CAROL)).length).toBe(0);
});

test("a duplicate delivery of the same mention Create does not double-notify", async () => {
  const db = await freshDb();
  await seedActor(db, REMOTE_ACTOR, "alice");
  await seedActor(db, LOCAL_CAROL, "carol");
  await seedActor(db, LOCAL_BOB, "bob");

  const note = mentionNote("https://remote.example/objects/m4", REMOTE_ACTOR, [
    LOCAL_CAROL,
  ]);
  await handleCreate(ctxFor(db), note, recipientRow(), REMOTE_ACTOR, APP_URL);
  await handleCreate(ctxFor(db), note, recipientRow(), REMOTE_ACTOR, APP_URL);

  expect((await mentionInboxRows(db, LOCAL_CAROL)).length).toBe(1);
});
