import { Hono } from "hono";
import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";
import inboxRoutes from "../../../routes/activitypub/inbox.ts";
import { generateKeyPair, signRequest } from "../../../federation-helpers.ts";

function createDbMock(publicKeyPem: string) {
  const insertValues = spy((..._args: unknown[]) => Promise.resolve(undefined));
  const db = {
    query: {
      actors: {
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve({
            apId: "https://test.local/ap/users/bob",
            preferredUsername: "bob",
          })
        ),
      },
      actorCache: {
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve({
            apId: "https://remote.example/users/alice",
            publicKeyPem,
          })
        ),
      },
      activities: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
    },
    insert: spy((..._args: unknown[]) => ({
      values: insertValues,
    })),
  };

  return { db, insertValues };
}

async function signedInboxRequest(
  body: string,
  privateKeyPem: string,
  keyId: string,
) {
  const url = "https://test.local/ap/users/bob/inbox";
  const headers = await signRequest(privateKeyPem, keyId, "POST", url, body);
  return new Request(url, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/activity+json",
    },
    body,
  });
}

Deno.test("activitypub inbox - accepts signed object activities and stores them once", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  const { db, insertValues } = createDbMock(publicKeyPem);
  const app = new Hono();

  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/", inboxRoutes);

  const body = JSON.stringify({
    id: "https://remote.example/activities/one",
    type: "Question",
    actor: actorApId,
    object: "https://remote.example/objects/one",
  });

  const res = await app.fetch(
    await signedInboxRequest(body, privateKeyPem, `${actorApId}#main-key`),
    { APP_URL: "https://test.local" },
  );

  assertEquals(res.status, 202);
  assertSpyCalls(db.query.activities.findFirst, 1);
  assertSpyCalls(insertValues, 1);
});

Deno.test("activitypub inbox - rejects signed JSON that is not an activity object", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  const { db, insertValues } = createDbMock(publicKeyPem);
  const app = new Hono();

  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/", inboxRoutes);

  const res = await app.fetch(
    await signedInboxRequest("[]", privateKeyPem, `${actorApId}#main-key`),
    { APP_URL: "https://test.local" },
  );

  assertEquals(res.status, 400);
  assertSpyCalls(insertValues, 0);
});
