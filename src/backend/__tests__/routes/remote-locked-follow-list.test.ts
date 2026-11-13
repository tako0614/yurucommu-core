import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { actors, actorCache, follows } from "../../../db/index.ts";
import { admitSessionRequest } from "../../lib/account-deletion-admission.ts";
import actorsRoute from "../../routes/actors.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://graph.test";
const OWNER = `${APP_URL}/ap/users/owner`;
const MEMBER = `${APP_URL}/ap/users/member`;
const REMOTE = "https://remote.example/actors/target";
const clients: Awaited<ReturnType<typeof createTestDb>>["client"][] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

type Direction = "followers" | "following";

async function fixture(rawJson: string, localPrivate?: 0 | 1) {
  const { db, client } = await createTestDb();
  clients.push(client);
  for (const [apId, username] of [
    [OWNER, "owner"],
    [MEMBER, "member"],
  ]) {
    await db.insert(actors).values({
      apId,
      preferredUsername: username,
      isPrivate: apId === OWNER ? (localPrivate ?? 0) : 0,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "unused-local-fixture",
      privateKeyPem: "unused-local-fixture",
    });
  }
  const target = localPrivate === undefined ? REMOTE : OWNER;
  await db.insert(actorCache).values({
    apId: target,
    preferredUsername: "target",
    inbox: `${target}/inbox`,
    rawJson,
  });
  for (const [followerApId, followingApId] of [
    [MEMBER, target],
    [target, MEMBER],
  ]) {
    await db.insert(follows).values({
      followerApId,
      followingApId,
      status: "accepted",
    });
  }
  async function read(direction: Direction, viewer: string | null = null) {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set(
        "actor",
        viewer
          ? ({
              ap_id: viewer,
              preferred_username: viewer === OWNER ? "owner" : "member",
              public_key_pem: "unused-local-fixture",
              takos_user_id: null,
            } as Actor)
          : null,
      );
      await admitSessionRequest(c, next);
    });
    app.route("/api/actors", actorsRoute);
    const response = await app.fetch(
      new Request(
        `${APP_URL}/api/actors/${encodeURIComponent(target)}/${direction}?limit=1`,
      ),
      { APP_URL, DB_INSTANCE: db } as Env,
    );
    const body = (await response.json()) as {
      followers?: { ap_id: string }[];
      following?: { ap_id: string }[];
      total: number;
      limit: number;
      offset: number;
      has_more: boolean;
    };
    return {
      status: response.status,
      items: body[direction]?.map((actor) => actor.ap_id),
      total: body.total,
      limit: body.limit,
      offset: body.offset,
      hasMore: body.has_more,
    };
  }
  return { read };
}

for (const direction of ["followers", "following"] as const) {
  for (const viewer of [null, MEMBER]) {
    test(`cached locked ${direction} hides members from ${viewer ? "non-owner member" : "anonymous"}`, async () => {
      const f = await fixture('{"manuallyApprovesFollowers":true}');
      expect(await f.read(direction, viewer)).toEqual({
        status: 200,
        items: [],
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
      });
    });
  }

  for (const [label, raw] of [
    ["public", '{"manuallyApprovesFollowers":false}'],
    ["missing flag", "{}"],
    ["invalid JSON", "not JSON"],
    ["null document", "null"],
    ["array document", "[]"],
    ["string flag", '{"manuallyApprovesFollowers":"true"}'],
    ["numeric flag", '{"manuallyApprovesFollowers":1}'],
  ]) {
    test(`cached ${label} ${direction} retains the public mirror`, async () => {
      const f = await fixture(raw);
      expect(await f.read(direction)).toEqual({
        status: 200,
        items: [MEMBER],
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
      });
    });
  }

  test(`local private ${direction} keeps owner access and non-owner count`, async () => {
    const f = await fixture('{"manuallyApprovesFollowers":false}', 1);
    expect((await f.read(direction, OWNER)).items).toEqual([MEMBER]);
    expect(await f.read(direction, MEMBER)).toEqual({
      status: 200,
      items: [],
      total: 1,
      limit: 1,
      offset: 0,
      hasMore: false,
    });
  });

  test(`local public ${direction} takes precedence over a cached locked flag`, async () => {
    const f = await fixture('{"manuallyApprovesFollowers":true}', 0);
    expect((await f.read(direction)).items).toEqual([MEMBER]);
  });
}
