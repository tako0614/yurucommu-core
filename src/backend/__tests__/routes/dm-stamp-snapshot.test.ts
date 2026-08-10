import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import {
  activities,
  actorCache,
  actors,
  communities,
  communityMembers,
  stampEntitlements,
  stampInstallations,
  stampPackReleases,
  stampPacks,
  stampReleaseItems,
  stampRevisions,
  stampRecents,
  stamps,
  type Database,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import communityMessageRoutes from "../../routes/communities/messages.ts";
import dmRoutes from "../../routes/dm/messages.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const NOW = "2026-08-10T00:00:00.000Z";

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

async function seedActor(db: Database, username: string): Promise<string> {
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
    role: "member",
    created_at: NOW,
  };
}

function appFor(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db as never);
    c.set("actor", actor);
    await next();
  });
  app.route("/", communityMessageRoutes);
  app.route("/", dmRoutes);
  return app;
}

async function seedInstalledStamp(db: Database, actorApId: string) {
  const packId = `${APP_URL}/stamp-packs/cat`;
  const releaseId = `${packId}/releases/1`;
  const stampId = `${packId}/stamps/okay`;
  const revisionId = `${stampId}/revisions/rev-1`;
  const revisionDigest = `sha256:${"a".repeat(64)}`;
  const assetSha256 = "b".repeat(64);
  const assetUrl = `/media/stamps/${assetSha256}.webp`;
  const assetR2Key = `stamps/sha256/bb/${assetSha256}.webp`;

  await db.insert(stampPacks).values({
    id: packId,
    publisherActorId: actorApId,
    slug: "cat",
    nameJson: JSON.stringify({ ja: "ゆるねこ" }),
    currentReleaseId: releaseId,
    visibility: "public",
    status: "published",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(stampPackReleases).values({
    id: releaseId,
    packId,
    releaseNumber: 1,
    manifestSha256: "c".repeat(64),
    publishedAt: NOW,
  });
  await db.insert(stamps).values({
    id: stampId,
    packId,
    key: "okay",
    currentRevisionId: revisionId,
    sortOrder: 0,
    enabled: true,
  });
  await db.insert(stampRevisions).values({
    id: revisionId,
    stampId,
    revisionDigest,
    assetUrl,
    assetR2Key,
    mediaType: "image/webp",
    width: 512,
    height: 512,
    assetSha256,
    altJson: JSON.stringify({ ja: "了解！" }),
    tagsJson: JSON.stringify(["了解", "OK"]),
    animated: false,
    createdAt: NOW,
  });
  await db.insert(stampReleaseItems).values({
    releaseId,
    stampId,
    revisionId,
    sortOrder: 0,
  });
  await db.insert(stampEntitlements).values({
    actorApId,
    packId,
    canInstall: true,
    canSend: true,
    source: "free",
    grantedAt: NOW,
  });
  await db.insert(stampInstallations).values({
    actorApId,
    packId,
    installedReleaseId: releaseId,
    autoUpdate: true,
    sortOrder: 0,
    installedAt: NOW,
  });

  return {
    packId,
    releaseId,
    stampId,
    revisionId,
    revisionDigest,
    assetSha256,
    assetUrl,
  };
}

async function advanceInstalledStamp(
  db: Database,
  actorApId: string,
  original: Awaited<ReturnType<typeof seedInstalledStamp>>,
) {
  const release2 = `${original.packId}/releases/2`;
  const revision2 = `${original.stampId}/revisions/rev-2`;
  await db.insert(stampPackReleases).values({
    id: release2,
    packId: original.packId,
    releaseNumber: 2,
    manifestSha256: "d".repeat(64),
    publishedAt: "2026-08-10T01:00:00.000Z",
  });
  await db.insert(stampRevisions).values({
    id: revision2,
    stampId: original.stampId,
    revisionDigest: `sha256:${"e".repeat(64)}`,
    assetUrl: `/media/stamps/${"f".repeat(64)}.png`,
    assetR2Key: `stamps/sha256/ff/${"f".repeat(64)}.png`,
    mediaType: "image/png",
    width: 256,
    height: 256,
    assetSha256: "f".repeat(64),
    altJson: JSON.stringify({ ja: "別の画像" }),
    tagsJson: "[]",
    animated: false,
    createdAt: "2026-08-10T01:00:00.000Z",
  });
  await db.insert(stampReleaseItems).values({
    releaseId: release2,
    stampId: original.stampId,
    revisionId: revision2,
    sortOrder: 0,
  });
  await db
    .update(stamps)
    .set({ currentRevisionId: revision2 })
    .where(eq(stamps.id, original.stampId));
  await db
    .update(stampPacks)
    .set({ currentReleaseId: release2 })
    .where(eq(stampPacks.id, original.packId));
  await db
    .update(stampInstallations)
    .set({ installedReleaseId: release2 })
    .where(eq(stampInstallations.actorApId, actorApId));
}

test("a DM Stamp selection becomes a server-owned immutable snapshot", async () => {
  const { db } = await createTestDb();
  const alice = await seedActor(db, "alice");
  const bob = await seedActor(db, "bob");
  const stamp = await seedInstalledStamp(db, alice);
  const app = appFor(db, fakeActor(alice, "alice"));

  const response = await app.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stamp: { stamp_id: stamp.stampId } }),
    }),
    { APP_URL, DB_INSTANCE: db } as Env,
  );

  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    message: { content: string; stamp?: unknown };
  };
  expect(body.message.content).toBe("[Stamp: 了解！]");
  expect(body.message.stamp).toEqual({
    id: stamp.stampId,
    pack_id: stamp.packId,
    revision: stamp.revisionDigest,
    asset: {
      url: stamp.assetUrl,
      media_type: "image/webp",
      width: 512,
      height: 512,
      sha256: stamp.assetSha256,
    },
    alt: "了解！",
  });
  expect(
    await db
      .select({
        stampId: stampRecents.stampId,
        useCount: stampRecents.useCount,
      })
      .from(stampRecents)
      .where(eq(stampRecents.actorApId, alice))
      .get(),
  ).toEqual({ stampId: stamp.stampId, useCount: 1 });
});

