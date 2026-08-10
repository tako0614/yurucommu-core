import { expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actorCache } from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { blockActor, blockDomain } from "../../lib/blocklist.ts";

const APP_URL = "https://yuru.test";
const BLOCKED_ACTOR = "https://actor-blocked.example/users/alice";
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
    return new Response("forbidden fetch reached the network seam", {
      status: 500,
    });
  },
}));

const { default: searchRoutes } = await import("../../routes/search.ts");
const { default: actorsRoute } = await import("../../routes/actors.ts");

const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
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
