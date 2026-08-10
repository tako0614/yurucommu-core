import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  actorCache,
  actors,
  deliveryEndpointRecipients,
  deliveryQueue,
  announces,
  deliveryResolutions,
  follows,
  likes,
  objects,
  remoteActorFetchFailures,
  remoteActorTombstones,
} from "../../../db/index.ts";
import { cacheRemoteActorDocument } from "../../lib/activitypub-actor-cache.ts";
import { upsertDeliveryJob } from "../../lib/delivery/queue.ts";
import { computeDeliveryJobId } from "../../lib/delivery/transformers.ts";
import { handleDelete } from "../../routes/activitypub/handlers/inbox-content-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

// Audit #8 finding #4: an inbound Delete(Actor) (object === actor, the standard
// way a remote announces account deletion) used to be a silent no-op — remote
// actors live in actorCache, never `objects`, so handleDelete's object lookup
// missed and returned. The stale cached profile, the local follow edges, and the
// remote's cached content survived indefinitely (and the local counterpart's
// follower/following counts stayed inflated).

const APP_URL = "https://yuru.test";
const LOCAL = `${APP_URL}/ap/users/bob`;
const REMOTE = "https://remote.example/users/alice";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

function ctxFor(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
    env: { MEDIA: undefined, APP_URL },
  } as unknown as ActivityContext;
}

const deleteActor = (actor: string): Activity =>
  ({
    id: `${actor}#delete`,
    type: "Delete",
    actor,
    object: actor,
  }) as unknown as Activity;

async function remoteDeleteState(db: Database) {
  const local = await db
    .select({
      followerCount: actors.followerCount,
      followingCount: actors.followingCount,
    })
    .from(actors)
    .where(eq(actors.apId, LOCAL))
    .get();
  return {
    local,
    edges: (await db.select().from(follows))
      .map((edge) => `${edge.followerApId}->${edge.followingApId}`)
      .sort(),
    cachedActors: (await db.select({ apId: actorCache.apId }).from(actorCache))
      .map((actor) => actor.apId)
      .sort(),
    tombstones: (
      await db
        .select({ actorApId: remoteActorTombstones.actorApId })
        .from(remoteActorTombstones)
    )
      .map((row) => row.actorApId)
      .sort(),
  };
}

test("inbound Delete(Actor) tombstones a remote: purges actorCache, drops follow edges, reconciles counts, removes cached content", async () => {
  const db = await freshDb();

  // Local actor bob: follows remote alice (1 following) AND is followed by alice
  // (1 follower).
  await db.insert(actors).values({
    apId: LOCAL,
    type: "Person",
    preferredUsername: "bob",
    inbox: `${LOCAL}/inbox`,
    outbox: `${LOCAL}/outbox`,
    followersUrl: `${LOCAL}/followers`,
    followingUrl: `${LOCAL}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    followerCount: 1,
    followingCount: 1,
  });
  // Remote alice cached.
  await db.insert(actorCache).values({
    apId: REMOTE,
    type: "Person",
    inbox: `${REMOTE}/inbox`,
    rawJson: "{}",
  });
  await db
    .insert(follows)
    .values({ followerApId: LOCAL, followingApId: REMOTE, status: "accepted" });
  await db
    .insert(follows)
    .values({ followerApId: REMOTE, followingApId: LOCAL, status: "accepted" });

  // A cached post by alice, with a local like on it.
  const remotePost = "https://remote.example/objects/p1";
  await db.insert(objects).values({
    apId: remotePost,
    type: "Note",
    attributedTo: REMOTE,
    content: "hi",
    visibility: "public",
    isLocal: 0,
  });
  await db.insert(likes).values({
    actorApId: LOCAL,
    objectApId: remotePost,
    activityApId: `${LOCAL}/likes/1`,
  });

  await handleDelete(ctxFor(db), deleteActor(REMOTE));

  // actorCache purged.
  expect(
    (await db.select().from(actorCache).where(eq(actorCache.apId, REMOTE)))
      .length,
  ).toBe(0);
  // Both follow edges gone.
  expect((await db.select().from(follows)).length).toBe(0);
  // Local counterpart counts reconciled to 0 (guarded).
  const bob = await db
    .select({
      followerCount: actors.followerCount,
      followingCount: actors.followingCount,
    })
    .from(actors)
    .where(eq(actors.apId, LOCAL))
    .get();
  expect(bob?.followerCount).toBe(0);
  expect(bob?.followingCount).toBe(0);
  // Cached content + its child rows gone.
  expect(
    (await db.select().from(objects).where(eq(objects.attributedTo, REMOTE)))
      .length,
  ).toBe(0);
  expect((await db.select().from(likes)).length).toBe(0);
});

test("Delete(Actor) uses the verified actor spelling for cosmetic object ids", async () => {
  const db = await freshDb();
  await db.insert(actorCache).values({
    apId: REMOTE,
    type: "Person",
    inbox: `${REMOTE}/inbox`,
    rawJson: "{}",
  });

  await handleDelete(ctxFor(db), {
    id: `${REMOTE}#delete-cosmetic-object`,
    type: "Delete",
    actor: REMOTE,
    object: "https://REMOTE.example/users/alice/",
  } as Activity);

  expect(
    await db.select().from(actorCache).where(eq(actorCache.apId, REMOTE)),
  ).toEqual([]);
  expect(
    await db
      .select({ actorApId: remoteActorTombstones.actorApId })
      .from(remoteActorTombstones),
  ).toEqual([{ actorApId: REMOTE }]);
});

