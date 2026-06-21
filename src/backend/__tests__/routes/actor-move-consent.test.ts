/**
 * Account-migration consent gate on the OUTBOUND endpoint.
 *
 * POST /me/move must refuse to advertise a migration the destination has not
 * consented to: a compliant receiver (Mastodon, and our own inbound handleMove)
 * REJECTS a Move whose destination does not list this account in its
 * `alsoKnownAs`, so without a local check the move would silently no-op on every
 * follower's server while appearing successful locally. The endpoint verifies
 * the destination's back-reference (SSRF-guarded fetch) before persisting
 * `moved_to` + federating the Move.
 */

import { expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { activities, actors } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";

const APP_URL = "https://yurucommu.test";
const ACTOR_AP_ID = `${APP_URL}/ap/users/carol`;
const CONSENTING_TARGET = "https://new.example/users/carol";
const NON_CONSENTING_TARGET = "https://other.example/users/stranger";

// Mock the only network seam (`fetchWithTimeout`) BEFORE importing the route so
// the consent fetch is hermetic and the SSRF resolver / real network are never
// touched. `FederationBodyTooLargeError` is re-exported untouched because the
// import graph (federation-helpers) still re-exports it.
mock.module("../../lib/federation-fetch.ts", () => ({
  FederationBodyTooLargeError: class FederationBodyTooLargeError extends Error {},
  async fetchWithTimeout(url: string) {
    if (url === CONSENTING_TARGET) {
      // Destination consents: lists the migrating account in alsoKnownAs.
      return new Response(
        JSON.stringify({
          id: CONSENTING_TARGET,
          type: "Person",
          preferredUsername: "carol",
          inbox: `${CONSENTING_TARGET}/inbox`,
          alsoKnownAs: [ACTOR_AP_ID],
        }),
        {
          status: 200,
          headers: { "content-type": "application/activity+json" },
        },
      );
    }
    if (url === NON_CONSENTING_TARGET) {
      // Reachable, valid actor — but does NOT list the migrating account.
      return new Response(
        JSON.stringify({
          id: NON_CONSENTING_TARGET,
          type: "Person",
          preferredUsername: "stranger",
          inbox: `${NON_CONSENTING_TARGET}/inbox`,
          alsoKnownAs: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/activity+json" },
        },
      );
    }
    if (url.startsWith("https://new.example/.well-known/webfinger")) {
      // WebFinger for @carol@new.example -> the consenting actor URL.
      return new Response(
        JSON.stringify({
          subject: "acct:carol@new.example",
          links: [
            {
              rel: "self",
              type: "application/activity+json",
              href: CONSENTING_TARGET,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/jrd+json" } },
      );
    }
    return new Response("not found", { status: 404 });
  },
}));

const { default: actorsRoute } = await import("../../routes/actors.ts");

const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0007_moderation_reports.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertCarol(db: Database): Promise<Actor> {
  await db.insert(actors).values({
    apId: ACTOR_AP_ID,
    type: "Person",
    preferredUsername: "carol",
    inbox: `${ACTOR_AP_ID}/inbox`,
    outbox: `${ACTOR_AP_ID}/outbox`,
    followersUrl: `${ACTOR_AP_ID}/followers`,
    followingUrl: `${ACTOR_AP_ID}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  return {
    ap_id: ACTOR_AP_ID,
    type: "Person",
    preferred_username: "carol",
    name: null,
    summary: null,
    icon_url: null,
    header_url: null,
    inbox: `${ACTOR_AP_ID}/inbox`,
    outbox: `${ACTOR_AP_ID}/outbox`,
    followers_url: `${ACTOR_AP_ID}/followers`,
    following_url: `${ACTOR_AP_ID}/following`,
    public_key_pem: "pub",
    private_key_pem: "priv",
    takos_user_id: null,
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role: "owner",
    created_at: "2026-01-01T00:00:00.000Z",
  } as Actor;
}

type Sent = { activityId: string; followeeApId: string; type: string };

function envFor(db: Database, sent: Sent[]): Env {
  const DELIVERY_QUEUE = {
    send: (body: {
      type: string;
      activityId: string;
      followeeApId: string;
    }) => {
      sent.push({
        activityId: body.activityId,
        followeeApId: body.followeeApId,
        type: body.type,
      });
      return Promise.resolve();
    },
    sendBatch: () => Promise.resolve(),
  };
  const DELIVERY_DLQ = { send: () => Promise.resolve() };
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE,
    DELIVERY_DLQ,
  } as unknown as Env;
}

function actorsApp(db: Database, actor: Actor | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", actorsRoute);
  return app;
}

async function postMove(
  db: Database,
  actor: Actor,
  target: string,
  sent: Sent[],
): Promise<Response> {
  const app = actorsApp(db, actor);
  return app.fetch(
    new Request(`${APP_URL}/me/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    }),
    envFor(db, sent),
  );
}

test("POST /me/move federates the Move when the destination consents (alsoKnownAs)", async () => {
  const db = await freshDb();
  const actor = await insertCarol(db);
  const sent: Sent[] = [];

  const res = await postMove(db, actor, CONSENTING_TARGET, sent);
  expect(res.status).toBe(200);

  const row = await db
    .select({ movedTo: actors.movedTo })
    .from(actors)
    .where(eq(actors.apId, actor.ap_id))
    .get();
  expect(row!.movedTo).toBe(CONSENTING_TARGET);

  const moves = await db
    .select()
    .from(activities)
    .where(eq(activities.type, "Move"));
  expect(moves.length).toBe(1);
  const doc = JSON.parse(moves[0].rawJson) as {
    target: string;
    object: string;
  };
  expect(doc.target).toBe(CONSENTING_TARGET);
  expect(doc.object).toBe(actor.ap_id);
  expect(sent).toEqual([
    {
      activityId: moves[0].apId,
      followeeApId: actor.ap_id,
      type: "fanout_followers",
    },
  ]);
});

test("POST /me/move accepts a @user@domain handle (WebFinger-resolved to the actor URL)", async () => {
  const db = await freshDb();
  const actor = await insertCarol(db);
  const sent: Sent[] = [];

  const res = await postMove(db, actor, "@carol@new.example", sent);
  expect(res.status).toBe(200);

  // moved_to + the federated Move target are the RESOLVED actor URL, not the
  // raw handle.
  const row = await db
    .select({ movedTo: actors.movedTo })
    .from(actors)
    .where(eq(actors.apId, actor.ap_id))
    .get();
  expect(row!.movedTo).toBe(CONSENTING_TARGET);

  const moves = await db
    .select()
    .from(activities)
    .where(eq(activities.type, "Move"));
  expect(moves.length).toBe(1);
  const doc = JSON.parse(moves[0].rawJson) as { target: string };
  expect(doc.target).toBe(CONSENTING_TARGET);
});

test("POST /me/move rejects (422) and does NOT migrate when the destination does not list this account", async () => {
  const db = await freshDb();
  const actor = await insertCarol(db);
  const sent: Sent[] = [];

  const res = await postMove(db, actor, NON_CONSENTING_TARGET, sent);
  expect(res.status).toBe(422);

  // No migration was advertised and no Move was federated.
  const row = await db
    .select({ movedTo: actors.movedTo })
    .from(actors)
    .where(eq(actors.apId, actor.ap_id))
    .get();
  expect(row!.movedTo).toBeNull();

  const moves = await db
    .select()
    .from(activities)
    .where(eq(activities.type, "Move"));
  expect(moves.length).toBe(0);
  expect(sent).toEqual([]);
});
