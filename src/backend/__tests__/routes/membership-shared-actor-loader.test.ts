import { expect, test } from "bun:test";

import type { Database } from "../../../db/index.ts";
import { actorCache, actors } from "../../../db/index.ts";
import { batchLoadActorInfo } from "../../routes/communities/membership-shared.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://actors.example";

function actorApId(username: string): string {
  return `${APP_URL}/users/${username}`;
}

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

async function insertLocalActor(
  db: Database,
  actor: {
    apId: string;
    preferredUsername: string;
    name: string | null;
    iconUrl: string | null;
  },
): Promise<void> {
  await db.insert(actors).values({
    apId: actor.apId,
    type: "Person",
    preferredUsername: actor.preferredUsername,
    name: actor.name,
    iconUrl: actor.iconUrl,
    inbox: `${actor.apId}/inbox`,
    outbox: `${actor.apId}/outbox`,
    followersUrl: `${actor.apId}/followers`,
    followingUrl: `${actor.apId}/following`,
    publicKeyPem: "public-key",
    privateKeyPem: "private-key",
  });
}

async function insertCachedActor(
  db: Database,
  actor: {
    apId: string;
    preferredUsername: string | null;
    name: string | null;
    iconUrl: string | null;
  },
): Promise<void> {
  await db.insert(actorCache).values({
    apId: actor.apId,
    type: "Person",
    preferredUsername: actor.preferredUsername,
    name: actor.name,
    iconUrl: actor.iconUrl,
    inbox: `${actor.apId}/inbox`,
    rawJson: JSON.stringify({ id: actor.apId, type: "Person" }),
  });
}

test("batchLoadActorInfo returns an empty map for empty ids", async () => {
  const db = await freshDb();

  const result = await batchLoadActorInfo(db, []);

  expect(result).toEqual(new Map());
});

test("batchLoadActorInfo projects a cached actor without leaking its apId", async () => {
  const db = await freshDb();
  const apId = actorApId("cached");
  await insertCachedActor(db, {
    apId,
    preferredUsername: "cached",
    name: "Cached Actor",
    iconUrl: "https://cdn.example/cached.png",
  });

  const result = await batchLoadActorInfo(db, [apId]);

  expect(result.get(apId)).toEqual({
    preferredUsername: "cached",
    name: "Cached Actor",
    iconUrl: "https://cdn.example/cached.png",
  });
});

test("batchLoadActorInfo lets a local actor override cached null fields", async () => {
  const db = await freshDb();
  const apId = actorApId("local-wins");
  await insertCachedActor(db, {
    apId,
    preferredUsername: "cached-name",
    name: "Cached Name",
    iconUrl: "https://cdn.example/cached.png",
  });
  await insertLocalActor(db, {
    apId,
    preferredUsername: "local-name",
    name: null,
    iconUrl: null,
  });

  const result = await batchLoadActorInfo(db, [apId]);

  expect(result.get(apId)).toEqual({
    preferredUsername: "local-name",
    name: null,
    iconUrl: null,
  });
});

test("batchLoadActorInfo omits actors missing from both tables", async () => {
  const db = await freshDb();
  const apId = actorApId("missing");

  const result = await batchLoadActorInfo(db, [apId]);

  expect(result.has(apId)).toBe(false);
  expect(result.get(apId)).toBeUndefined();
});

test("batchLoadActorInfo omits iconUrl and apId when includeIcon is false", async () => {
  const db = await freshDb();
  const apId = actorApId("without-icon");
  await insertCachedActor(db, {
    apId,
    preferredUsername: "without-icon",
    name: "No Icon Projection",
    iconUrl: "https://cdn.example/should-not-leak.png",
  });

  const result = await batchLoadActorInfo(db, [apId], false);
  const info = result.get(apId);

  expect(info).toEqual({
    preferredUsername: "without-icon",
    name: "No Icon Projection",
  });
  expect(info).not.toHaveProperty("iconUrl");
  expect(info).not.toHaveProperty("apId");
  expect(Object.keys(info ?? {})).toEqual(["preferredUsername", "name"]);
});

test("batchLoadActorInfo handles more than 90 ids through the canonical chunker", async () => {
  const db = await freshDb();
  const apIds = Array.from({ length: 91 }, (_, index) =>
    actorApId(`chunk-${index}`),
  );
  const finalApId = apIds.at(-1)!;
  await insertCachedActor(db, {
    apId: finalApId,
    preferredUsername: "chunk-90",
    name: "Second Chunk",
    iconUrl: null,
  });

  const result = await batchLoadActorInfo(db, apIds);

  expect(result).toEqual(
    new Map([
      [
        finalApId,
        { preferredUsername: "chunk-90", name: "Second Chunk", iconUrl: null },
      ],
    ]),
  );
});
