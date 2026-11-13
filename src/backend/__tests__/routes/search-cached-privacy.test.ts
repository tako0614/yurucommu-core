import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { actors, actorCache } from "../../../db/index.ts";
import { admitSessionRequest } from "../../lib/account-deletion-admission.ts";
import actorsRoute from "../../routes/actors.ts";
import searchRoute from "../../routes/search.ts";
import type { Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://search.test";
const LOCAL = `${APP_URL}/ap/users/member-public`;
const PRIVATE = `${APP_URL}/ap/users/member-private`;
const REMOTE = "https://remote.example/actors/member";
const clients: Awaited<ReturnType<typeof createTestDb>>["client"][] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function fixture(rawJson: string) {
  const { db, client } = await createTestDb();
  clients.push(client);
  for (const [apId, username, isPrivate] of [
    [LOCAL, "member-public", 0],
    [PRIVATE, "member-private", 1],
  ] as const) {
    await db.insert(actors).values({
      apId,
      preferredUsername: username,
      name: username,
      isPrivate,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "unused-local-fixture",
      privateKeyPem: "unused-local-fixture",
    });
  }
  async function cache(apId: string, raw: string) {
    await db.insert(actorCache).values({
      apId,
      preferredUsername: "member",
      name: "Member",
      inbox: `${apId}/inbox`,
      rawJson: raw,
    });
  }
  await cache(REMOTE, rawJson);
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", null);
    await admitSessionRequest(c, next);
  });
  app.route("/api/search", searchRoute);
  app.route("/api/actors", actorsRoute);
  async function search(query = "member") {
    const response = await app.fetch(
      new Request(
        `${APP_URL}/api/search/actors?q=${encodeURIComponent(query)}`,
      ),
      { APP_URL, DB_INSTANCE: db } as Env,
    );
    const body = (await response.json()) as {
      actors: { ap_id: string; name: string | null }[];
      limit: number;
      offset: number;
      has_more: boolean;
    };
    return {
      status: response.status,
      ids: body.actors.map((actor) => actor.ap_id).sort(),
      names: body.actors.map((actor) => actor.name),
      limit: body.limit,
      offset: body.offset,
      hasMore: body.has_more,
    };
  }
  async function profile() {
    return app.fetch(
      new Request(`${APP_URL}/api/actors/${encodeURIComponent(REMOTE)}`),
      { APP_URL, DB_INSTANCE: db } as Env,
    );
  }
  return { db, cache, search, profile };
}

const publicIds = [LOCAL, REMOTE].sort();

test("ordinary public actors remain searchable and local private rows stay hidden", async () => {
  const f = await fixture(
    '{"discoverable":true,"manuallyApprovesFollowers":false}',
  );
  expect(await f.search()).toEqual({
    status: 200,
    ids: publicIds,
    names: ["Member", "member-public"],
    limit: 20,
    offset: 0,
    hasMore: false,
  });
});

for (const [label, raw] of [
  ["opt-out", '{"discoverable":false}'],
  ["locked", '{"manuallyApprovesFollowers":true}'],
]) {
  test(`ordinary name search withholds cached ${label} actors`, async () => {
    const f = await fixture(raw);
    expect((await f.search()).ids).toEqual([LOCAL]);
  });

  test(`cached ${label} actor still has its existing exact-ID profile`, async () => {
    const f = await fixture(raw);
    const response = await f.profile();
    expect(response.status).toBe(200);
    expect((await response.json()).actor.ap_id).toBe(REMOTE);
  });
}

for (const [label, raw] of [
  ["absent flags", "{}"],
  ["invalid JSON", "not JSON"],
  ["null document", "null"],
  ["array document", "[]"],
  [
    "nonboolean strings",
    '{"discoverable":"false","manuallyApprovesFollowers":"true"}',
  ],
  ["nonboolean numbers", '{"discoverable":0,"manuallyApprovesFollowers":1}'],
  [
    "opposite booleans",
    '{"discoverable":true,"manuallyApprovesFollowers":false}',
  ],
]) {
  test(`cached ${label} retains the prior public search default`, async () => {
    const f = await fixture(raw);
    expect((await f.search()).ids).toEqual(publicIds);
  });
}

test("a stale cached copy cannot reintroduce an exact local private actor", async () => {
  const f = await fixture("{}");
  await f.cache(
    PRIVATE,
    '{"discoverable":true,"manuallyApprovesFollowers":false}',
  );
  expect((await f.search()).ids).toEqual(publicIds);
});

test("a stale cached copy cannot reintroduce an exact local soft-deleted actor", async () => {
  const f = await fixture("{}");
  await f.db
    .update(actors)
    .set({ deletedAt: "2026-01-01T00:00:00.000Z" })
    .where(eq(actors.apId, LOCAL));
  await f.cache(LOCAL, '{"discoverable":true}');
  expect((await f.search()).ids).toEqual([REMOTE]);
});

test("local public identity takes priority over a cached opt-out spelling", async () => {
  const f = await fixture("{}");
  await f.cache(LOCAL, '{"discoverable":false}');
  const result = await f.search();
  expect(result.ids).toEqual(publicIds);
  expect(result.names).toEqual(["Member", "member-public"]);
});

test("leading at-sign search retains cached privacy filtering", async () => {
  const f = await fixture('{"discoverable":false}');
  expect((await f.search("@member")).ids).toEqual([LOCAL]);
});
