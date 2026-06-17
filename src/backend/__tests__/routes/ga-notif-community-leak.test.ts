import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA Wave-9 "NOTIF-GATE" #3 — private-community content leak via notifications.
 *
 * Community-scoped Notes are stored with `visibility = "public"` and a non-empty
 * `audienceJson = [communityApId]`. The list feeds keep them private via the
 * `audienceJson = "[]"` filter, but GET /api/notifications batch-loads
 * `objects.content` and returns it as `object_content` for EVERY notification
 * row with no read-gate.
 *
 * A private-community post that @-mentions a local NON-member creates a `Create`
 * notification in that non-member's inbox, so the non-member could read the
 * private post body verbatim. This test pins the gate: the mentioned non-member
 * still SEES the notification row, but its `object_content` is blanked. An
 * accepted member's notification for the same post still exposes the content.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  activities,
  communities,
  communityMembers,
  inbox as inboxTable,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import notificationsRoutes from "../../routes/notifications.ts";

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

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<string> {
  const apId = localApId(username);
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
    role: "member",
    created_at: new Date().toISOString(),
  } as unknown as Actor;
}

function appWith(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", notificationsRoutes);
  return app;
}

const COMMUNITY_AP_ID = `${APP_URL}/ap/communities/secretclub`;
const SECRET_BODY = "members only secret body";

type Notification = {
  id: string;
  type: string;
  object_ap_id: string | null;
  object_content: string;
};

async function fetchNotifications(
  db: Database,
  viewer: Actor,
): Promise<Notification[]> {
  const app = appWith(db, viewer);
  const res = await app.request(`${APP_URL}/`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { notifications: Notification[] };
  return body.notifications;
}

test("private-community Create notification does NOT leak post body to a non-member, but does to a member", async () => {
  const db = await freshDb();

  const author = await insertLocalActor(db, "author"); // member + author
  const member = await insertLocalActor(db, "member"); // accepted member, mentioned
  const outsider = await insertLocalActor(db, "outsider"); // NON-member, mentioned

  // Private community; membership = presence of a community_members row.
  await db.insert(communities).values({
    apId: COMMUNITY_AP_ID,
    type: "Group",
    preferredUsername: "secretclub",
    name: "Secret Club",
    inbox: `${COMMUNITY_AP_ID}/inbox`,
    outbox: `${COMMUNITY_AP_ID}/outbox`,
    followersUrl: `${COMMUNITY_AP_ID}/followers`,
    visibility: "private",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: author,
  });
  await db.insert(communityMembers).values([
    { communityApId: COMMUNITY_AP_ID, actorApId: author, role: "admin" },
    { communityApId: COMMUNITY_AP_ID, actorApId: member, role: "member" },
  ]);

  // Community-scoped Note: visibility="public" but addressed to the community.
  const objectApId = `${APP_URL}/ap/objects/secretpost`;
  await db.insert(objects).values({
    apId: objectApId,
    type: "Note",
    attributedTo: author,
    content: SECRET_BODY,
    visibility: "public",
    toJson: JSON.stringify([COMMUNITY_AP_ID, `${COMMUNITY_AP_ID}/followers`]),
    ccJson: JSON.stringify([member, outsider]),
    audienceJson: JSON.stringify([COMMUNITY_AP_ID]),
    communityApId: COMMUNITY_AP_ID,
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });

  // The mention Create activity (authored by `author`).
  const activityApId = `${APP_URL}/ap/activities/create-secretpost`;
  await db.insert(activities).values({
    apId: activityApId,
    type: "Create",
    actorApId: author,
    objectApId,
    rawJson: JSON.stringify({ id: activityApId, type: "Create" }),
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  // The Create lands in both the mentioned member's and non-member's inbox.
  await db.insert(inboxTable).values([
    {
      actorApId: member,
      activityApId,
      read: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      actorApId: outsider,
      activityApId,
      read: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);

  // -- Non-member: row present, but content blanked --------------------------
  const outsiderNotifs = await fetchNotifications(
    db,
    fakeActor(outsider, "outsider"),
  );
  const outsiderRow = outsiderNotifs.find((n) => n.object_ap_id === objectApId);
  expect(outsiderRow).toBeDefined();
  // The notification row is preserved (the non-member still learns they were
  // mentioned)...
  expect(outsiderRow!.type).toBe("mention");
  // ...but the private-community body is NOT leaked.
  expect(outsiderRow!.object_content).toBe("");
  expect(
    outsiderNotifs.some((n) => n.object_content.includes("secret body")),
  ).toBe(false);

  // -- Member: full content still exposed ------------------------------------
  const memberNotifs = await fetchNotifications(
    db,
    fakeActor(member, "member"),
  );
  const memberRow = memberNotifs.find((n) => n.object_ap_id === objectApId);
  expect(memberRow).toBeDefined();
  expect(memberRow!.object_content).toBe(SECRET_BODY);
});

test("non-community Create notification still exposes its content (gate never narrows public reach)", async () => {
  const db = await freshDb();

  const author = await insertLocalActor(db, "pauthor");
  const recipient = await insertLocalActor(db, "precipient");

  const objectApId = `${APP_URL}/ap/objects/openpost`;
  const openBody = "open mention body";
  await db.insert(objects).values({
    apId: objectApId,
    type: "Note",
    attributedTo: author,
    content: openBody,
    visibility: "public",
    toJson: JSON.stringify([recipient]),
    ccJson: "[]",
    audienceJson: "[]",
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });

  const activityApId = `${APP_URL}/ap/activities/create-openpost`;
  await db.insert(activities).values({
    apId: activityApId,
    type: "Create",
    actorApId: author,
    objectApId,
    rawJson: JSON.stringify({ id: activityApId, type: "Create" }),
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  await db.insert(inboxTable).values({
    actorApId: recipient,
    activityApId,
    read: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const notifs = await fetchNotifications(
    db,
    fakeActor(recipient, "precipient"),
  );
  const row = notifs.find((n) => n.object_ap_id === objectApId);
  expect(row).toBeDefined();
  expect(row!.object_content).toBe(openBody);
});
