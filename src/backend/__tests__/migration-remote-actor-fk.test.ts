import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createClient, type Client } from "@libsql/client";

/**
 * Regression guard for migrations 0010 + 0011 (the "D1 enforces foreign keys"
 * fix). Cloudflare D1 ENFORCES foreign keys — verified live, the same insert
 * that the Worker rejected fails with FOREIGN KEY constraint failed via the API.
 * The codebase had assumed D1 ignores FK (federation-ingest-fk.test.ts runs with
 * `PRAGMA foreign_keys = OFF`), so several tables kept stale `REFERENCES
 * actors(ap_id)` edges that 0002/0003 stripped elsewhere. Under enforcement
 * those edges break:
 *   - community group chat: object_recipients.recipient_ap_id holds a COMMUNITY
 *     id, not an actor (fixed by 0010);
 *   - inbound federation: objects.attributed_to / likes / announces / story_* /
 *     inbox hold REMOTE actors that live only in actor_cache (fixed by 0011).
 *
 * This test applies EVERY migration with `foreign_keys = ON` (mirroring D1) and
 * asserts: (a) inbound remote-actor inserts succeed, (b) a community recipient
 * inserts, and (c) the 0011 `objects` rebuild PRESERVES all child rows rather
 * than cascade-deleting them. It would have caught both production bugs.
 */

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
  "0010_object_recipients_drop_actor_fk.sql",
  "0011_drop_remote_actor_fks.sql",
];

const APP = "https://yuru.test";
const HOST = `${APP}/ap/users/host`;
const OBJ = `${APP}/ap/objects/p1`;
const COMMUNITY = `${APP}/ap/groups/g1`;
const REMOTE = "https://remote.example/users/alice";

async function applyMigrations(client: Client): Promise<void> {
  const root = new URL("../../../migrations/", import.meta.url);
  for (const f of MIGRATIONS) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
}

const CHILD_TABLES = [
  "likes",
  "announces",
  "bookmarks",
  "object_recipients",
  "story_views",
  "story_votes",
  "story_shares",
  "inbox",
  "objects",
];

test("with FK ON (matching D1), inbound remote-actor inserts succeed after 0011", async () => {
  const c = createClient({ url: ":memory:" });
  await c.execute("PRAGMA foreign_keys = ON");
  await applyMigrations(c);

  // A local actor + a local object exist; the remote actor lives nowhere in
  // `actors` (only ever in actor_cache in production).
  await c.execute({
    sql: "INSERT INTO actors (ap_id,type,preferred_username,inbox,outbox,followers_url,following_url,public_key_pem,private_key_pem) VALUES (?,?,?,?,?,?,?,?,?)",
    args: [HOST, "Person", "host", "i", "o", "f", "g", "pk", "sk"],
  });
  await c.execute({
    sql: "INSERT INTO objects (ap_id,type,attributed_to,content,visibility) VALUES (?,?,?,?,?)",
    args: [OBJ, "Note", HOST, "hi", "public"],
  });
  await c.execute({
    sql: "INSERT INTO activities (ap_id,type,actor_ap_id,raw_json) VALUES (?,?,?,?)",
    args: ["act-remote", "Like", REMOTE, "{}"],
  });

  // None of these would be possible with the stale actors FK enforced.
  await c.execute({
    sql: "INSERT INTO objects (ap_id,type,attributed_to,content,is_local) VALUES (?,?,?,?,0)",
    args: ["https://remote.example/o1", "Note", REMOTE, "remote post"],
  });
  await c.execute({
    sql: "INSERT INTO likes (actor_ap_id,object_ap_id) VALUES (?,?)",
    args: [REMOTE, OBJ],
  });
  await c.execute({
    sql: "INSERT INTO announces (actor_ap_id,object_ap_id) VALUES (?,?)",
    args: [REMOTE, OBJ],
  });
  await c.execute({
    sql: "INSERT INTO inbox (actor_ap_id,activity_ap_id) VALUES (?,?)",
    args: [REMOTE, "act-remote"],
  });
  // A community (not an actor) is a valid object_recipients recipient.
  await c.execute({
    sql: "INSERT INTO object_recipients (object_ap_id,recipient_ap_id,type) VALUES (?,?,?)",
    args: [OBJ, COMMUNITY, "audience"],
  });

  const remoteObjects = await c.execute(
    "SELECT COUNT(*) AS n FROM objects WHERE is_local = 0",
  );
  expect(Number(remoteObjects.rows[0].n)).toBe(1);

  // The objects table must no longer carry the actors FK, but must keep the
  // communities FK.
  const ddl = String(
    (await c.execute("SELECT sql FROM sqlite_master WHERE name='objects'"))
      .rows[0].sql,
  );
  expect(/REFERENCES actors/.test(ddl)).toBe(false);
  expect(/REFERENCES communities/.test(ddl)).toBe(true);
});

