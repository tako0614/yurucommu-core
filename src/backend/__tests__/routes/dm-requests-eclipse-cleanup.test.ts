import { expect, test } from "bun:test";

/**
 * Audit #16 DM cluster — GET /requests collapse (no flooder eclipse), reject
 * inbox/activities cleanup (no phantom notification), and archive/reject keying
 * on the STORED conversation id (legacy-scheme safe). Runs the real handlers
 * against in-memory libsql with production migrations.
 */

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  activities,
  actors,
  announces,
  bookmarks,
  dmArchivedConversations,
  inbox as inboxTable,
  likes,
  mediaUploads,
  objectRecipients,
  objects,
  insertMany,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import dmRoutes from "../../routes/dm/conversations.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

const localApId = (u: string) => `${APP_URL}/ap/users/${u}`;

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<string> {
  const apId = localApId(username);
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
  return apId;
}

/** An inbound DM Note + its `type='to'` recipient link. */
async function insertDm(
  db: Database,
  sender: string,
  recipient: string,
  conversation: string,
  id: string,
  published: string,
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: sender,
    content: id,
    toJson: JSON.stringify([recipient]),
    visibility: "direct",
    conversation,
    published,
    isLocal: 0,
  });
  await db.insert(objectRecipients).values({
    objectApId: apId,
    recipientApId: recipient,
    type: "to",
  });
  return apId;
}

/** The inbound delivery Create activity + the recipient inbox row for a DM. */
async function surfaceInbound(
  db: Database,
  objectApId: string,
  sender: string,
  recipient: string,
): Promise<string> {
  const activityApId = `${objectApId}#create`;
  await db.insert(activities).values({
    apId: activityApId,
    type: "Create",
    actorApId: sender,
    objectApId,
    rawJson: "{}",
  });
  await db.insert(inboxTable).values({
    activityApId,
    actorApId: recipient,
  });
  return activityApId;
}

function fakeActor(apId: string, username: string): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name: null,
    summary: null,
    icon_url: null,
    header_url: null,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followers_url: `${apId}/followers`,
    following_url: `${apId}/following`,
    public_key_pem: "pub",
    private_key_pem: "priv",
    takos_user_id: null,
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role: "owner",
    created_at: new Date().toISOString(),
  } as unknown as Actor;
}

function appWith(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", dmRoutes);
  return app;
}

const envFor = (db: Database, media?: ObjectStore): Env =>
  ({ APP_URL, DB_INSTANCE: db, MEDIA: media }) as unknown as Env;

function recordingStorage(): {
  storage: ObjectStore;
  deleted: string[];
} {
  const deleted: string[] = [];
  const storage = {
    async put() {},
    async get() {
      return null;
    },
    async delete(key: string | string[]) {
      deleted.push(...(Array.isArray(key) ? key : [key]));
    },
  } as unknown as ObjectStore;
  return { storage, deleted };
}

test("GET /requests returns one row per conversation — a high-volume sender cannot eclipse others", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const flood = await insertLocalActor(db, "flood");
  const quiet = await insertLocalActor(db, "quiet");

  // The flooder sends MANY messages; the quiet sender sends one, OLDER than all
  // of the flooder's. Pre-fix (message-limited window + JS dedup) a large enough
  // flood would push quiet out of the window. The SQL GROUP BY makes each
  // conversation exactly one row regardless of message count.
  for (let i = 0; i < 25; i++) {
    await insertDm(
      db,
      flood,
      alice,
      "conv-flood",
      `f${i}`,
      `2026-06-20T12:${String(i).padStart(2, "0")}:00.000Z`,
    );
  }
  await insertDm(
    db,
    quiet,
    alice,
    "conv-quiet",
    "q1",
    "2026-06-20T09:00:00.000Z",
  );

  const res = await appWith(db, fakeActor(alice, "alice")).fetch(
    new Request(`${APP_URL}/requests`, { method: "GET" }),
    envFor(db),
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as {
    requests: Array<{ conversation: string; content: string }>;
  };

  const convs = body.requests.map((r) => r.conversation).sort();
  expect(convs).toEqual(["conv-flood", "conv-quiet"]);
  // The flooder's single row carries its LATEST message (max published).
  const floodRow = body.requests.find((r) => r.conversation === "conv-flood");
  expect(floodRow?.content).toEqual("f24");
});

