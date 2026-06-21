import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../../db/schema.ts";
import type { Database } from "../../../../db/index.ts";
import { actors, communities, communityMembers } from "../../../../db/index.ts";
import type { Env, Variables } from "../../../types.ts";
import activitypubRoutes from "../../../routes/activitypub.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertCommunity(
  db: Database,
  name: string,
  visibility: "public" | "private",
): Promise<string> {
  const apId = `${APP_URL}/ap/groups/${name}`;
  await db.insert(communities).values({
    apId,
    preferredUsername: name,
    name: `${name} display`,
    summary: `about ${name}`,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility,
    joinPolicy: "open",
    postPolicy: "members",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----",
    privateKeyPem: "priv",
    createdBy: `${APP_URL}/ap/users/owner`,
  });
  return apId;
}

function app(db: Database) {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });
  a.route("/", activitypubRoutes);
  return a;
}

function env(): Env {
  return { APP_URL } as unknown as Env;
}

test("webfinger resolves a PUBLIC community Group actor", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "club", "public");

  const res = await app(db).fetch(
    new Request(
      `${APP_URL}/.well-known/webfinger?resource=acct:club@yuru.test`,
    ),
    env(),
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as {
    subject: string;
    links: Array<{ rel: string; href: string; type?: string }>;
  };
  expect(body.subject).toEqual("acct:club@yuru.test");
  expect(body.links.find((l) => l.rel === "self")?.href).toEqual(apId);
  expect(
    body.links.find((l) => l.rel === "http://webfinger.net/rel/profile-page")
      ?.href,
  ).toEqual(`${APP_URL}/groups/club`);
});

test("webfinger 404s a PRIVATE community (existence is members-only)", async () => {
  const db = await freshDb();
  await insertCommunity(db, "secret", "private");

  const res = await app(db).fetch(
    new Request(
      `${APP_URL}/.well-known/webfinger?resource=acct:secret@yuru.test`,
    ),
    env(),
  );
  expect(res.status).toEqual(404);
});

test("GET /ap/groups/:name serves a valid Group actor doc for a public community", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "club", "public");

  const res = await app(db).fetch(
    new Request(`${APP_URL}/ap/groups/club`, {
      headers: { Accept: "application/activity+json" },
    }),
    env(),
  );
  expect(res.status).toEqual(200);
  expect(res.headers.get("content-type")).toContain(
    "application/activity+json",
  );
  const doc = (await res.json()) as Record<string, unknown>;
  expect(doc.id).toEqual(apId);
  expect(doc.type).toEqual("Group");
  expect(doc.preferredUsername).toEqual("club");
  expect(doc.inbox).toEqual(`${apId}/inbox`);
  expect(doc.outbox).toEqual(`${apId}/outbox`);
  expect(doc.followers).toEqual(`${apId}/followers`);
  expect(doc.url).toEqual(`${APP_URL}/groups/club`);
  expect((doc.publicKey as { id: string }).id).toEqual(`${apId}#main-key`);
  expect(doc.moderators).toEqual(`${apId}/moderators`);
  // open join policy -> auto-accept follows.
  expect(doc.manuallyApprovesFollowers).toEqual(false);
});

test("GET /ap/groups/:name/moderators lists the owner + moderators", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "club", "public");
  // community_members.actor_ap_id FKs to actors, so members are LOCAL actors.
  const insertActor = async (name: string) => {
    const a = `${APP_URL}/ap/users/${name}`;
    await db.insert(actors).values({
      apId: a,
      type: "Person",
      preferredUsername: name,
      inbox: `${a}/inbox`,
      outbox: `${a}/outbox`,
      followersUrl: `${a}/followers`,
      followingUrl: `${a}/following`,
      publicKeyPem: "pub",
      privateKeyPem: "priv",
    });
    return a;
  };
  const owner = await insertActor("owner");
  const mod = await insertActor("mod");
  const plainMember = await insertActor("member");
  await db.insert(communityMembers).values([
    { communityApId: apId, actorApId: owner, role: "owner" },
    { communityApId: apId, actorApId: mod, role: "moderator" },
    { communityApId: apId, actorApId: plainMember, role: "member" },
  ]);

  const res = await app(db).fetch(
    new Request(`${APP_URL}/ap/groups/club/moderators`, {
      headers: { Accept: "application/activity+json" },
    }),
    env(),
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as {
    type: string;
    totalItems: number;
    orderedItems: string[];
  };
  expect(body.type).toEqual("OrderedCollection");
  expect(body.totalItems).toEqual(2);
  expect(body.orderedItems).toContain(owner);
  expect(body.orderedItems).toContain(mod);
  // a plain member is NOT a moderator.
  expect(body.orderedItems).not.toContain(plainMember);
});

test("GET /ap/groups/:name 404s private + nonexistent communities", async () => {
  const db = await freshDb();
  await insertCommunity(db, "secret", "private");

  const priv = await app(db).fetch(
    new Request(`${APP_URL}/ap/groups/secret`, {
      headers: { Accept: "application/activity+json" },
    }),
    env(),
  );
  expect(priv.status).toEqual(404);

  const missing = await app(db).fetch(
    new Request(`${APP_URL}/ap/groups/nope`, {
      headers: { Accept: "application/activity+json" },
    }),
    env(),
  );
  expect(missing.status).toEqual(404);
});

test("community outbox + followers are valid OrderedCollections", async () => {
  const db = await freshDb();
  await insertCommunity(db, "club", "public");

  for (const path of ["/ap/groups/club/outbox", "/ap/groups/club/followers"]) {
    const res = await app(db).fetch(
      new Request(`${APP_URL}${path}`, {
        headers: { Accept: "application/activity+json" },
      }),
      env(),
    );
    expect(res.status).toEqual(200);
    const body = (await res.json()) as { type: string; totalItems: number };
    expect(body.type).toEqual("OrderedCollection");
    expect(body.totalItems).toEqual(0);
  }
});
