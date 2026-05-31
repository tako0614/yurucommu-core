import { expect, test } from "bun:test";
import { Hono } from "hono";

import { assertSpyCalls, spy } from "jsr:@std/testing/mock";
import activityPubRoutes from "../../../routes/activitypub.ts";

const actorApId = "https://test.local/ap/users/private-user";

function createPrivateActor() {
  return {
    apId: actorApId,
    type: "Person",
    preferredUsername: "private-user",
    name: "Private User",
    summary: null,
    iconUrl: null,
    headerUrl: null,
    inbox: `${actorApId}/inbox`,
    outbox: `${actorApId}/outbox`,
    followersUrl: `${actorApId}/followers`,
    followingUrl: `${actorApId}/following`,
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----",
    followerCount: 2,
    followingCount: 3,
    postCount: 4,
    isPrivate: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function createDbMock() {
  const activitiesFindMany = spy(() => Promise.resolve([]));
  const followsFindMany = spy(() => Promise.resolve([]));
  const countSelect = spy(() => {
    throw new Error("private collection count should not be queried");
  });

  return {
    query: {
      actors: {
        findFirst: spy(() => Promise.resolve(createPrivateActor())),
      },
      activities: {
        findMany: activitiesFindMany,
      },
      follows: {
        findMany: followsFindMany,
      },
    },
    select: countSelect,
    activitiesFindMany,
    followsFindMany,
    countSelect,
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

async function getJson(path: string, db = createDbMock()) {
  const app = createApp(db);
  const res = await app.fetch(new Request(`https://test.local${path}`), {
    APP_URL: "https://test.local",
  });
  return { res, body: await res.json(), db };
}

test("activitypub private actor omits public collection URLs", async () => {
  const { res, body } = await getJson("/ap/users/private-user");
  const actor = body as Record<string, unknown>;

  expect(res.status).toEqual(200);
  expect(actor.discoverable).toEqual(false);
  expect(!("outbox" in actor)).toBeTruthy();
  expect(!("followers" in actor)).toBeTruthy();
  expect(!("following" in actor)).toBeTruthy();
});

test("activitypub private actor outbox does not expose unauthenticated contents or counts", async () => {
  const { res, body, db } = await getJson("/ap/users/private-user/outbox");
  const collection = body as Record<string, unknown>;

  expect(res.status).toEqual(200);
  expect(collection.type).toEqual("OrderedCollection");
  expect(!("totalItems" in collection)).toBeTruthy();
  expect(!("first" in collection)).toBeTruthy();
  assertSpyCalls(db.activitiesFindMany, 0);
  assertSpyCalls(db.countSelect, 0);
});

test("activitypub private actor followers and following do not expose unauthenticated contents or counts", async () => {
  const followers = await getJson("/ap/users/private-user/followers?page=1");
  const followersPage = followers.body as Record<string, unknown>;

  expect(followers.res.status).toEqual(200);
  expect(followersPage.type).toEqual("OrderedCollectionPage");
  expect(followersPage.orderedItems).toEqual([]);
  expect(!("totalItems" in followersPage)).toBeTruthy();
  assertSpyCalls(followers.db.followsFindMany, 0);
  assertSpyCalls(followers.db.countSelect, 0);

  const following = await getJson("/ap/users/private-user/following");
  const followingCollection = following.body as Record<string, unknown>;

  expect(following.res.status).toEqual(200);
  expect(followingCollection.type).toEqual("OrderedCollection");
  expect(!("totalItems" in followingCollection)).toBeTruthy();
  expect(!("first" in followingCollection)).toBeTruthy();
  assertSpyCalls(following.db.followsFindMany, 0);
  assertSpyCalls(following.db.countSelect, 0);
});
