import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import postsRoutes from "../../routes/posts/routes.ts";

// ---------------------------------------------------------------------------
// A DM note (`visibility="direct"`, created by createDmNote) is NOT counted in
// the author's postCount on send. The generic `DELETE /:id` post-delete route
// must therefore NOT decrement postCount when it deletes one — otherwise a DM
// removed through this endpoint (rather than the dedicated
// DELETE /dm/messages/:id, which already skips the count) drives the author's
// postCount below the true post total. This test pins the create/delete
// symmetry: deleting a direct note leaves postCount untouched while deleting a
// regular post decrements it.
// ---------------------------------------------------------------------------

const APP_URL = "https://yuru.test";

const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
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

function appWith(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db as unknown as never);
    c.set("actor", actor);
    await next();
  });
  app.route("/", postsRoutes);
  return app;
}

async function postCountOf(db: Database, apId: string): Promise<number> {
  const row = await db
    .select({ postCount: actors.postCount })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
  return row?.postCount ?? -1;
}

test("DELETE /:id on a direct (DM) note does NOT decrement postCount, but a regular post does", async () => {
  const db = await freshDb();
  const authorApId = `${APP_URL}/ap/users/tako`;

  await db.insert(actors).values({
    apId: authorApId,
    type: "Person",
    preferredUsername: "tako",
    inbox: `${authorApId}/inbox`,
    outbox: `${authorApId}/outbox`,
    followersUrl: `${authorApId}/followers`,
    followingUrl: `${authorApId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    // The author already has 5 real (non-DM) posts counted.
    postCount: 5,
  });

  const dmApId = `${APP_URL}/ap/objects/dm-1`;
  const postApId = `${APP_URL}/ap/objects/post-1`;
  const now = new Date().toISOString();

  // DM note: direct visibility, NOT reflected in postCount (mirrors createDmNote).
  await db.insert(objects).values({
    apId: dmApId,
    type: "Note",
    attributedTo: authorApId,
    content: "secret",
    visibility: "direct",
    toJson: JSON.stringify([]),
    ccJson: JSON.stringify([]),
    conversation: `${APP_URL}/dm/x`,
    published: now,
    isLocal: 1,
  });
  // Regular public post: counted in postCount.
  await db.insert(objects).values({
    apId: postApId,
    type: "Note",
    attributedTo: authorApId,
    content: "hello",
    visibility: "public",
    toJson: JSON.stringify([]),
    ccJson: JSON.stringify([]),
    published: now,
    isLocal: 1,
  });

  const actor = { ap_id: authorApId, username: "tako" } as unknown as Actor;
  const app = appWith(db, actor);
  const env = { APP_URL } as unknown as Env;

  // Delete the DM note via the generic post-delete endpoint.
  const dmRes = await app.request(
    `${APP_URL}/${encodeURIComponent(dmApId)}`,
    { method: "DELETE" },
    env,
  );
  expect(dmRes.status).toBe(200);
  // The object is gone...
  const dmRow = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, dmApId))
    .get();
  expect(dmRow).toBeUndefined();
  // ...but postCount is UNCHANGED (the DM never incremented it).
  expect(await postCountOf(db, authorApId)).toBe(5);

  // Control: deleting a regular counted post DOES decrement.
  const postRes = await app.request(
    `${APP_URL}/${encodeURIComponent(postApId)}`,
    { method: "DELETE" },
    env,
  );
  expect(postRes.status).toBe(200);
  expect(await postCountOf(db, authorApId)).toBe(4);
});