test("Delete(Actor) establishes a durable tombstone that fences a late cache writer", async () => {
  const db = await freshDb();
  await db.insert(actorCache).values({
    apId: REMOTE,
    type: "Person",
    inbox: `${REMOTE}/inbox`,
    rawJson: "{}",
  });
  await db.insert(remoteActorFetchFailures).values({
    actorApId: REMOTE,
    kind: "unavailable",
    reason: "fetch_failed",
    failureCount: 1,
    retryAt: "2026-08-10T00:00:30.000Z",
  });
  await db.insert(deliveryResolutions).values({
    id: "pending-resolution-for-deleted-actor",
    activityApId: `${LOCAL}/activities/pending`,
    recipientActorApId: REMOTE,
  });

  await handleDelete(ctxFor(db), deleteActor(REMOTE));

  expect(await db.select().from(remoteActorTombstones)).toMatchObject([
    {
      actorApId: REMOTE,
      deleteActivityApId: `${REMOTE}#delete`,
    },
  ]);
  expect(await db.select().from(remoteActorFetchFailures)).toEqual([]);
  expect(await db.select().from(deliveryResolutions)).toEqual([]);

  // Model a network read that began before the Delete batch and completes
  // afterwards. A successful document must not recreate the deleted actor.
  const lateCache = await cacheRemoteActorDocument(db, REMOTE, {
    id: REMOTE,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${REMOTE}/inbox`,
  });
  expect(lateCache).toEqual({ ok: false, reason: "actor_tombstoned" });
  expect(await db.select().from(actorCache)).toEqual([]);
});

test("Delete(Actor) cancels only endpoint jobs whose attributed recipient set becomes empty", async () => {
  const db = await freshDb();
  const cosmeticRemote = "https://REMOTE.example/users/alice/";
  const otherRecipient = "https://remote.example/users/carol";
  const activityId = `${LOCAL}/activities/attributed-delivery`;
  const directEndpoint = "https://remote.example/users/alice/inbox";
  const sharedEndpoint = "https://remote.example/inbox";
  const directJobId = await computeDeliveryJobId(activityId, directEndpoint);
  const sharedJobId = await computeDeliveryJobId(activityId, sharedEndpoint);

  expect(
    await upsertDeliveryJob(db, directJobId, activityId, directEndpoint, [
      cosmeticRemote,
    ]),
  ).toBe(true);
  expect(
    await upsertDeliveryJob(db, sharedJobId, activityId, sharedEndpoint, [
      cosmeticRemote,
      otherRecipient,
    ]),
  ).toBe(true);

  await handleDelete(ctxFor(db), deleteActor(REMOTE));

  expect(
    await db
      .select({ id: deliveryQueue.id })
      .from(deliveryQueue)
      .orderBy(deliveryQueue.id),
  ).toEqual([{ id: sharedJobId }]);
  expect(await db.select().from(deliveryEndpointRecipients)).toEqual([
    expect.objectContaining({
      deliveryJobId: sharedJobId,
      recipientActorApId: otherRecipient,
    }),
  ]);
});

test("Delete(Actor) preserves legacy endpoint jobs with unknown attribution", async () => {
  const db = await freshDb();
  await db.insert(deliveryQueue).values({
    id: "legacy-unattributed-job",
    activityApId: `${LOCAL}/activities/legacy-delivery`,
    inboxUrl: "https://remote.example/inbox",
  });

  await handleDelete(ctxFor(db), deleteActor(REMOTE));

  expect(await db.select().from(deliveryQueue).get()).toMatchObject({
    id: "legacy-unattributed-job",
    recipientAttributionComplete: 0,
  });
});

test("Delete(Actor) removes retained state under a legacy cosmetic actor spelling", async () => {
  const db = await freshDb();
  const cosmetic = "https://REMOTE.example/users/alice/";
  const remotePost = "https://remote.example/objects/legacy-cosmetic-post";
  const localPost = "https://yuru.test/ap/objects/local-cosmetic-target";

  await db.insert(actors).values({
    apId: LOCAL,
    type: "Person",
    preferredUsername: "bob",
    inbox: `${LOCAL}/inbox`,
    outbox: `${LOCAL}/outbox`,
    followersUrl: `${LOCAL}/followers`,
    followingUrl: `${LOCAL}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    followerCount: 2,
    followingCount: 2,
  });
  await db.insert(actorCache).values({
    apId: cosmetic,
    type: "Person",
    inbox: `${cosmetic}inbox`,
    rawJson: "{}",
  });
  await db.insert(follows).values([
    { followerApId: LOCAL, followingApId: cosmetic, status: "accepted" },
    { followerApId: cosmetic, followingApId: LOCAL, status: "accepted" },
    { followerApId: LOCAL, followingApId: REMOTE, status: "accepted" },
    { followerApId: REMOTE, followingApId: LOCAL, status: "accepted" },
  ]);
  await db.insert(objects).values([
    {
      apId: remotePost,
      type: "Note",
      attributedTo: cosmetic,
      content: "legacy remote",
      visibility: "public",
      isLocal: 0,
    },
    {
      apId: localPost,
      type: "Note",
      attributedTo: LOCAL,
      content: "local",
      visibility: "public",
      isLocal: 1,
      likeCount: 2,
    },
  ]);
  await db.insert(likes).values([
    {
      actorApId: cosmetic,
      objectApId: localPost,
      activityApId: `${cosmetic}likes/1`,
    },
    {
      actorApId: REMOTE,
      objectApId: localPost,
      activityApId: `${REMOTE}/likes/2`,
    },
  ]);

  await handleDelete(ctxFor(db), deleteActor(REMOTE));

  expect(await db.select().from(actorCache)).toEqual([]);
  expect(await db.select().from(follows)).toEqual([]);
  expect(
    await db.select().from(objects).where(eq(objects.apId, remotePost)),
  ).toEqual([]);
  expect(await db.select().from(likes)).toEqual([]);
  expect(
    await db
      .select({
        followerCount: actors.followerCount,
        followingCount: actors.followingCount,
      })
      .from(actors)
      .where(eq(actors.apId, LOCAL))
      .get(),
  ).toEqual({ followerCount: 0, followingCount: 0 });
  expect(
    await db
      .select({ likeCount: objects.likeCount })
      .from(objects)
      .where(eq(objects.apId, localPost))
      .get(),
  ).toEqual({ likeCount: 0 });
});

