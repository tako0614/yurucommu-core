import { expect, test } from "bun:test";
import { Hono } from "hono";

import activitypubRoutes from "../../../routes/activitypub.ts";

function createCommunityDb() {
  const community = {
    apId: "https://example.test/ap/communities/books",
    preferredUsername: "books",
    name: "Books",
    summary: "Reading group",
    inbox: "https://example.test/ap/communities/books/inbox",
    outbox: "https://example.test/ap/communities/books/outbox",
    followersUrl: "https://example.test/ap/communities/books/followers",
    visibility: "public",
    joinPolicy: "open",
    postPolicy: "members",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
  };

  return {
    query: {
      communities: {
        findMany: () => Promise.resolve([community]),
        findFirst: () => Promise.resolve(community),
      },
    },
  };
}

function createApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      createCommunityDb(),
    );
    await next();
  });
  app.route("/", activitypubRoutes);
  return app;
}

test("APC room collection uses Group and apc:postPolicy", async () => {
  const res = await createApp().fetch(
    new Request("https://example.test/ap/rooms"),
    { APP_URL: "https://example.test" },
  );
  const body = (await res.json()) as {
    orderedItems: Array<{ type: string; postPolicy: string }>;
  };

  expect(res.status).toEqual(200);
  expect(body.orderedItems[0].type).toEqual("Group");
  expect(body.orderedItems[0].postPolicy).toEqual("members");
});

test("APC room object uses Group and apc:postPolicy", async () => {
  const res = await createApp().fetch(
    new Request("https://example.test/ap/rooms/books"),
    { APP_URL: "https://example.test" },
  );
  const body = (await res.json()) as {
    type: string;
    postPolicy: string;
    "@context": Array<Record<string, unknown>>;
  };

  expect(res.status).toEqual(200);
  expect(body.type).toEqual("Group");
  expect(body.postPolicy).toEqual("members");
  expect(body["@context"][1].postPolicy).toEqual("apc:postPolicy");
});
