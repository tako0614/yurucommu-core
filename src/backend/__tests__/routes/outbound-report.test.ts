import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { activities } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { moderationRoutes } from "../../routes/moderation.ts";

/**
 * POST /api/moderation/reports/outbound — file an AS2 Flag against a remote
 * actor and federate it. Owner-gated; local targets rejected; the Flag is sent
 * from the instance actor and a delivery is enqueued to the reported actor.
 */

const APP_URL = "https://yuru.test";
const INSTANCE = `${APP_URL}/ap/actor`;
const REMOTE = "https://remote.example/users/abuser";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function fakeActor(role: "owner" | "member"): Actor {
  const apId = `${APP_URL}/ap/users/${role}`;
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: role,
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
    role,
    created_at: new Date().toISOString(),
  };
}

function envFor(db: Database, sent: unknown[]): Env {
  const queue = {
    send: (b: unknown) => {
      sent.push(b);
      return Promise.resolve();
    },
    sendBatch: (reqs: Array<{ body: unknown }>) => {
      for (const r of reqs) sent.push(r.body);
      return Promise.resolve();
    },
  };
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: { send: () => Promise.resolve() },
  } as unknown as Env;
}

function appWith(db: Database, actor: Actor | null, sent: unknown[]) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", moderationRoutes);
  return { app, env: envFor(db, sent) };
}

async function report(
  db: Database,
  actor: Actor | null,
  body: Record<string, unknown>,
  sent: unknown[] = [],
) {
  const { app, env } = appWith(db, actor, sent);
  return app.fetch(
    new Request(`${APP_URL}/reports/outbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

test("owner files a Flag against a remote actor: persisted + delivered from the instance actor", async () => {
  const db = await freshDb();
  const sent: unknown[] = [];
  const res = await report(
    db,
    fakeActor("owner"),
    {
      target_actor_ap_id: REMOTE,
      post_ap_id: "https://remote.example/objects/bad",
      reason: "spam",
    },
    sent,
  );
  expect(res.status).toBe(200);

  // A single outbound Flag from the instance actor, addressed to the target.
  const flag = await db
    .select()
    .from(activities)
    .where(and(eq(activities.type, "Flag"), eq(activities.actorApId, INSTANCE)))
    .get();
  expect(flag).toBeTruthy();
  expect(flag?.direction).toBe("outbound");
  const raw = JSON.parse(flag!.rawJson) as {
    type: string;
    actor: string;
    object: string[];
    content?: string;
  };
  expect(raw.type).toBe("Flag");
  expect(raw.actor).toBe(INSTANCE);
  expect(raw.object).toContain(REMOTE);
  expect(raw.object).toContain("https://remote.example/objects/bad");
  expect(raw.content).toBe("spam");

  // It was enqueued for delivery to the reported actor.
  expect(sent.some((m) => JSON.stringify(m).includes(REMOTE))).toBe(true);
});

test("a non-owner member is rejected (403) and files nothing", async () => {
  const db = await freshDb();
  const res = await report(db, fakeActor("member"), {
    target_actor_ap_id: REMOTE,
  });
  expect(res.status).toBe(403);
  expect((await db.select().from(activities).all()).length).toBe(0);
});

test("a LOCAL target is rejected (400) — use block/mute instead", async () => {
  const db = await freshDb();
  const res = await report(db, fakeActor("owner"), {
    target_actor_ap_id: `${APP_URL}/ap/users/someone`,
  });
  expect(res.status).toBe(400);
  expect((await db.select().from(activities).all()).length).toBe(0);
});

test("a missing target is rejected (400)", async () => {
  const db = await freshDb();
  const res = await report(db, fakeActor("owner"), { reason: "x" });
  expect(res.status).toBe(400);
});