test("Delete(Actor) removes every cosmetic alias beyond the legacy 32-row prefix", async () => {
  const db = await freshDb();
  const pathCaseSibling = "https://remote.example/users/Alice";
  const localPost = `${APP_URL}/ap/objects/alias-limit-target`;
  const siblingPost = "https://remote.example/objects/path-case-sibling";
  const targetLikeActor = "https://REMOTE.example:443/users/alice/#interaction";

  await db.insert(actors).values({
    apId: LOCAL,
    type: "Person",
    preferredUsername: "bob",
    inbox: `${LOCAL}/inbox`,
    outbox: `${LOCAL}/outbox`,
    followersUrl: `${LOCAL}/followers`,
    followingUrl: `${LOCAL}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(actorCache).values([
    {
      apId: REMOTE,
      type: "Person",
      inbox: `${REMOTE}/inbox`,
      rawJson: "{}",
    },
    {
      apId: pathCaseSibling,
      type: "Person",
      inbox: `${pathCaseSibling}/inbox`,
      rawJson: "{}",
    },
  ]);
  await db.run(sql`
    WITH RECURSIVE numbers(n) AS (
      VALUES (0)
      UNION ALL
      SELECT n + 1 FROM numbers WHERE n < 32
    )
    INSERT INTO objects (
      ap_id, type, attributed_to, content, visibility, is_local
    )
    SELECT
      'https://remote.example/objects/legacy-alias-' || n,
      'Note',
      'https://REMOTE.example:443/users/alice/#legacy-' || n,
      'legacy remote',
      'public',
      0
    FROM numbers
  `);
  await db.insert(objects).values([
    {
      apId: siblingPost,
      type: "Note",
      attributedTo: pathCaseSibling,
      content: "path-case sibling",
      visibility: "public",
      isLocal: 0,
    },
    {
      apId: localPost,
      type: "Note",
      attributedTo: LOCAL,
      content: "local target",
      visibility: "public",
      isLocal: 1,
      likeCount: 2,
    },
  ]);
  await db.insert(likes).values([
    {
      actorApId: targetLikeActor,
      objectApId: localPost,
      activityApId: `${REMOTE}/likes/alias-limit`,
    },
    {
      actorApId: pathCaseSibling,
      objectApId: localPost,
      activityApId: `${pathCaseSibling}/likes/1`,
    },
  ]);

  await handleDelete(ctxFor(db), deleteActor(REMOTE));

  const retainedRemoteObjects = (await db.select().from(objects)).filter(
    (object) => object.apId.includes("/objects/legacy-alias-"),
  );
  expect(retainedRemoteObjects).toEqual([]);
  expect(await db.select({ actorApId: likes.actorApId }).from(likes)).toEqual([
    { actorApId: pathCaseSibling },
  ]);
  expect(
    await db
      .select({ likeCount: objects.likeCount })
      .from(objects)
      .where(eq(objects.apId, localPost))
      .get(),
  ).toEqual({ likeCount: 1 });
  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, siblingPost)),
  ).toEqual([{ apId: siblingPost }]);
  expect(await db.select({ apId: actorCache.apId }).from(actorCache)).toEqual([
    { apId: pathCaseSibling },
  ]);
});

test("Delete(Actor) rolls back counterpart counters when a later teardown statement fails, then retries exactly", async () => {
  const db = await freshDb();
  const otherRemote = "https://other.example/users/carol";
  await db.insert(actors).values({
    apId: LOCAL,
    type: "Person",
    preferredUsername: "bob",
    inbox: `${LOCAL}/inbox`,
    outbox: `${LOCAL}/outbox`,
    followersUrl: `${LOCAL}/followers`,
    followingUrl: `${LOCAL}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    followerCount: 2,
    followingCount: 2,
  });
  await db.insert(actorCache).values([
    {
      apId: REMOTE,
      type: "Person",
      inbox: `${REMOTE}/inbox`,
      rawJson: "{}",
    },
    {
      apId: otherRemote,
      type: "Person",
      inbox: `${otherRemote}/inbox`,
      rawJson: "{}",
    },
  ]);
  await db.insert(follows).values([
    { followerApId: REMOTE, followingApId: LOCAL, status: "accepted" },
    { followerApId: LOCAL, followingApId: REMOTE, status: "accepted" },
    { followerApId: otherRemote, followingApId: LOCAL, status: "accepted" },
    { followerApId: LOCAL, followingApId: otherRemote, status: "accepted" },
  ]);

  // The pre-fix teardown decremented followerCount first, then followingCount
  // in a separate commit. Reject only the historically-second update: retrying
  // while both remote follow edges remain must not decrement followerCount a
  // second time.
  await db.run(sql`
    CREATE TRIGGER reject_second_remote_actor_counter_update
    BEFORE UPDATE OF following_count ON actors
    WHEN OLD.ap_id = 'https://yuru.test/ap/users/bob'
      AND NEW.following_count = OLD.following_count - 1
    BEGIN
      SELECT RAISE(ABORT, 'simulated remote actor teardown failure');
    END
  `);

  let failed = false;
  try {
    await handleDelete(ctxFor(db), deleteActor(REMOTE));
  } catch {
    failed = true;
  }
  const afterFailure = await remoteDeleteState(db);

  await db.run(sql`DROP TRIGGER reject_second_remote_actor_counter_update`);
  await handleDelete(ctxFor(db), deleteActor(REMOTE));
  const afterRetry = await remoteDeleteState(db);
  await handleDelete(ctxFor(db), deleteActor(REMOTE));
  const afterDuplicate = await remoteDeleteState(db);

  const originalEdges = [
    `${LOCAL}->${REMOTE}`,
    `${LOCAL}->${otherRemote}`,
    `${REMOTE}->${LOCAL}`,
    `${otherRemote}->${LOCAL}`,
  ].sort();
  const survivingEdges = [
    `${LOCAL}->${otherRemote}`,
    `${otherRemote}->${LOCAL}`,
  ].sort();
  expect({ failed, afterFailure, afterRetry, afterDuplicate }).toEqual({
    failed: true,
    afterFailure: {
      local: { followerCount: 2, followingCount: 2 },
      edges: originalEdges,
      cachedActors: [REMOTE, otherRemote].sort(),
      tombstones: [],
    },
    afterRetry: {
      local: { followerCount: 1, followingCount: 1 },
      edges: survivingEdges,
      cachedActors: [otherRemote],
      tombstones: [REMOTE],
    },
    afterDuplicate: {
      local: { followerCount: 1, followingCount: 1 },
      edges: survivingEdges,
      cachedActors: [otherRemote],
      tombstones: [REMOTE],
    },
  });
});

