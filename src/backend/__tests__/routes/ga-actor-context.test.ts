import { expect, test } from "bun:test";
import { Hono } from "hono";

import { spy } from "#test/mock";
import activityPubRoutes from "../../routes/activitypub.ts";

function createActor(username: string) {
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
    isPrivate: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    fieldsJson: JSON.stringify([{ name: "Website", value: "example.com" }]),
    alsoKnownAsJson: JSON.stringify(["https://old.local/ap/users/legacy"]),
    movedTo: null,
  };
}

function createDbMock(username: string) {
  return {
    query: {
      actors: {
        findFirst: spy(() => Promise.resolve(createActor(username))),
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

async function getActorDoc(username: string) {
  const db = createDbMock(username);
  const app = createApp(db);
  const res = await app.fetch(
    new Request(`https://test.local/ap/users/${username}`),
    { APP_URL: "https://test.local" },
  );
  return { res, body: (await res.json()) as Record<string, unknown> };
}

test("served actor doc @context includes Mastodon extension terms", async () => {
  const { res, body } = await getActorDoc("context-user");

  expect(res.status).toEqual(200);

  const context = body["@context"];
  expect(Array.isArray(context)).toBe(true);
  const ctx = context as unknown[];

  // Base AS2 + security contexts are still present (must not be dropped).
  expect(ctx).toContain("https://www.w3.org/ns/activitystreams");
  expect(ctx).toContain("https://w3id.org/security/v1");

  // The extension object declares the terms used by the actor doc so that
  // strict consumers (Mastodon) interpret them.
  const ext = ctx.find(
    (entry) => typeof entry === "object" && entry !== null,
  ) as Record<string, unknown> | undefined;
  expect(ext).toBeDefined();

  // PropertyValue (profile attachments).
  expect(ext?.PropertyValue).toEqual("schema:PropertyValue");
  expect(ext?.value).toEqual("schema:value");

  // alsoKnownAs / movedTo migration declarations.
  expect(ext?.alsoKnownAs).toEqual({ "@id": "as:alsoKnownAs", "@type": "@id" });
  expect(ext?.movedTo).toEqual({ "@id": "as:movedTo", "@type": "@id" });

  // manuallyApprovesFollowers lock term.
  expect(ext?.manuallyApprovesFollowers).toEqual(
    "as:manuallyApprovesFollowers",
  );

  // Audit #12 finding #6: the actor doc emits `discoverable`, so its term must be
  // declared (toot:discoverable) or a strict JSON-LD processor drops it.
  expect(ext?.discoverable).toEqual("toot:discoverable");

  // Sanity: the actor doc actually emits the terms the context now declares.
  expect(Array.isArray(body.attachment)).toBe(true);
  expect(Array.isArray(body.alsoKnownAs)).toBe(true);
});

test("served actor doc published is a valid xsd:dateTime even from a SQLite created_at", async () => {
  // An actor's created_at can be a SQLite datetime('now') value
  // (YYYY-MM-DD HH:MM:SS.mmm — space-separated, no zone); emitted verbatim it is
  // an INVALID xsd:dateTime that Mastodon cannot parse (no join date). It must
  // be normalized to ISO 8601.
  const db = {
    query: {
      actors: {
        findFirst: spy(() =>
          Promise.resolve({
            ...createActor("sqliteuser"),
            createdAt: "2026-06-20 19:01:17.175",
          }),
        ),
      },
      activities: { findMany: spy(() => Promise.resolve([])) },
      follows: { findMany: spy(() => Promise.resolve([])) },
    },
    select: spy(() => {
      throw new Error("collection count should not be queried");
    }),
  } as unknown as ReturnType<typeof createDbMock>;
  const app = createApp(db);
  const res = await app.fetch(
    new Request("https://test.local/ap/users/sqliteuser"),
    { APP_URL: "https://test.local" },
  );
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.published).toEqual("2026-06-20T19:01:17.175Z");
  expect(String(body.published)).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
  );
});
