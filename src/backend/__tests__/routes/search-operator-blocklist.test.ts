import { expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actorCache, remoteActorFetchFailures } from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { blockActor, blockDomain } from "../../lib/blocklist.ts";

const APP_URL = "https://yuru.test";
const BLOCKED_ACTOR = "https://actor-blocked.example/users/alice";
const VALID_ACTOR = "https://actor-valid.example/users/alice";
const INVALID_INBOX_ACTOR = "https://actor-invalid.example/users/alice";
const requested: string[] = [];

// Keep the regression at the route's federation-fetch seam. Mocking below the
// route preserves the exact blocklist decision while making both the forbidden
// WebFinger request and redirect target deterministic and network-free.
mock.module("../../lib/federation-fetch.ts", () => ({
  FederationBodyTooLargeError: class FederationBodyTooLargeError extends Error {},
  async fetchWithTimeout(url: string) {
    requested.push(url);
    if (url.startsWith("https://lookup.example/.well-known/webfinger?")) {
      return new Response(
        JSON.stringify({
          subject: "acct:alice@lookup.example",
          links: [
            {
              rel: "self",
              type: "application/activity+json",
              href: BLOCKED_ACTOR,
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/jrd+json" },
        },
      );
    }
    if (url.startsWith("https://valid-lookup.example/.well-known/webfinger?")) {
      return webFingerResponse(VALID_ACTOR);
    }
    if (
      url.startsWith("https://invalid-lookup.example/.well-known/webfinger?")
    ) {
      return webFingerResponse(INVALID_INBOX_ACTOR);
    }
    if (url === VALID_ACTOR) {
      return new Response(
        JSON.stringify({
          id: VALID_ACTOR,
          type: "Person",
          preferredUsername: "a".repeat(500),
          name: "N".repeat(500),
          summary: "S".repeat(5_000),
          inbox: `${VALID_ACTOR}/inbox`,
          outbox: `${VALID_ACTOR}/outbox`,
          followers: `${VALID_ACTOR}/followers`,
          following: `${VALID_ACTOR}/following`,
          endpoints: { sharedInbox: "https://actor-valid.example/inbox" },
          attachment: [{ type: "PropertyValue", name: "Site", value: "ok" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/activity+json" },
        },
      );
    }
    if (url === INVALID_INBOX_ACTOR) {
      return new Response(
        JSON.stringify({
          id: INVALID_INBOX_ACTOR,
          type: "Person",
          preferredUsername: "alice",
          inbox: "http://127.0.0.1/private",
        }),
        {
          status: 200,
          headers: { "content-type": "application/activity+json" },
        },
      );
    }
    return new Response("forbidden fetch reached the network seam", {
      status: 500,
    });
  },
}));

function webFingerResponse(actorHref: string): Response {
  return new Response(
    JSON.stringify({
      subject: "acct:alice@example",
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: actorHref,
        },
      ],
    }),
    {
      status: 200,
      headers: { "content-type": "application/jrd+json" },
    },
  );
}

const { default: searchRoutes } = await import("../../routes/search.ts");
const { default: actorsRoute } = await import("../../routes/actors.ts");

const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
  "0026_remote_actor_fetch_failures.sql",
  "0027_remote_actor_tombstones.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const ddl = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(ddl);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function appFor(db: Database): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", null);
    await next();
  });
  app.route("/search", searchRoutes);
  app.route("/actors", actorsRoute);
  return app;
}

test("remote search never fetches a domain the operator blocked", async () => {
  requested.length = 0;
  const db = await freshDb();
  await blockDomain(db, "blocked.example", "defederated");
  const app = appFor(db);

  const res = await app.request(
    `${APP_URL}/search/remote?q=${encodeURIComponent("@alice@node.blocked.example")}`,
    {},
    { APP_URL } as unknown as Env,
  );

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ actors: [] });
  expect(requested).toEqual([]);
});

test("remote search does not follow WebFinger to a blocked actor", async () => {
  requested.length = 0;
  const db = await freshDb();
  await blockActor(db, BLOCKED_ACTOR, "defederated");
  const app = appFor(db);

  const res = await app.request(
    `${APP_URL}/search/remote?q=${encodeURIComponent("@alice@lookup.example")}`,
    {},
    { APP_URL } as unknown as Env,
  );

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ actors: [] });
  expect(requested).toHaveLength(1);
  expect(requested[0]).toStartWith(
    "https://lookup.example/.well-known/webfinger?",
  );
});

