import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  follows,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import { handleCreate } from "../../routes/activitypub/handlers/inbox-content-handlers.ts";
import { canViewerReadObjectFull } from "../../lib/post-visibility.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

// ---------------------------------------------------------------------------
// Audit #8 findings #1 + #2 (HIGH, cross-federation private-content disclosure):
//   handleCreate's generic Note insert derived visibility SOLELY from
//   `to.includes(Public)`, so a remote FOLLOWERS-ONLY post (Public absent) was
//   silently stored as visibility="unlisted" — world-readable. And on the shared
//   inbox (which fans a Create out to every local follower of the sender), a DM
//   addressed to actor A but processed for a non-addressed follower B fell
//   through to the same generic insert and was stored as "unlisted" too.
//
//   Fix: classify visibility recipient-INDEPENDENTLY (a non-public Note is never
//   "unlisted"; followers-collection → "followers"), persist to/cc so the
//   explicit-recipient gate works, and SKIP a direct-shaped Note that is not
//   addressed to the current fan-out recipient (the addressed actor's own
//   delivery handles it via insertDirectNote).
// ---------------------------------------------------------------------------

const APP_URL = "https://yuru.test";
const REMOTE = "https://remote.example/users/alice";
const LOCAL_BOB = `${APP_URL}/ap/users/bob`;
const LOCAL_CAROL = `${APP_URL}/ap/users/carol`;
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of [
    "0001_init.sql",
    "0004_blocklist.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
  ]) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
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
    postCount: 0,
  });
}

async function setup(): Promise<Database> {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob");
  await seedActor(db, LOCAL_CAROL, "carol");
  await seedActor(db, REMOTE, "alice");
  return db;
}

function ctxFor(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
    env: { MEDIA: undefined, APP_URL },
  } as unknown as ActivityContext;
}

function recipient(apId: string) {
  return {
    apId,
    followersUrl: `${apId}/followers`,
  } as unknown as Parameters<typeof handleCreate>[2];
}

const note = (id: string, to: string[], cc: string[] = []): Activity =>
  ({
    id: `${id}/activity`,
    type: "Create",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "secret",
      to,
      cc,
    },
  }) as unknown as Activity;

async function rowOf(db: Database, apId: string) {
  return db
    .select({
      visibility: objects.visibility,
      toJson: objects.toJson,
      ccJson: objects.ccJson,
      attributedTo: objects.attributedTo,
      audienceJson: objects.audienceJson,
      communityApId: objects.communityApId,
    })
    .from(objects)
    .where(eq(objects.apId, apId))
    .get();
}

async function countOf(db: Database, apId: string): Promise<number> {
  const rows = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, apId));
  return rows.length;
}

test("inbound followers-only Note is stored as visibility=followers, NOT unlisted", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/foll-1";
  await handleCreate(
    ctxFor(db),
    note(id, [`${REMOTE}/followers`]),
    recipient(LOCAL_BOB),
    REMOTE,
    APP_URL,
  );
  const row = await rowOf(db, id);
  expect(row?.visibility).toBe("followers");
  expect(JSON.parse(row!.toJson)).toEqual([`${REMOTE}/followers`]);
});

test("inbound unlisted Note (Public in cc only) stays unlisted", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/unl-1";
  await handleCreate(
    ctxFor(db),
    note(id, [`${REMOTE}/followers`], [PUBLIC]),
    recipient(LOCAL_BOB),
    REMOTE,
    APP_URL,
  );
  expect((await rowOf(db, id))?.visibility).toBe("unlisted");
});

test("inbound public Note (Public in to) stays public", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/pub-1";
  await handleCreate(
    ctxFor(db),
    note(id, [PUBLIC]),
    recipient(LOCAL_BOB),
    REMOTE,
    APP_URL,
  );
  expect((await rowOf(db, id))?.visibility).toBe("public");
});

test("a followers-only Note is hidden from a non-follower and an anonymous viewer, shown to an accepted follower", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/foll-2";
  await handleCreate(
    ctxFor(db),
    note(id, [`${REMOTE}/followers`]),
    recipient(LOCAL_BOB),
    REMOTE,
    APP_URL,
  );
  const row = await rowOf(db, id);

  // Anonymous and a non-follower local actor cannot read it.
  expect(await canViewerReadObjectFull(db, row!, null)).toBe(false);
  expect(await canViewerReadObjectFull(db, row!, LOCAL_CAROL)).toBe(false);

  // An accepted follower of the remote author can.
  await db.insert(follows).values({
    followerApId: LOCAL_BOB,
    followingApId: REMOTE,
    status: "accepted",
  });
  expect(await canViewerReadObjectFull(db, row!, LOCAL_BOB)).toBe(true);
});

test("a DM addressed to a DIFFERENT actor is NOT stored as a generic note for a non-addressed fan-out recipient", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/dm-1";
  // DM addressed to carol, but handleCreate is invoked with bob as the fan-out
  // recipient (the shared-inbox case). It must be skipped, not generic-inserted.
  await handleCreate(
    ctxFor(db),
    note(id, [LOCAL_CAROL]),
    recipient(LOCAL_BOB),
    REMOTE,
    APP_URL,
  );
  expect(await countOf(db, id)).toBe(0);
});

test("an inbound DM from a BLOCKED actor is dropped (no object row created)", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/dm-blocked";
  // bob has personally blocked the remote sender (e.g. via reject+block).
  await db
    .insert(schema.blocks)
    .values({ blockerApId: LOCAL_BOB, blockedApId: REMOTE });

  await handleCreate(
    ctxFor(db),
    note(id, [LOCAL_BOB]),
    recipient(LOCAL_BOB),
    REMOTE,
    APP_URL,
  );
  // The DM must NOT be stored — federated blocking now mirrors the local guard.
  expect(await countOf(db, id)).toBe(0);
});

test("a DM addressed to the inbox owner is stored as visibility=direct (DM path), never unlisted", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/dm-2";
  await handleCreate(
    ctxFor(db),
    note(id, [LOCAL_BOB]),
    recipient(LOCAL_BOB),
    REMOTE,
    APP_URL,
  );
  const row = await rowOf(db, id);
  expect(row?.visibility).toBe("direct");
  // A third party cannot read a direct note.
  expect(await canViewerReadObjectFull(db, row!, LOCAL_CAROL)).toBe(false);

  // Audit #16 #3: the recipient link MUST co-commit with the object — inbound-DM
  // recipient membership is resolved EXCLUSIVELY through object_recipients
  // (contacts / requests / unread-count), so an object stored without it is a DM
  // permanently invisible to the recipient. It now lives inside the same atomic
  // batch as the object insert; assert it is present after a fresh inbound DM.
  const recipientLink = await db
    .select()
    .from(objectRecipients)
    .where(
      and(
        eq(objectRecipients.objectApId, id),
        eq(objectRecipients.recipientApId, LOCAL_BOB),
      ),
    )
    .get();
  expect(recipientLink?.type).toBe("to");
});
