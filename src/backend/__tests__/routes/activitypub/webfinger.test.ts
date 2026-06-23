import { expect, test } from "bun:test";
import { Hono } from "hono";

import activitypubRoutes from "../../../routes/activitypub.ts";

function createActorDb(
  responses: Array<{ apId: string; preferredUsername: string } | null>,
) {
  let index = 0;
  return {
    query: {
      actors: {
        findFirst: () => Promise.resolve(responses[index++] ?? null),
      },
    },
    // loadFederatedCommunity (the webfinger community fall-through) runs a
    // `select().from().where().get()` — stub it to resolve no community so the
    // unknown-handle path reaches the 404 instead of throwing.
    select: () => ({
      from: () => ({
        where: () => ({ get: () => Promise.resolve(undefined) }),
      }),
    }),
  };
}

function createApp(db: unknown) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/", activitypubRoutes);
  return app;
}

test("webfinger 404s an unknown local acct username (no owner fallback)", async () => {
  // The DB returns no actor for the unknown username. Previously the handler
  // fell back to the owner actor and echoed the requested username as subject —
  // a WebFinger violation (subject must identify the linked account) that also
  // fails the round-trip a conformant peer performs. It must 404 instead.
  const app = createApp(createActorDb([null]));

  const res = await app.fetch(
    new Request(
      "https://example.test/.well-known/webfinger?resource=acct:any@example.test",
    ),
    { APP_URL: "https://example.test" },
  );

  expect(res.status).toEqual(404);
});

test("webfinger subject echoes the CANONICAL username casing", async () => {
  // A query whose casing differs from the stored username resolves to the same
  // actor (when matched) but the response subject must be the canonical handle
  // so the remote's WebFinger round-trip is self-consistent.
  const tako = {
    apId: "https://example.test/ap/users/tako",
    preferredUsername: "tako",
  };
  const app = createApp(createActorDb([tako]));

  const res = await app.fetch(
    new Request(
      "https://example.test/.well-known/webfinger?resource=acct:tako@example.test",
    ),
    { APP_URL: "https://example.test" },
  );
  const body = (await res.json()) as { subject: string };

  expect(res.status).toEqual(200);
  expect(body.subject).toEqual("acct:tako@example.test");
});

test("webfinger resolves a MIXED-CASE host authority (RFC 4343 host case-insensitivity)", async () => {
  // Audit #12 finding #4: the acct: host was compared case-sensitively against
  // the (always-lowercased) currentDomain, so `acct:tako@EXAMPLE.TEST` 404'd even
  // though it is this instance. The host is now lowercased before comparison.
  const tako = {
    apId: "https://example.test/ap/users/tako",
    preferredUsername: "tako",
  };
  const app = createApp(createActorDb([tako]));

  const res = await app.fetch(
    new Request(
      "https://example.test/.well-known/webfinger?resource=acct:tako@EXAMPLE.TEST",
    ),
    { APP_URL: "https://example.test" },
  );
  expect(res.status).toEqual(200);
});

test("webfinger keeps exact local actor resolution when username exists", async () => {
  const alice = {
    apId: "https://example.test/ap/users/alice",
    preferredUsername: "alice",
  };
  const app = createApp(createActorDb([alice]));

  const res = await app.fetch(
    new Request(
      "https://example.test/.well-known/webfinger?resource=acct:alice@example.test",
    ),
    { APP_URL: "https://example.test" },
  );
  const body = (await res.json()) as {
    subject: string;
    links: Array<{ rel: string; href: string }>;
  };

  expect(res.status).toEqual(200);
  expect(body.subject).toEqual("acct:alice@example.test");
  expect(body.links.find((link) => link.rel === "self")?.href).toEqual(
    "https://example.test/ap/users/alice",
  );
});
