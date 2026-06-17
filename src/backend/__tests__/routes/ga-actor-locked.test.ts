import { expect, test } from "bun:test";
import { Hono } from "hono";

import { spy } from "#test/mock";
import activityPubRoutes from "../../routes/activitypub.ts";

function createActor(isPrivate: boolean, username: string) {
  const apId = `https://test.local/ap/users/${username}`;
  return {
    apId,
    type: "Person",
    preferredUsername: username,
    name: "Test User",
    summary: null,
    iconUrl: null,
    headerUrl: null,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----",
    followerCount: 0,
    followingCount: 0,
    postCount: 0,
    isPrivate: isPrivate ? 1 : 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    fieldsJson: null,
    alsoKnownAsJson: null,
    movedTo: null,
  };
}

function createDbMock(isPrivate: boolean, username: string) {
  return {
    query: {
      actors: {
        findFirst: spy(() => Promise.resolve(createActor(isPrivate, username))),
      },
      activities: { findMany: spy(() => Promise.resolve([])) },
      follows: { findMany: spy(() => Promise.resolve([])) },
    },
    select: spy(() => {
      throw new Error("collection count should not be queried");
    }),
  };
}

function createApp(db: ReturnType<typeof createDbMock>) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "actor",
      null,
    );
    await next();
  });
  app.route("/", activityPubRoutes);
  return app;
}

async function getActorDoc(isPrivate: boolean, username: string) {
  const db = createDbMock(isPrivate, username);
  const app = createApp(db);
  const res = await app.fetch(
    new Request(`https://test.local/ap/users/${username}`),
    { APP_URL: "https://test.local" },
  );
  return { res, body: (await res.json()) as Record<string, unknown> };
}

test("private actor doc advertises manuallyApprovesFollowers:true (locked)", async () => {
  const { res, body } = await getActorDoc(true, "private-locked-user");

  expect(res.status).toEqual(200);
  expect(body.manuallyApprovesFollowers).toEqual(true);
  expect(body.discoverable).toEqual(false);
});

test("public actor doc advertises manuallyApprovesFollowers:false (unlocked)", async () => {
  const { res, body } = await getActorDoc(false, "public-open-user");

  expect(res.status).toEqual(200);
  expect(body.manuallyApprovesFollowers).toEqual(false);
  expect(body.discoverable).toEqual(true);
});
