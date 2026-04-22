import { Hono } from "hono";
import { assert, assertEquals } from "jsr:@std/assert";
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

Deno.test("activitypub private actor omits public collection URLs", async () => {
  const { res, body } = await getJson("/ap/users/private-user");
  const actor = body as Record<string, unknown>;

  assertEquals(res.status, 200);
  assertEquals(actor.discoverable, false);
  assert(!("outbox" in actor));
  assert(!("followers" in actor));
  assert(!("following" in actor));
});

Deno.test("activitypub private actor outbox does not expose unauthenticated contents or counts", async () => {
  const { res, body, db } = await getJson("/ap/users/private-user/outbox");
  const collection = body as Record<string, unknown>;

  assertEquals(res.status, 200);
  assertEquals(collection.type, "OrderedCollection");
  assert(!("totalItems" in collection));
  assert(!("first" in collection));
  assertSpyCalls(db.activitiesFindMany, 0);
  assertSpyCalls(db.countSelect, 0);
});

Deno.test("activitypub private actor followers and following do not expose unauthenticated contents or counts", async () => {
  const followers = await getJson("/ap/users/private-user/followers?page=1");
  const followersPage = followers.body as Record<string, unknown>;

  assertEquals(followers.res.status, 200);
  assertEquals(followersPage.type, "OrderedCollectionPage");
  assertEquals(followersPage.orderedItems, []);
  assert(!("totalItems" in followersPage));
  assertSpyCalls(followers.db.followsFindMany, 0);
  assertSpyCalls(followers.db.countSelect, 0);

  const following = await getJson("/ap/users/private-user/following");
  const followingCollection = following.body as Record<string, unknown>;

  assertEquals(following.res.status, 200);
  assertEquals(followingCollection.type, "OrderedCollection");
  assert(!("totalItems" in followingCollection));
  assert(!("first" in followingCollection));
  assertSpyCalls(following.db.followsFindMany, 0);
  assertSpyCalls(following.db.countSelect, 0);
});
