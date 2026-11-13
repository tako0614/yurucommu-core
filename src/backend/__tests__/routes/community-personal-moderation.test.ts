import { expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { InArgs, InStatement } from "@libsql/client";
import {
  actors,
  blocks,
  communities,
  communityMembers,
  mutes,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import { guardActorWrites } from "../../lib/account-deletion-admission.ts";
import { MemoryKV } from "../../runtime/memory-kv.ts";
import messages from "../../routes/communities/messages.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP = "https://community-moderation.test";
const GROUP = `${APP}/ap/groups/town`;
const id = (name: string) => `${APP}/ap/users/${name}`;
const AUTHOR = id("author"),
  VIEWER = id("viewer"),
  CONTROL = id("control");
const RETAINED_AUTHOR =
  "https://COMMUNITY-MODERATION.test:443/ap/users/author/#profile";

async function fixture() {
  const { db, client } = await createTestDb();
  async function member(apId: string) {
    await db.insert(actors).values({
      apId,
      type: "Person",
      preferredUsername: apId.split("/").at(-1)!,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "unused-local-fixture",
      privateKeyPem: "unused-local-fixture",
    });
    await db
      .insert(communityMembers)
      .values({ communityApId: GROUP, actorApId: apId, role: "member" });
  }
  // Community creator is metadata, not a grant to the injected route actor.
  await db.insert(communities).values({
    apId: GROUP,
    preferredUsername: "town",
    name: "Town",
    visibility: "public",
    inbox: `${GROUP}/inbox`,
    outbox: `${GROUP}/outbox`,
    followersUrl: `${GROUP}/followers`,
    publicKeyPem: "unused-local-fixture",
    privateKeyPem: "unused-local-fixture",
    createdBy: AUTHOR,
    postPolicy: "members",
  });
  for (const apId of [AUTHOR, VIEWER, CONTROL]) await member(apId);
  const events: {
    actor: string;
    type: string;
    data: Record<string, unknown>;
  }[] = [];
  const namespace = {
    idFromName: (actor: string) => actor,
    get: (actor: string) => ({
      async fetch(url: string, init: RequestInit) {
        if (url !== "https://realtime-do/_emit" || init.method !== "POST")
          throw new Error("Unexpected isolated realtime operation");
        events.push({ actor, ...JSON.parse(String(init.body)) });
        return new Response(null, { status: 204 });
      },
    }),
  };
  // Only the namespace boundary is captured. Actual hub serialization, route,
  // admission guards, SQL and unread computation run; no real identity or DO.
  const env = {
    APP_URL: APP,
    DB_INSTANCE: db,
    KV: new MemoryKV(),
    REALTIME_STREAM: namespace,
  } as unknown as Env;
  function appFor(apId: string | null) {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
      const actor = apId
        ? ({
            ap_id: apId,
            type: "Person",
            preferred_username: apId.split("/").at(-1)!,
            public_key_pem: "unused-local-fixture",
            takos_user_id: null,
          } as Actor)
        : null;
      c.set("actor", actor);
      c.set("db", actor ? guardActorWrites(db, actor) : db);
      await next();
    });
    app.route("/", messages);
    return app;
  }
  async function read(apId: string | null, query = "") {
    return appFor(apId).fetch(new Request(`${APP}/town/messages${query}`), env);
  }
  async function send() {
    return appFor(AUTHOR).fetch(
      new Request(`${APP}/town/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "ordinary community message" }),
      }),
      env,
    );
  }
  async function chat(author: string, name: string, second: number) {
    const apId = `${APP}/ap/objects/${name}`,
      published = `2026-11-01T00:00:0${second}.000Z`;
    await db.insert(objects).values({
      apId,
      type: "Note",
      attributedTo: author,
      content: name,
      visibility: "unlisted",
      published,
      isLocal: 1,
    });
    await db.insert(objectRecipients).values({
      objectApId: apId,
      recipientApId: GROUP,
      type: "audience",
      createdAt: published,
    });
  }
  return { db, client, member, events, read, send, chat };
}

type Page = {
  messages: { content: string; created_at: string }[];
  has_more: boolean;
};
for (const mode of ["block", "mute", "retained-block"] as const) {
  test(`community page applies viewer ${mode} before limit/cursor without deleting history`, async () => {
    const f = await fixture();
    try {
      await f.chat(CONTROL, "older", 1);
      await f.chat(CONTROL, "visible", 2);
      await f.chat(AUTHOR, "suppressed", 3);
      if (mode === "mute")
        await f.db
          .insert(mutes)
          .values({ muterApId: VIEWER, mutedApId: AUTHOR });
      else
        await f.db.insert(blocks).values({
          blockerApId: VIEWER,
          blockedApId: mode === "retained-block" ? RETAINED_AUTHOR : AUTHOR,
        });
      const before = await f.db.select().from(objects);
      const response = await f.read(VIEWER, "?limit=1");
      expect(response.status).toBe(200);
      const page = (await response.json()) as Page;
      expect(page.messages.map((m) => m.content)).toEqual(["visible"]);
      expect(page.has_more).toBe(true);
      const next = await f.read(
        VIEWER,
        `?limit=1&before=${encodeURIComponent(page.messages[0].created_at)}`,
      );
      expect(next.status).toBe(200);
      const older = (await next.json()) as Page;
      expect(older.messages.map((m) => m.content)).toEqual(["older"]);
      expect(older.has_more).toBe(false);
      expect(
        ((await (await f.read(CONTROL)).json()) as Page).messages.map(
          (m) => m.content,
        ),
      ).toEqual(["older", "visible", "suppressed"]);
      await f.db.delete(blocks).where(eq(blocks.blockerApId, VIEWER));
      await f.db.delete(mutes).where(eq(mutes.muterApId, VIEWER));
      expect(
        (
          (await (await f.read(VIEWER, "?limit=1")).json()) as Page
        ).messages.map((m) => m.content),
      ).toEqual(["suppressed"]);
      expect(await f.db.select().from(objects)).toEqual(before);
    } finally {
      f.client.close();
    }
  });
}

test("community realtime filters block/mute viewers across 121 members with bounded SQL and normal persistence", async () => {
  const f = await fixture();
  try {
    const members = [AUTHOR, VIEWER, CONTROL];
    for (let n = 3; n < 121; n++) {
      const apId = id(`member-${n}`);
      await f.member(apId);
      members.push(apId);
    }
    const excluded = [
      VIEWER,
      members[39],
      members[40],
      members[80],
      members[120],
    ];
    for (const [n, owner] of excluded.entries()) {
      if (n % 2)
        await f.db
          .insert(mutes)
          .values({ muterApId: owner, mutedApId: RETAINED_AUTHOR });
      else
        await f.db.insert(blocks).values({
          blockerApId: owner,
          blockedApId: n ? RETAINED_AUTHOR : AUTHOR,
        });
    }
    // Direction is the viewer's choice: a sender's unrelated block does not
    // turn into a membership or read-access revocation for the control member.
    await f.db
      .insert(blocks)
      .values({ blockerApId: AUTHOR, blockedApId: CONTROL });
    const response = await f.send();
    expect(response.status).toBe(201);
    const expected = members.filter((apId) => !excluded.includes(apId)).sort();
    expect(
      f.events
        .filter((e) => e.type === "talk.message")
        .map((e) => e.actor)
        .sort(),
    ).toEqual(expected);
    expect(
      f.events
        .filter((e) => e.type === "unread")
        .map((e) => e.actor)
        .sort(),
    ).toEqual(expected.filter((apId) => apId !== AUTHOR));
    expect(await f.db.select().from(objects)).toHaveLength(1);
    expect(await f.db.select().from(objectRecipients)).toHaveLength(1);
    expect(await f.db.select().from(communityMembers)).toHaveLength(121);
    expect(
      f.events.some((e) => e.type === "talk.message" && e.actor === CONTROL),
    ).toBe(true);
    await f.db.delete(blocks).where(eq(blocks.blockerApId, VIEWER));
    f.events.length = 0;
    expect((await f.send()).status).toBe(201);
    expect(
      f.events
        .filter((e) => e.actor === VIEWER)
        .map((e) => e.type)
        .sort(),
    ).toEqual(["talk.message", "unread"]);
  } finally {
    f.client.close();
  }
});

test("community membership and anonymous read gates stay independent of personal moderation", async () => {
  const f = await fixture();
  try {
    await f.chat(AUTHOR, "retained", 1);
    await f.db
      .update(communities)
      .set({ visibility: "private" })
      .where(eq(communities.apId, GROUP));
    await f.db
      .delete(communityMembers)
      .where(eq(communityMembers.actorApId, VIEWER));
    expect((await f.read(null)).status).toBe(401);
    expect((await f.read(VIEWER)).status).toBe(403);
    expect((await f.read(CONTROL)).status).toBe(200);
    expect(await f.db.select().from(objects)).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

test("failed realtime member selection emits nothing without undoing the committed message", async () => {
  const f = await fixture();
  try {
    const execute = f.client.execute.bind(f.client) as typeof f.client.execute;
    let failedSelection = false;
    f.client.execute = (async (statement: InStatement, args?: InArgs) => {
      const query = typeof statement === "string" ? statement : statement.sql;
      if (
        query.includes('from "community_members"') &&
        query.includes("limit") &&
        !query.includes('"role"')
      ) {
        failedSelection = true;
        throw new Error("isolated realtime selection failure");
      }
      return typeof statement === "string"
        ? execute(statement, args)
        : execute(statement);
    }) as typeof f.client.execute;
    expect((await f.send()).status).toBe(201);
    expect(failedSelection).toBe(true);
    expect(f.events).toHaveLength(0);
    expect(await f.db.select().from(objects)).toHaveLength(1);
    expect(await f.db.select().from(objectRecipients)).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

test("community realtime retains the original 200-member candidate cap before filtering", async () => {
  const f = await fixture();
  try {
    for (let n = 3; n < 205; n++) await f.member(id(`cap-member-${n}`));
    // The old query is the oracle for this existing dispatch budget. Do not
    // replace suppressed candidates with members outside that selected cohort.
    const originalCandidates = await f.db
      .select({ actorApId: communityMembers.actorApId })
      .from(communityMembers)
      .where(eq(communityMembers.communityApId, GROUP))
      .limit(200);
    const suppressed = originalCandidates.find(
      (m) => m.actorApId !== AUTHOR,
    )!.actorApId;
    await f.db
      .insert(blocks)
      .values({ blockerApId: suppressed, blockedApId: AUTHOR });
    const expected = originalCandidates
      .map((m) => m.actorApId)
      .filter((m) => m !== suppressed)
      .sort();
    expect(originalCandidates).toHaveLength(200);
    expect((await f.send()).status).toBe(201);
    expect(
      f.events
        .filter((e) => e.type === "talk.message")
        .map((e) => e.actor)
        .sort(),
    ).toEqual(expected);
    expect(
      f.events
        .filter((e) => e.type === "unread")
        .map((e) => e.actor)
        .sort(),
    ).toEqual(expected.filter((m) => m !== AUTHOR));
    expect(await f.db.select().from(communityMembers)).toHaveLength(205);
  } finally {
    f.client.close();
  }
});
