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
  actorCache,
  announces,
  bookmarks,
  blocks,
  follows,
  actorWriteAssertions,
  mediaBlobDeletionJobs,
  dmPeerArchivedConversations,
  inbox as inboxTable,
  likes,
  mediaUploads,
  objectRecipients,
  objects,
  insertMany,
  runBatch,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import dmRoutes from "../../routes/dm/conversations.ts";
import dmMessages from "../../routes/dm/messages.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import { prepareObjectsDeleteCascade } from "../../routes/posts/delete-cascade.ts";
import { guardActorWrites } from "../../lib/account-deletion-admission.ts";
import { generateKeyPair, signRequest } from "../../federation-helpers.ts";
import activityPubOutbox from "../../routes/activitypub/outbox.ts";

const APP_URL = "https://yuru.test";
const localReadKeys = generateKeyPair();

for (const route of ["/requests/reject", "/requests/reject-pending"]) {
  for (const block of [true, false]) {
    test(`${route} block=${block} preserves the canonical follow and signed-read policy`, async () => {
      const { db, client } = await createTestDb();
      try {
        const alice = await insertLocalActor(db, "block-alice"),
          bob = await insertLocalActor(db, "block-bob"),
          carol = await insertLocalActor(db, "unrelated-carol");
        for (const [followerApId, followingApId] of [
          [alice, bob],
          [bob, alice],
          [alice, carol],
          [carol, alice],
        ])
          await db.insert(follows).values({
            followerApId,
            followingApId,
            status: "accepted",
            acceptedAt: "2026-11-12T00:00:00.000Z",
          });
        await db.update(actors).set({ followerCount: 1, followingCount: 1 });
        await db
          .update(actors)
          .set({ followerCount: 2, followingCount: 2 })
          .where(eq(actors.apId, alice));
        await insertDm(
          db,
          bob,
          alice,
          "block-pair",
          "block-request",
          "2026-11-12T00:00:00Z",
        );
        const postUrl = `${APP_URL}/ap/objects/followers-fixture`;
        await db.insert(objects).values({
          apId: postUrl,
          type: "Note",
          attributedTo: alice,
          content: "local followers-only fixture",
          visibility: "followers",
          toJson: "[]",
          ccJson: "[]",
          audienceJson: "[]",
          isLocal: 1,
        });
        // Ephemeral signer and fresh public cache are local fixtures only. The
        // actual GET signature verifier needs no remote key fetch or real ID.
        const keys = await localReadKeys,
          keyId = `${bob}#main-key`;
        await db.insert(actorCache).values({
          apId: bob,
          inbox: `${bob}/inbox`,
          publicKeyPem: keys.publicKeyPem,
          publicKeyId: keyId,
          lastFetchedAt: new Date().toISOString(),
          rawJson: JSON.stringify({
            id: bob,
            type: "Person",
            publicKey: {
              id: keyId,
              owner: bob,
              publicKeyPem: keys.publicKeyPem,
            },
          }),
        });
        const app = appWith(db, fakeActor(alice, "block-alice"));
        app.route("/", activityPubOutbox);
        const read = async () =>
          app.fetch(
            new Request(postUrl, {
              headers: await signRequest(
                keys.privateKeyPem,
                keyId,
                "GET",
                postUrl,
              ),
            }),
            envFor(db),
          );
        expect((await read()).status).toBe(200);
        const response = await app.fetch(
          new Request(`${APP_URL}${route}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sender_ap_id: bob, block }),
          }),
          envFor(db),
        );
        expect(response.status).toBe(200);
        expect(await db.select().from(blocks)).toHaveLength(block ? 1 : 0);
        expect((await read()).status).toBe(block ? 404 : 200);
        expect(await db.select().from(follows)).toHaveLength(block ? 2 : 4);
        const counts = await db
          .select({
            apId: actors.apId,
            followers: actors.followerCount,
            following: actors.followingCount,
          })
          .from(actors)
          .orderBy(actors.apId);
        expect(counts).toEqual([
          { apId: alice, followers: block ? 1 : 2, following: block ? 1 : 2 },
          { apId: bob, followers: block ? 0 : 1, following: block ? 0 : 1 },
          { apId: carol, followers: 1, following: 1 },
        ]);
      } finally {
        client.close();
      }
    });
  }
}

test("stale reject-with-block leaves accepted follows and counters byte-identical", async () => {
  const { db, client } = await createTestDb();
  try {
    const alice = await insertLocalActor(db, "stale-block-alice"),
      bob = await insertLocalActor(db, "stale-block-bob");
    for (const [followerApId, followingApId] of [
      [alice, bob],
      [bob, alice],
    ])
      await db
        .insert(follows)
        .values({ followerApId, followingApId, status: "accepted" });
    await db.update(actors).set({ followerCount: 1, followingCount: 1 });
    await insertDm(
      db,
      bob,
      alice,
      "accepted-pair",
      "pending-before-reply",
      "2026-11-12T00:00:00Z",
    );
    await insertDm(
      db,
      alice,
      bob,
      "accepted-pair",
      "reply",
      "2026-11-12T00:01:00Z",
    );
    const snapshot = async () => ({
      follows: await db.select().from(follows),
      actors: await db.select().from(actors),
      blocks: await db.select().from(blocks),
    });
    const before = await snapshot();
    const response = await appWith(
      db,
      fakeActor(alice, "stale-block-alice"),
    ).fetch(
      new Request(`${APP_URL}/requests/reject-pending`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender_ap_id: bob, block: true }),
      }),
      envFor(db),
    );
    expect(response.status).toBe(409);
    expect(await snapshot()).toEqual(before);
  } finally {
    client.close();
  }
});

async function rejectSnapshot(db: Database) {
  return {
    objects: await db.select().from(objects),
    recipients: await db.select().from(objectRecipients),
    activities: await db.select().from(activities),
    inbox: await db.select().from(inboxTable),
    likes: await db.select().from(likes),
    bookmarks: await db.select().from(bookmarks),
    uploads: await db.select().from(mediaUploads),
    mediaIntents: await db.select().from(mediaBlobDeletionJobs),
    assertions: await db.select().from(actorWriteAssertions),
    blocks: await db.select().from(blocks),
  };
}

test("a stale request accepted on another device is not deleted or blocked", async () => {
  const fixture = await createTestDb(),
    db = fixture.db;
  try {
    const alice = await insertLocalActor(db, "stale-alice"),
      bob = await insertLocalActor(db, "stale-bob");
    const message = await insertDm(
      db,
      bob,
      alice,
      "stale-pair",
      "pending",
      "2026-11-05T00:00:00Z",
    );
    await surfaceInbound(db, message, bob, alice);
    const app = appWith(db, fakeActor(alice, "stale-alice"));
    const list = await app.fetch(
      new Request(`${APP_URL}/requests`),
      envFor(db),
    );
    expect(
      ((await list.json()) as { requests: unknown[] }).requests,
    ).toHaveLength(1);
    const reply = await app.fetch(
      new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "accepted on another device" }),
      }),
      envFor(db),
    );
    expect(reply.status).toBe(201);
    const before = await rejectSnapshot(db);
    const response = await app.fetch(
      new Request(`${APP_URL}/requests/reject-pending`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender_ap_id: bob, block: true }),
      }),
      envFor(db),
    );
    expect(response.status).toBe(409);
    expect(await rejectSnapshot(db)).toEqual(before);
    expect(await db.select().from(blocks)).toHaveLength(0);
  } finally {
    fixture.client.close();
  }
});

test("acceptance after preparation but before the atomic reject batch has zero delete effects", async () => {
  const fixture = await createTestDb(),
    db = fixture.db;
  try {
    const alice = await insertLocalActor(db, "race-alice"),
      bob = await insertLocalActor(db, "race-bob");
    const message = await insertDm(
      db,
      bob,
      alice,
      "race-pair",
      "pending-race",
      "2026-11-05T00:00:00Z",
    );
    await surfaceInbound(db, message, bob, alice);
    const app = appWith(db, fakeActor(alice, "race-alice"));
    const batch = fixture.client.batch.bind(fixture.client);
    let injected = false,
      before: Awaited<ReturnType<typeof rejectSnapshot>> | undefined;
    fixture.client.batch = (async (statements, ...rest) => {
      if (
        !injected &&
        statements.some((statement) =>
          String(
            typeof statement === "string"
              ? statement
              : Array.isArray(statement)
                ? statement[0]
                : statement.sql,
          )
            .toLowerCase()
            .includes("delete from"),
        )
      ) {
        injected = true;
        const reply = await app.fetch(
          new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: "accepted before mutation" }),
          }),
          envFor(db),
        );
        expect(reply.status).toBe(201);
        before = await rejectSnapshot(db);
      }
      return batch(statements, ...rest);
    }) as typeof fixture.client.batch;
    const response = await app.fetch(
      new Request(`${APP_URL}/requests/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender_ap_id: bob }),
      }),
      envFor(db),
    );
    expect(injected).toBe(true);
    expect(response.status).toBe(409);
    expect(before).toBeDefined();
    expect(await rejectSnapshot(db)).toEqual(before!);
  } finally {
    fixture.client.close();
  }
});