test("0011 rebuild of `objects` preserves every child row (no cascade wipe)", async () => {
  const c = createClient({ url: ":memory:" });
  await c.execute("PRAGMA foreign_keys = ON");
  // Apply everything EXCEPT 0011 first, seed child rows, THEN apply 0011 and
  // confirm nothing was cascade-deleted by the objects DROP.
  const root = new URL("../../../migrations/", import.meta.url);
  for (const f of MIGRATIONS.slice(0, -1)) {
    await c.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  await c.execute({
    sql: "INSERT INTO actors (ap_id,type,preferred_username,inbox,outbox,followers_url,following_url,public_key_pem,private_key_pem) VALUES (?,?,?,?,?,?,?,?,?)",
    args: [HOST, "Person", "host", "i", "o", "f", "g", "pk", "sk"],
  });
  await c.execute({
    sql: "INSERT INTO objects (ap_id,type,attributed_to,content,visibility) VALUES (?,?,?,?,?)",
    args: [OBJ, "Note", HOST, "hi", "public"],
  });
  await c.execute({
    sql: "INSERT INTO activities (ap_id,type,actor_ap_id,raw_json) VALUES (?,?,?,?)",
    args: ["act1", "Create", HOST, "{}"],
  });
  await c.execute({
    sql: "INSERT INTO likes (actor_ap_id,object_ap_id) VALUES (?,?)",
    args: [HOST, OBJ],
  });
  await c.execute({
    sql: "INSERT INTO announces (actor_ap_id,object_ap_id) VALUES (?,?)",
    args: [HOST, OBJ],
  });
  await c.execute({
    sql: "INSERT INTO bookmarks (actor_ap_id,object_ap_id) VALUES (?,?)",
    args: [HOST, OBJ],
  });
  await c.execute({
    sql: "INSERT INTO object_recipients (object_ap_id,recipient_ap_id,type) VALUES (?,?,?)",
    args: [OBJ, COMMUNITY, "audience"],
  });
  await c.execute({
    sql: "INSERT INTO story_views (actor_ap_id,story_ap_id) VALUES (?,?)",
    args: [HOST, OBJ],
  });
  await c.execute({
    sql: "INSERT INTO story_votes (id,story_ap_id,actor_ap_id,option_index) VALUES (?,?,?,?)",
    args: ["v1", OBJ, HOST, 0],
  });
  await c.execute({
    sql: "INSERT INTO story_shares (id,story_ap_id,actor_ap_id) VALUES (?,?,?)",
    args: ["s1", OBJ, HOST],
  });
  await c.execute({
    sql: "INSERT INTO inbox (actor_ap_id,activity_ap_id) VALUES (?,?)",
    args: [HOST, "act1"],
  });

  await c.executeMultiple(
    await readFile(new URL("0011_drop_remote_actor_fks.sql", root), "utf8"),
  );

  for (const tb of CHILD_TABLES) {
    const n = Number(
      (await c.execute(`SELECT COUNT(*) AS n FROM ${tb}`)).rows[0].n,
    );
    expect(n).toBe(1);
  }
});