// Audit #18: a Delete(Person) must also reconcile the like/announce/share counts
// the deleted remote bumped on LOCAL posts (and remove its interaction edges) —
// otherwise a throwaway remote could ratchet a victim's counters then self-delete.
test("Delete(Actor) reconciles like/announce counts the remote bumped on LOCAL posts + removes those edges", async () => {
  const db = await freshDb();

  // A local author + their public post, already showing 1 like + 1 boost — both
  // from the remote that is about to self-delete.
  const author = "https://yuru.test/ap/users/carol";
  await db.insert(actors).values({
    apId: author,
    type: "Person",
    preferredUsername: "carol",
    inbox: `${author}/inbox`,
    outbox: `${author}/outbox`,
    followersUrl: `${author}/followers`,
    followingUrl: `${author}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(actorCache).values({
    apId: REMOTE,
    type: "Person",
    inbox: `${REMOTE}/inbox`,
    rawJson: "{}",
  });
  const localPost = "https://yuru.test/ap/objects/local-1";
  await db.insert(objects).values({
    apId: localPost,
    type: "Note",
    attributedTo: author,
    content: "mine",
    visibility: "public",
    isLocal: 1,
    likeCount: 1,
    announceCount: 1,
  });
  await db.insert(likes).values({
    actorApId: REMOTE,
    objectApId: localPost,
    activityApId: `${REMOTE}/likes/1`,
  });
  await db.insert(announces).values({
    actorApId: REMOTE,
    objectApId: localPost,
    activityApId: `${REMOTE}/announces/1`,
  });

  await handleDelete(ctxFor(db), deleteActor(REMOTE));

  // The local post's counts are reconciled back to 0 and the edges are gone.
  const post = await db
    .select({
      likeCount: objects.likeCount,
      announceCount: objects.announceCount,
    })
    .from(objects)
    .where(eq(objects.apId, localPost))
    .get();
  expect(post?.likeCount).toBe(0);
  expect(post?.announceCount).toBe(0);
  expect((await db.select().from(likes)).length).toBe(0);
  expect((await db.select().from(announces)).length).toBe(0);
});

test("Delete(Actor) does not touch a still-live remote when object != actor", async () => {
  const db = await freshDb();
  await db.insert(actorCache).values({
    apId: REMOTE,
    type: "Person",
    inbox: `${REMOTE}/inbox`,
    rawJson: "{}",
  });
  // A Delete whose object is some unknown id (NOT the actor) and matches no
  // stored object: must be a pure no-op, the actor cache stays.
  await handleDelete(ctxFor(db), {
    id: `${REMOTE}#del2`,
    type: "Delete",
    actor: REMOTE,
    object: "https://remote.example/objects/ghost",
  } as unknown as Activity);
  expect(
    (await db.select().from(actorCache).where(eq(actorCache.apId, REMOTE)))
      .length,
  ).toBe(1);
});
