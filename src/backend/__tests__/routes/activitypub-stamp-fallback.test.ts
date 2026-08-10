import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  actors,
  messageStampRefs,
  objects,
  stampAssetMirrors,
  type Database,
} from "../../../db/index.ts";
import { handleCreate } from "../../routes/activitypub/handlers/inbox-content-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const LOCAL_BOB = `${APP_URL}/ap/users/bob`;
const REMOTE_ALICE = "https://remote.example/users/alice";
const MESSAGE_ID = "https://remote.example/objects/stamp-message";
const STAMP_ID = "https://remote.example/stamp-packs/cat/stamps/okay";
const PACK_ID = "https://remote.example/stamp-packs/cat";
const REVISION = `sha256:${"a".repeat(64)}`;
const ASSET_SHA256 = "b".repeat(64);
const ASSET_URL = `https://cdn.remote.example/stamps/${ASSET_SHA256}.webp`;

async function setup(): Promise<Database> {
  const { db } = await createTestDb();
  for (const [apId, username] of [
    [LOCAL_BOB, "bob"],
    [REMOTE_ALICE, "alice"],
  ] as const) {
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
  return db;
}

function contextFor(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
    env: { MEDIA: undefined },
  } as unknown as ActivityContext;
}

function recipientRow() {
  return { apId: LOCAL_BOB } as unknown as Parameters<typeof handleCreate>[2];
}

function remoteStampActivity(overrides?: Record<string, unknown>): Activity {
  return {
    id: `${MESSAGE_ID}/activity`,
    type: "Create",
    actor: REMOTE_ALICE,
    to: [LOCAL_BOB],
    object: {
      id: MESSAGE_ID,
      type: "Note",
      attributedTo: REMOTE_ALICE,
      to: [LOCAL_BOB],
      content: "[Stamp: 了解！]",
      attachment: [
        {
          type: "Image",
          mediaType: "image/webp",
          url: ASSET_URL,
          name: "了解！",
          width: 512,
          height: 512,
          "yurucommu:stamp": STAMP_ID,
          "yurucommu:pack": PACK_ID,
          "yurucommu:revision": REVISION,
          "yurucommu:sha256": ASSET_SHA256,
          ...overrides,
        },
      ],
    },
  } as Activity;
}

test("inbound Note + Image stores a Message-owned Stamp snapshot", async () => {
  const db = await setup();

  await handleCreate(
    contextFor(db),
    remoteStampActivity(),
    recipientRow(),
    REMOTE_ALICE,
    APP_URL,
  );

  const ref = await db
    .select()
    .from(messageStampRefs)
    .where(eq(messageStampRefs.messageId, MESSAGE_ID))
    .get();
  expect(ref).toMatchObject({
    stampUri: STAMP_ID,
    packUri: PACK_ID,
    revisionId: null,
    revisionDigest: REVISION,
    remoteAssetUrl: ASSET_URL,
    localAssetR2Key: null,
    mediaType: "image/webp",
    width: 512,
    height: 512,
    assetSha256: ASSET_SHA256,
    altText: "了解！",
  });
  expect(await db.select().from(stampAssetMirrors).get()).toMatchObject({
    assetSha256: ASSET_SHA256,
    remoteAssetUrl: ASSET_URL,
    status: "pending",
  });
});

test("invalid Stamp metadata remains an ordinary federated image", async () => {
  const db = await setup();

  await handleCreate(
    contextFor(db),
    remoteStampActivity({ "yurucommu:sha256": "not-a-digest" }),
    recipientRow(),
    REMOTE_ALICE,
    APP_URL,
  );

  const stored = await db
    .select({ attachmentsJson: objects.attachmentsJson })
    .from(objects)
    .where(eq(objects.apId, MESSAGE_ID))
    .get();
  expect(stored).toBeDefined();
  expect(JSON.parse(stored!.attachmentsJson)).toHaveLength(1);
  expect(
    await db
      .select()
      .from(messageStampRefs)
      .where(eq(messageStampRefs.messageId, MESSAGE_ID)),
  ).toEqual([]);
});

test("duplicate delivery repairs a missing Stamp snapshot projection", async () => {
  const db = await setup();
  const activity = remoteStampActivity();

  await handleCreate(
    contextFor(db),
    activity,
    recipientRow(),
    REMOTE_ALICE,
    APP_URL,
  );
  await db
    .delete(messageStampRefs)
    .where(eq(messageStampRefs.messageId, MESSAGE_ID));

  await handleCreate(
    contextFor(db),
    activity,
    recipientRow(),
    REMOTE_ALICE,
    APP_URL,
  );

  const repaired = await db
    .select({ revisionDigest: messageStampRefs.revisionDigest })
    .from(messageStampRefs)
    .where(eq(messageStampRefs.messageId, MESSAGE_ID));
  expect(repaired).toEqual([{ revisionDigest: REVISION }]);
});

test("a changed Create cannot upgrade an existing ordinary image Note into a Stamp", async () => {
  const db = await setup();
  const ordinary = remoteStampActivity();
  ordinary.id = `${MESSAGE_ID}/ordinary-activity`;
  ordinary.object = {
    id: MESSAGE_ID,
    type: "Note",
    attributedTo: REMOTE_ALICE,
    to: [LOCAL_BOB],
    content: "An ordinary image",
    attachment: [
      {
        type: "Image",
        mediaType: "image/webp",
        url: ASSET_URL,
        name: "ordinary image",
        width: 512,
        height: 512,
      },
    ],
  } as unknown as Activity["object"];

  await handleCreate(
    contextFor(db),
    ordinary,
    recipientRow(),
    REMOTE_ALICE,
    APP_URL,
  );

  const changed = remoteStampActivity();
  changed.id = `${MESSAGE_ID}/changed-activity`;
  await handleCreate(
    contextFor(db),
    changed,
    recipientRow(),
    REMOTE_ALICE,
    APP_URL,
  );

  const stored = await db
    .select({
      content: objects.content,
      attachmentsJson: objects.attachmentsJson,
    })
    .from(objects)
    .where(eq(objects.apId, MESSAGE_ID))
    .get();
  expect(stored?.content).toBe("An ordinary image");
  expect(stored?.attachmentsJson).not.toContain("yurucommu:stamp");
  expect(
    await db
      .select()
      .from(messageStampRefs)
      .where(eq(messageStampRefs.messageId, MESSAGE_ID)),
  ).toEqual([]);
  expect(await db.select().from(stampAssetMirrors)).toEqual([]);
});