test("remote search writes the canonical bounded actor shape and clears stale failure authority", async () => {
  requested.length = 0;
  const db = await freshDb();
  await db.insert(remoteActorFetchFailures).values({
    actorApId: VALID_ACTOR,
    kind: "gone",
    reason: "fetch_not_ok",
    httpStatus: 410,
    failureCount: 1,
  });
  const app = appFor(db);

  const res = await app.request(
    `${APP_URL}/search/remote?q=${encodeURIComponent("@alice@valid-lookup.example")}`,
    {},
    { APP_URL } as unknown as Env,
  );

  expect(res.status).toBe(200);
  expect((await res.json()) as { actors: unknown[] }).toMatchObject({
    actors: [{ ap_id: VALID_ACTOR }],
  });
  expect(
    await db
      .select()
      .from(actorCache)
      .where(eq(actorCache.apId, VALID_ACTOR))
      .get(),
  ).toMatchObject({
    preferredUsername: "a".repeat(100),
    name: "N".repeat(50),
    summary: "S".repeat(500),
    outbox: `${VALID_ACTOR}/outbox`,
    followersUrl: `${VALID_ACTOR}/followers`,
    followingUrl: `${VALID_ACTOR}/following`,
    sharedInbox: "https://actor-valid.example/inbox",
  });
  const cached = await db
    .select({ rawJson: actorCache.rawJson })
    .from(actorCache)
    .where(eq(actorCache.apId, VALID_ACTOR))
    .get();
  expect(JSON.parse(cached!.rawJson)).toMatchObject({
    attachment: [{ type: "PropertyValue", name: "Site", value: "ok" }],
  });
  expect(
    await db
      .select()
      .from(remoteActorFetchFailures)
      .where(eq(remoteActorFetchFailures.actorApId, VALID_ACTOR))
      .get(),
  ).toBeUndefined();
});

test("remote search refuses to cache an actor with an unsafe inbox", async () => {
  requested.length = 0;
  const db = await freshDb();
  const app = appFor(db);

  const res = await app.request(
    `${APP_URL}/search/remote?q=${encodeURIComponent("@alice@invalid-lookup.example")}`,
    {},
    { APP_URL } as unknown as Env,
  );

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ actors: [] });
  expect(
    await db
      .select()
      .from(actorCache)
      .where(eq(actorCache.apId, INVALID_INBOX_ACTOR))
      .get(),
  ).toBeUndefined();
});

test("actor search hides cached actors on an operator-blocked domain", async () => {
  requested.length = 0;
  const db = await freshDb();
  const blocked = "https://node.blocked.example/users/hidden";
  const allowed = "https://allowed.example/users/visible";
  await db.insert(actorCache).values([
    {
      apId: blocked,
      preferredUsername: "hidden",
      name: "Findable Hidden",
      inbox: `${blocked}/inbox`,
      rawJson: "{}",
    },
    {
      apId: allowed,
      preferredUsername: "visible",
      name: "Findable Visible",
      inbox: `${allowed}/inbox`,
      rawJson: "{}",
    },
  ]);
  await blockDomain(db, "blocked.example", "defederated");
  const app = appFor(db);

  const res = await app.request(
    `${APP_URL}/search/actors?q=${encodeURIComponent("Findable")}`,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { actors: Array<{ ap_id: string }> };
  expect(body.actors.map((actor) => actor.ap_id)).toEqual([allowed]);
  expect(requested).toEqual([]);
});

test("direct actor profile hides a cached actor on an operator-blocked domain", async () => {
  requested.length = 0;
  const db = await freshDb();
  const blocked = "https://node.blocked.example/users/hidden";
  await db.insert(actorCache).values({
    apId: blocked,
    preferredUsername: "hidden",
    name: "Hidden Profile",
    inbox: `${blocked}/inbox`,
    rawJson: JSON.stringify({ id: blocked, type: "Person" }),
  });
  await blockDomain(db, "blocked.example", "defederated");
  const app = appFor(db);

  const res = await app.request(
    `${APP_URL}/actors/${encodeURIComponent("@hidden@node.blocked.example")}`,
    {},
    { APP_URL } as unknown as Env,
  );
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "Actor not found" });
  expect(requested).toEqual([]);
});