test("a reply between guarded pages stops remaining pages and never acknowledges complete rejection", async () => {
  const fixture = await createTestDb(),
    db = fixture.db;
  try {
    const alice = await insertLocalActor(db, "page-race-alice"),
      bob = await insertLocalActor(db, "page-race-bob");
    for (let index = 0; index < 85; index++) {
      const message = await insertDm(
        db,
        bob,
        alice,
        "page-race",
        `page-${String(index).padStart(3, "0")}`,
        "2026-11-05T00:00:00Z",
      );
      await surfaceInbound(db, message, bob, alice);
    }
    const viewer = fakeActor(alice, "page-race-alice");
    // Production's account-deletion guard must compose with the request guard.
    const app = appWith(guardActorWrites(db, viewer), viewer);
    const batch = fixture.client.batch.bind(fixture.client);
    let pages = 0,
      before: Awaited<ReturnType<typeof rejectSnapshot>> | undefined;
    fixture.client.batch = (async (statements, ...rest) => {
      if (
        statements.some((statement) =>
          /delete from "objects"/i.test(
            String(
              typeof statement === "string"
                ? statement
                : Array.isArray(statement)
                  ? statement[0]
                  : statement.sql,
            ),
          ),
        )
      ) {
        pages += 1;
        if (pages === 2) {
          const reply = await app.fetch(
            new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ content: "accepted between pages" }),
            }),
            envFor(db),
          );
          expect(reply.status).toBe(201);
          before = await rejectSnapshot(db);
        }
      }
      return batch(statements, ...rest);
    }) as typeof fixture.client.batch;
    const response = await app.fetch(
      new Request(`${APP_URL}/requests/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender_ap_id: bob, block: true }),
      }),
      envFor(db),
    );
    expect(response.status).toBe(409);
    expect(pages).toBe(2);
    expect(before).toBeDefined();
    expect(await rejectSnapshot(db)).toEqual(before!);
    expect(
      await db.select().from(objects).where(eq(objects.attributedTo, bob)),
    ).toHaveLength(45);
    expect(
      await db.select().from(inboxTable).where(eq(inboxTable.actorApId, alice)),
    ).toHaveLength(45);
    expect(await db.select().from(blocks)).toHaveLength(0);
    expect(await db.select().from(actorWriteAssertions)).toHaveLength(0);
  } finally {
    fixture.client.close();
  }
});

test("changed attachment metadata invalidates the prepared cascade without deleting children", async () => {
  const fixture = await createTestDb(),
    db = fixture.db;
  try {
    const alice = await insertLocalActor(db, "metadata-alice"),
      bob = await insertLocalActor(db, "metadata-bob");
    const message = await insertDm(
      db,
      bob,
      alice,
      "metadata-pair",
      "metadata",
      "2026-11-05T00:00:00Z",
    );
    await surfaceInbound(db, message, bob, alice);
    const initial = await rejectSnapshot(db);
    const plan = await prepareObjectsDeleteCascade(db, [message]);
    expect(plan.objects[0]?.apId).toBe(message);
    expect(plan.batches).toHaveLength(1);
    expect(await rejectSnapshot(db)).toEqual(initial);
    const batch = fixture.client.batch.bind(fixture.client);
    let before: Awaited<ReturnType<typeof rejectSnapshot>> | undefined;
    fixture.client.batch = (async (statements, ...rest) => {
      if (!before) {
        await db
          .update(objects)
          .set({
            attachmentsJson: JSON.stringify([
              { url: "https://remote.example/new.png" },
            ]),
          })
          .where(eq(objects.apId, message));
        before = await rejectSnapshot(db);
      }
      return batch(statements, ...rest);
    }) as typeof fixture.client.batch;
    const response = await appWith(
      db,
      fakeActor(alice, "metadata-alice"),
    ).fetch(
      new Request(`${APP_URL}/requests/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender_ap_id: bob }),
      }),
      envFor(db),
    );
    expect(response.status).toBe(409);
    expect(await rejectSnapshot(db)).toEqual(before!);
  } finally {
    fixture.client.close();
  }
});

