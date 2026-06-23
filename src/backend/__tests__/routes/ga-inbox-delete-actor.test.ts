import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actorCache,
  actors,
  announces,
  follows,
  likes,
  objects,
} from "../../../db/index.ts";
import { handleDelete } from "../../routes/activitypub/handlers/inbox-content-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

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
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
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
