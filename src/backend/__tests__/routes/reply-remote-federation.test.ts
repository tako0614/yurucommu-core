import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, activities, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import postsAggregator from "../../routes/posts.ts";

/**
 * A reply to a REMOTE post must federate into the original thread.
 *
 * processMentions only addresses actors explicitly @-mentioned in the body, so a
 * reply to a remote post that doesn't manually @-mention its author used to be
 * delivered to the replier's followers but NEVER to the upstream instance — it
 * never landed in the original thread (whereas Like/Undo-repost already reach
 * the remote object author). The fix auto-addresses the parent author of a
 * non-direct reply: cc + a Mention tag + direct delivery when remote.
 */

const APP_URL = "https://yuru.test";
const ALICE = "https://remote.example/users/alice"; // remote parent author
const PARENT = "https://remote.example/objects/parent-1"; // remote post being replied to

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function seedLocalActor(db: Database, username: string) {
  const apId = `${APP_URL}/ap/users/${username}`;
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  return apId;
}

function fakeActor(apId: string, username: string): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name: null,
    summary: null,
    icon_url: null,
    header_url: null,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followers_url: `${apId}/followers`,
    following_url: `${apId}/following`,
    public_key_pem: "pub",
    private_key_pem: "priv",
    takos_user_id: null,
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role: "owner",
    created_at: new Date().toISOString(),
  };
}

function envFor(db: Database, sent: unknown[]): Env {
  const queue = {
    async send(body: unknown) {
      sent.push(body);
    },
    async sendBatch(reqs: Array<{ body: unknown }>) {
      for (const r of reqs) sent.push(r.body);
    },
  };
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: { async send() {}, async sendBatch() {} },
  } as unknown as Env;
}

async function postReply(
  db: Database,
  actor: Actor,
  env: Env,
  body: Record<string, unknown>,
) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db as unknown as never);
    c.set("actor", actor);
    await next();
  });
  app.route("/", postsAggregator);
  return app.fetch(
    new Request(`${APP_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function findReplyCreate(db: Database, postApId: string) {
  const rows = await db
    .select({ rawJson: activities.rawJson })
    .from(activities)
    .where(eq(activities.type, "Create"))
    .all();
  for (const r of rows) {
    try {
      const a = JSON.parse(r.rawJson) as {
        cc?: string[];
        tag?: Array<{ type: string; href: string }>;
        object?: { id?: string };
      };
      if (a.object?.id === postApId) return a;
    } catch {
      /* skip */
    }
  }
  return null;
}

test("public reply to a remote post auto-addresses the parent author (cc + Mention + delivery)", async () => {
  const db = await freshDb();
  const tako = await seedLocalActor(db, "tako");
  // The remote parent post (attributedTo a remote actor; no actor FK after 0011).
  await db.insert(objects).values({
    apId: PARENT,
    type: "Note",
    attributedTo: ALICE,
    content: "remote original",
    visibility: "public",
    published: "2026-06-20T00:00:00.000Z",
  });

  const sent: unknown[] = [];
  const res = await postReply(db, fakeActor(tako, "tako"), envFor(db, sent), {
    content: "replying without @-mentioning",
    in_reply_to: PARENT,
    visibility: "public",
  });
  expect([200, 201]).toContain(res.status);
  const created = (await res.json()) as { ap_id: string };

  // The persisted Create addresses the remote parent author in cc + a Mention tag.
  const createActivity = await findReplyCreate(db, created.ap_id);
  expect(createActivity).toBeTruthy();
  expect(createActivity?.cc).toContain(ALICE);
  expect(
    (createActivity?.tag || []).some(
      (t) => t.type === "Mention" && t.href === ALICE,
    ),
  ).toBe(true);

  // And the Create is delivered directly to the remote parent author's inbox.
  const deliveredToAlice = sent.some((m) => JSON.stringify(m).includes(ALICE));
  expect(deliveredToAlice).toBe(true);
});

test("a DIRECT reply does NOT implicitly disclose to the parent author", async () => {
  const db = await freshDb();
  const tako = await seedLocalActor(db, "tako");
  await db.insert(objects).values({
    apId: PARENT,
    type: "Note",
    attributedTo: ALICE,
    content: "remote original",
    visibility: "public",
    published: "2026-06-20T00:00:00.000Z",
  });

  const sent: unknown[] = [];
  const res = await postReply(db, fakeActor(tako, "tako"), envFor(db, sent), {
    content: "private thought, no mention",
    in_reply_to: PARENT,
    visibility: "direct",
  });
  // A direct reply with no mentions has no recipients — parent is NOT auto-added.
  expect([200, 201]).toContain(res.status);
  const deliveredToAlice = sent.some((m) => JSON.stringify(m).includes(ALICE));
  expect(deliveredToAlice).toBe(false);
});