test("POST /requests/reject fully reaps only direct messages, including child/media state", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const spammer = await insertLocalActor(db, "spammer");

  const conv = "conv-spam";
  const objA = await insertDm(
    db,
    spammer,
    alice,
    conv,
    "s1",
    "2026-06-20T10:00:00.000Z",
  );
  const objB = await insertDm(
    db,
    spammer,
    alice,
    conv,
    "s2",
    "2026-06-20T10:01:00.000Z",
  );
  await surfaceInbound(db, objA, spammer, alice);
  await surfaceInbound(db, objB, spammer, alice);

  // Attach one private managed blob and interaction state. The old request
  // path bypassed deleteObjectCascade, leaving every one of these rows behind.
  const r2Key = "uploads/rejected-private.jpg";
  await db
    .update(objects)
    .set({
      attachmentsJson: JSON.stringify([
        {
          type: "Document",
          url: "/media/rejected-private.jpg",
          r2_key: r2Key,
        },
      ]),
    })
    .where(eq(objects.apId, objA));
  await db.insert(mediaUploads).values({
    id: "rejected-private-media",
    r2Key,
    uploaderApId: spammer,
    contentType: "image/jpeg",
    size: 123,
  });
  await db.insert(likes).values({ actorApId: alice, objectApId: objA });
  await db.insert(announces).values({ actorApId: alice, objectApId: objA });
  await db.insert(bookmarks).values({ actorApId: alice, objectApId: objA });

  // A corrupt/legacy non-DM row may share the same conversation string. Reject
  // owns only direct Note messages; the old activity/recipient subquery lacked
  // that scope and data-lossed this survivor's projections before leaving its
  // object row behind.
  const publicSurvivor = `${APP_URL}/ap/objects/same-conversation-public`;
  await db.insert(objects).values({
    apId: publicSurvivor,
    type: "Note",
    attributedTo: spammer,
    content: "not a direct message",
    visibility: "public",
    conversation: conv,
  });
  await db.insert(objectRecipients).values({
    objectApId: publicSurvivor,
    recipientApId: alice,
    type: "to",
  });
  const survivorActivity = await surfaceInbound(
    db,
    publicSurvivor,
    spammer,
    alice,
  );

  const { storage, deleted } = recordingStorage();

  const res = await appWith(db, fakeActor(alice, "alice")).fetch(
    new Request(`${APP_URL}/requests/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender_ap_id: spammer }),
    }),
    envFor(db, storage),
  );
  expect(res.status).toEqual(200);

  // Only the two direct messages are gone; the public same-conversation row and
  // each of its projections survive.
  expect(
    (await db.select().from(objects).where(eq(objects.conversation, conv))).map(
      (row) => row.apId,
    ),
  ).toEqual([publicSurvivor]);
  expect(
    (
      await db
        .select()
        .from(activities)
        .where(eq(activities.actorApId, spammer))
    ).map((row) => row.apId),
  ).toEqual([survivorActivity]);
  expect(
    (
      await db.select().from(inboxTable).where(eq(inboxTable.actorApId, alice))
    ).map((row) => row.activityApId),
  ).toEqual([survivorActivity]);
  expect(
    (
      await db
        .select()
        .from(objectRecipients)
        .where(eq(objectRecipients.recipientApId, alice))
    ).map((row) => row.objectApId),
  ).toEqual([publicSurvivor]);
  for (const rows of [
    await db.select().from(likes).where(eq(likes.objectApId, objA)),
    await db.select().from(announces).where(eq(announces.objectApId, objA)),
    await db.select().from(bookmarks).where(eq(bookmarks.objectApId, objA)),
    await db.select().from(mediaUploads).where(eq(mediaUploads.r2Key, r2Key)),
  ]) {
    expect(rows).toHaveLength(0);
  }
  expect(deleted).toEqual([r2Key]);
});

test("POST /requests/reject drains more than one D1-safe object page", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "paged-alice");
  const spammer = await insertLocalActor(db, "paged-spammer");
  const conversation = "conv-paged-spam";

  await insertMany(
    db,
    objects,
    Array.from({ length: 91 }, (_, index) => ({
      apId: `${APP_URL}/ap/objects/paged-${String(index).padStart(3, "0")}`,
      type: "Note",
      attributedTo: spammer,
      content: `spam ${index}`,
      visibility: "direct",
      conversation,
      isLocal: 0,
    })),
  );

  const response = await appWith(db, fakeActor(alice, "paged-alice")).fetch(
    new Request(`${APP_URL}/requests/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender_ap_id: spammer }),
    }),
    envFor(db),
  );
  expect(response.status).toBe(200);
  expect(
    await db
      .select()
      .from(objects)
      .where(eq(objects.conversation, conversation)),
  ).toHaveLength(0);
});

test("archive keys on the STORED (legacy-scheme) conversation id, not the recomputed one", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const carol = await insertLocalActor(db, "carol");

  // A pre-migration conversation whose stored id does NOT equal the value
  // getConversationId would now compute for (alice, carol).
  const legacyConv = `${APP_URL}/ap/conversations/LEGACY16CHARxyz`;
  await insertDm(
    db,
    carol,
    alice,
    legacyConv,
    "L1",
    "2026-06-20T08:00:00.000Z",
  );

  const res = await appWith(db, fakeActor(alice, "alice")).fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(carol)}/archive`, {
      method: "POST",
    }),
    envFor(db),
  );
  expect(res.status).toEqual(200);

  // The archive row matches the STORED legacy conversation, so contacts/unread
  // (which key on the same stored id) actually hide it.
  const archived = await db
    .select()
    .from(dmArchivedConversations)
    .where(
      and(
        eq(dmArchivedConversations.actorApId, alice),
        eq(dmArchivedConversations.conversationId, legacyConv),
      ),
    )
    .get();
  expect(archived).toBeDefined();
});