test("DM history keeps the sent revision after the installed pack advances", async () => {
  const { db } = await createTestDb();
  const alice = await seedActor(db, "alice");
  const bob = await seedActor(db, "bob");
  const original = await seedInstalledStamp(db, alice);
  const aliceApp = appFor(db, fakeActor(alice, "alice"));

  const sendResponse = await aliceApp.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(bob)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stamp: { stamp_id: original.stampId } }),
    }),
    { APP_URL, DB_INSTANCE: db } as Env,
  );
  expect(sendResponse.status).toBe(201);

  await advanceInstalledStamp(db, alice, original);

  const bobApp = appFor(db, fakeActor(bob, "bob"));
  const historyResponse = await bobApp.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(alice)}/messages`),
    { APP_URL, DB_INSTANCE: db } as Env,
  );
  expect(historyResponse.status).toBe(200);
  const history = (await historyResponse.json()) as {
    messages: Array<{ stamp?: unknown }>;
  };
  expect(history.messages).toHaveLength(1);
  expect(history.messages[0]?.stamp).toEqual({
    id: original.stampId,
    pack_id: original.packId,
    revision: original.revisionDigest,
    asset: {
      url: original.assetUrl,
      media_type: "image/webp",
      width: 512,
      height: 512,
      sha256: original.assetSha256,
    },
    alt: "了解！",
  });
});

test("community history keeps the sent Stamp revision after the pack advances", async () => {
  const { db } = await createTestDb();
  const alice = await seedActor(db, "alice");
  const bob = await seedActor(db, "bob");
  const original = await seedInstalledStamp(db, alice);
  const communityApId = `${APP_URL}/ap/groups/town`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "town",
    name: "town",
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    visibility: "public",
    postPolicy: "members",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: alice,
  });
  await db.insert(communityMembers).values([
    { communityApId, actorApId: alice, role: "owner" },
    { communityApId, actorApId: bob, role: "member" },
  ]);
  const aliceApp = appFor(db, fakeActor(alice, "alice"));

  const sendResponse = await aliceApp.fetch(
    new Request(`${APP_URL}/town/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stamp: { stamp_id: original.stampId } }),
    }),
    { APP_URL, DB_INSTANCE: db } as Env,
  );
  expect(sendResponse.status).toBe(201);
  await advanceInstalledStamp(db, alice, original);

  const bobApp = appFor(db, fakeActor(bob, "bob"));
  const historyResponse = await bobApp.fetch(
    new Request(`${APP_URL}/town/messages`),
    { APP_URL, DB_INSTANCE: db } as Env,
  );
  expect(historyResponse.status).toBe(200);
  const history = (await historyResponse.json()) as {
    messages: Array<{ stamp?: unknown }>;
  };
  expect(history.messages).toHaveLength(1);
  expect(history.messages[0]?.stamp).toEqual({
    id: original.stampId,
    pack_id: original.packId,
    revision: original.revisionDigest,
    asset: {
      url: original.assetUrl,
      media_type: "image/webp",
      width: 512,
      height: 512,
      sha256: original.assetSha256,
    },
    alt: "了解！",
  });
});

test("remote DM federates a Stamp as Note + standard Image + extension", async () => {
  const { db } = await createTestDb();
  const alice = await seedActor(db, "alice");
  const remoteBob = "https://remote.example/users/bob";
  await db.insert(actorCache).values({
    apId: remoteBob,
    type: "Person",
    preferredUsername: "bob",
    inbox: `${remoteBob}/inbox`,
    rawJson: JSON.stringify({ id: remoteBob, type: "Person" }),
  });
  const stamp = await seedInstalledStamp(db, alice);
  const app = appFor(db, fakeActor(alice, "alice"));

  const response = await app.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(remoteBob)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stamp: { stamp_id: stamp.stampId } }),
    }),
    { APP_URL, DB_INSTANCE: db } as Env,
  );
  expect(response.status).toBe(201);

  const activity = await db
    .select({ rawJson: activities.rawJson })
    .from(activities)
    .where(eq(activities.direction, "outbound"))
    .get();
  const create = JSON.parse(activity!.rawJson) as {
    "@context": unknown;
    object: { type: string; content: string; attachment: unknown[] };
  };
  expect(create["@context"]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        yurucommu: expect.objectContaining({
          "@id": "https://yurucommu.com/ns/stamp#",
        }),
      }),
    ]),
  );
  expect(create.object.type).toBe("Note");
  expect(create.object.content).toBe("[Stamp: 了解！]");
  expect(create.object.attachment).toEqual([
    {
      type: "Image",
      mediaType: "image/webp",
      url: `${APP_URL}${stamp.assetUrl}`,
      name: "了解！",
      width: 512,
      height: 512,
      "yurucommu:stamp": stamp.stampId,
      "yurucommu:pack": stamp.packId,
      "yurucommu:revision": stamp.revisionDigest,
      "yurucommu:sha256": stamp.assetSha256,
    },
  ]);
});