test("a failed final object delete rolls back its activity, recipient and projection cleanup", async () => {
  const fixture = await createTestDb(),
    db = fixture.db;
  try {
    const alice = await insertLocalActor(db, "rollback-alice"),
      bob = await insertLocalActor(db, "rollback-bob");
    const message = await insertDm(
      db,
      bob,
      alice,
      "rollback-pair",
      "rollback",
      "2026-11-05T00:00:00Z",
    );
    await surfaceInbound(db, message, bob, alice);
    await fixture.client.execute(
      "CREATE TRIGGER synthetic_reject_failure BEFORE DELETE ON objects BEGIN SELECT RAISE(ABORT, 'synthetic final delete failure'); END",
    );
    const before = await rejectSnapshot(db);
    const app = appWith(db, fakeActor(alice, "rollback-alice"));
    app.onError((_error, c) =>
      c.json({ error: "controlled test DB failure" }, 500),
    );
    const response = await app.fetch(
      new Request(`${APP_URL}/requests/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender_ap_id: bob }),
      }),
      envFor(db),
    );
    expect(response.status).toBe(500);
    expect(await rejectSnapshot(db)).toEqual(before);
  } finally {
    fixture.client.close();
  }
});

function canonicalKey(label: string): string {
  const digest = [...new TextEncoder().encode(label)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 64)
    .padEnd(64, "0");
  return `uploads/${digest}.jpg`;
}

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
  app.route("/", dmMessages);
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

test("request list keeps two pending senders with the same legacy conversation ID", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  const carol = await insertLocalActor(db, "carol");
  const conversation = "legacy-shared-requests";
  await insertDm(
    db,
    bob,
    alice,
    conversation,
    "bob-request",
    "2026-06-20T10:00:00.000Z",
  );
  await insertDm(
    db,
    carol,
    alice,
    conversation,
    "carol-request",
    "2026-06-20T10:01:00.000Z",
  );
  const app = appWith(db, fakeActor(alice, "alice"));
  const contacts = await app.fetch(
    new Request(`${APP_URL}/contacts`),
    envFor(db),
  );
  expect(contacts.status).toBe(200);
  expect(
    ((await contacts.json()) as { request_count: number }).request_count,
  ).toBe(2);
  const response = await app.fetch(
    new Request(`${APP_URL}/requests`),
    envFor(db),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    requests: { sender: { ap_id: string } }[];
  };
  expect(body.requests.map((row) => row.sender.ap_id).sort()).toEqual([
    bob,
    carol,
  ]);
});

test("replying to one legacy peer leaves the other peer's request pending", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  const carol = await insertLocalActor(db, "carol");
  const conversation = "legacy-replied-request";
  await insertDm(
    db,
    bob,
    alice,
    conversation,
    "bob-incoming",
    "2026-06-20T10:00:00.000Z",
  );
  await insertDm(
    db,
    carol,
    alice,
    conversation,
    "carol-incoming",
    "2026-06-20T10:01:00.000Z",
  );
  await insertDm(
    db,
    alice,
    bob,
    conversation,
    "reply-to-bob",
    "2026-06-20T10:02:00.000Z",
  );
  const app = appWith(db, fakeActor(alice, "alice"));
  const contacts = await app.fetch(
    new Request(`${APP_URL}/contacts`),
    envFor(db),
  );
  expect(contacts.status).toBe(200);
  expect(
    ((await contacts.json()) as { request_count: number }).request_count,
  ).toBe(1);
  const response = await app.fetch(
    new Request(`${APP_URL}/requests`),
    envFor(db),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    requests: { sender: { ap_id: string } }[];
  };
  expect(body.requests.map((row) => row.sender.ap_id)).toEqual([carol]);
});

test("replied threads cannot fill the request cap and hide an older pending peer", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  const carol = await insertLocalActor(db, "carol");
  await insertDm(
    db,
    carol,
    alice,
    "quiet-pending",
    "quiet-pending",
    "2026-06-19T10:00:00.000Z",
  );
  for (let index = 0; index < 501; index++) {
    const conversation = `replied-${index}`;
    await insertDm(
      db,
      bob,
      alice,
      conversation,
      `incoming-${index}`,
      "2026-06-20T10:00:00.000Z",
    );
    await insertDm(
      db,
      alice,
      bob,
      conversation,
      `reply-${index}`,
      "2026-06-20T11:00:00.000Z",
    );
  }
  expect(await db.select({ id: objects.apId }).from(objects)).toHaveLength(
    1003,
  );
  const response = await appWith(db, fakeActor(alice, "alice")).fetch(
    new Request(`${APP_URL}/requests`),
    envFor(db),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    requests: { id: string; sender: { ap_id: string } }[];
  };
  expect(body.requests.map((row) => [row.id, row.sender.ap_id])).toEqual([
    [`${APP_URL}/ap/objects/quiet-pending`, carol],
  ]);
});

test("rejecting a request preserves the sender's colliding DM to another recipient", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  const carol = await insertLocalActor(db, "carol");
  const conversation = "legacy-shared-thread";
  const rejected = await insertDm(
    db,
    bob,
    alice,
    conversation,
    "rejected",
    "2026-06-20T10:00:00.000Z",
  );
  const survivor = await insertDm(
    db,
    bob,
    carol,
    conversation,
    "other-recipient",
    "2026-06-20T10:01:00.000Z",
  );
  await surfaceInbound(db, rejected, bob, alice);
  const activity = await surfaceInbound(db, survivor, bob, carol);
  const key = canonicalKey("other-recipient-private");
  await db
    .update(objects)
    .set({
      attachmentsJson: JSON.stringify([
        {
          type: "Document",
          url: `/media/${key.slice("uploads/".length)}`,
          r2_key: key,
        },
      ]),
    })
    .where(eq(objects.apId, survivor));
  await db.insert(mediaUploads).values({
    id: "other-recipient-upload",
    r2Key: key,
    uploaderApId: bob,
    contentType: "image/jpeg",
    size: 123,
  });
  const snapshot = async () => ({
    objects: await db.select().from(objects).where(eq(objects.apId, survivor)),
    activities: await db
      .select()
      .from(activities)
      .where(eq(activities.apId, activity)),
    recipients: await db
      .select()
      .from(objectRecipients)
      .where(eq(objectRecipients.objectApId, survivor)),
    inbox: await db
      .select()
      .from(inboxTable)
      .where(eq(inboxTable.actorApId, carol)),
    uploads: await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, key)),
  });
  const before = await snapshot();
  const { storage, deleted } = recordingStorage();
  const readAsCarol = async () => {
    const response = await appWith(db, fakeActor(carol, "carol")).fetch(
      new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`),
      envFor(db, storage),
    );
    expect(response.status).toBe(200);
    return (
      (await response.json()) as { messages: { id: string }[] }
    ).messages.map((row) => row.id);
  };
  expect(await readAsCarol()).toEqual([survivor]);
  const response = await appWith(db, fakeActor(alice, "alice")).fetch(
    new Request(`${APP_URL}/requests/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender_ap_id: bob }),
    }),
    envFor(db, storage),
  );
  expect(response.status).toBe(200);
  expect(await readAsCarol()).toEqual([survivor]);
  expect(await snapshot()).toEqual(before);
  expect(deleted).toEqual([]);
  expect(
    await db.select().from(objects).where(eq(objects.apId, rejected)),
  ).toHaveLength(0);
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
  const r2Key = canonicalKey("rejected-private");
  await db
    .update(objects)
    .set({
      attachmentsJson: JSON.stringify([
        {
          type: "Document",
          url: `/media/${r2Key.slice("uploads/".length)}`,
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

  const rows = Array.from({ length: 91 }, (_, index) => ({
    apId: `${APP_URL}/ap/objects/paged-${String(index).padStart(3, "0")}`,
    type: "Note",
    attributedTo: spammer,
    content: `spam ${index}`,
    visibility: "direct",
    toJson: JSON.stringify([alice]),
    conversation,
    isLocal: 0,
  }));
  const [first, ...rest] = [
    ...insertMany(db, objects, rows),
    ...insertMany(
      db,
      objectRecipients,
      rows.map((row) => ({
        objectApId: row.apId,
        recipientApId: alice,
        type: "to",
      })),
    ),
  ];
  if (!first) throw new Error("Expected a nonempty paged DM fixture");
  await runBatch(db, [first, ...rest]);

  expect(
    await db
      .select()
      .from(objects)
      .where(eq(objects.conversation, conversation)),
  ).toHaveLength(91);
  expect(
    await db
      .select()
      .from(objectRecipients)
      .where(eq(objectRecipients.recipientApId, alice)),
  ).toHaveLength(91);

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

test("peer archive retains the STORED legacy conversation id rather than a recomputed one", async () => {
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

  // The peer key isolates collisions, while preserving the STORED legacy
  // conversation as provenance. It must not substitute a current-scheme ID.
  const archived = await db
    .select()
    .from(dmPeerArchivedConversations)
    .where(
      and(
        eq(dmPeerArchivedConversations.actorApId, alice),
        eq(dmPeerArchivedConversations.targetApId, carol),
        eq(dmPeerArchivedConversations.conversationId, legacyConv),
      ),
    )
    .get();
  expect(archived).toBeDefined();
  const contacts = await appWith(db, fakeActor(alice, "alice")).fetch(
    new Request(`${APP_URL}/contacts`),
    envFor(db),
  );
  expect(
    ((await contacts.json()) as { mutual_followers: unknown[] })
      .mutual_followers,
  ).toEqual([]);
});
