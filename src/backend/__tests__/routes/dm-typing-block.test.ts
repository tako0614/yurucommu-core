import { expect, setSystemTime, test } from "bun:test";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import {
  accountDeletionTargets,
  actors,
  actorCache,
  blocks,
  blockedActors,
  blockedDomains,
  dmTyping,
  remoteActorTombstones,
} from "../../../db/index.ts";
import { guardActorWrites } from "../../lib/account-deletion-admission.ts";
import typing from "../../routes/dm/typing.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP = "https://local.test";
const ALICE = `${APP}/ap/users/alice`,
  BOB = `${APP}/ap/users/bob`;
const REMOTE = "https://peer.example/users/cached";

function statementSql(statement: unknown): string {
  if (typeof statement === "string") return statement;
  if (Array.isArray(statement)) return String(statement[0]);
  if (statement && typeof statement === "object" && "sql" in statement)
    return String(statement.sql);
  return "";
}

async function fixture() {
  const { db, client } = await createTestDb();
  for (const [apId, name] of [
    [ALICE, "alice"],
    [BOB, "bob"],
  ])
    await db.insert(actors).values({
      apId,
      type: "Person",
      preferredUsername: name,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "unused-local-fixture",
      privateKeyPem: "unused-local-fixture",
    });
  const events: {
    actor: string;
    type: string;
    data: Record<string, unknown>;
  }[] = [];
  // Existing namespace port only: the actual hub serializes and forwards the
  // event to this local capture. No real DO, network, identity or delivery.
  const namespace = {
    idFromName: (actor: string) => actor,
    get: (actor: string) => ({
      async fetch(url: string, init: RequestInit) {
        expect(url).toBe("https://realtime-do/_emit");
        expect(init.method).toBe("POST");
        const body = JSON.parse(String(init.body));
        events.push({ actor, ...body });
        return new Response(null, { status: 204 });
      },
    }),
  };
  const env = {
    APP_URL: APP,
    DB_INSTANCE: db,
    REALTIME_STREAM: namespace,
  } as unknown as Env;
  const appFor = (apId: string | null) => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
      const actor = apId
        ? ({
            ap_id: apId,
            type: "Person",
            public_key_pem: "unused-local-fixture",
            takos_user_id: null,
          } as Actor)
        : null;
      c.set("actor", actor);
      c.set("db", actor ? guardActorWrites(db, actor) : db);
      await next();
    });
    app.route("/", typing);
    app.onError((_error, c) =>
      c.json({ error: "controlled local database fault" }, 500),
    );
    return app;
  };
  const post = (to = BOB, actor: string | null = ALICE) =>
    appFor(actor).fetch(
      new Request(`${APP}/user/${encodeURIComponent(to)}/typing`, {
        method: "POST",
      }),
      env,
    );
  const poll = (from = ALICE, actor: string | null = BOB) =>
    appFor(actor).fetch(
      new Request(`${APP}/user/${encodeURIComponent(from)}/typing`),
      env,
    );
  function hookOnce(
    operation: "insert" | "delete",
    phase: "before" | "after",
    run: () => Promise<void>,
  ) {
    const batch = client.batch.bind(client);
    let injected = false;
    client.batch = (async (statements, ...rest) => {
      const selected =
        !injected &&
        statements.some((statement) => {
          const text = statementSql(statement).toLowerCase();
          return text.includes(
            `${operation} ${operation === "insert" ? "into" : "from"} "dm_typing"`,
          );
        });
      if (selected) {
        injected = true;
        if (phase === "before") await run();
      }
      const result = await batch(statements, ...rest);
      if (selected && phase === "after") await run();
      return result;
    }) as typeof client.batch;
    return () => injected;
  }
  return { db, client, events, post, poll, hookOnce };
}

test("known local typing preserves its row, upsert, event and polling contracts", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 2; i++) expect((await f.post()).status).toBe(200);
    const rows = await f.db.select().from(dmTyping);
    expect(rows).toHaveLength(1);
    expect(f.events).toHaveLength(2);
    expect(f.events[1]).toEqual({
      actor: BOB,
      type: "talk.typing",
      data: {
        other_ap_id: ALICE,
        is_typing: true,
        typed_at: rows[0].lastTypedAt,
      },
    });
    const result = await f.poll();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      is_typing: true,
      last_typed_at: rows[0].lastTypedAt,
    });
  } finally {
    f.client.close();
  }
});

for (const peer of [REMOTE, "https://PEER.example:443/users/cached/#profile"]) {
  test(`known remote recipients remain cache-only identities: ${peer}`, async () => {
    const f = await fixture();
    try {
      await f.db
        .insert(actorCache)
        .values({ apId: peer, inbox: `${REMOTE}/inbox`, rawJson: "{}" });
      expect((await f.post(peer)).status).toBe(200);
      expect(await f.db.select().from(dmTyping)).toHaveLength(1);
      expect(f.events.map((event) => event.actor)).toEqual([peer]);
      expect(await f.db.select().from(actors)).toHaveLength(2);
    } finally {
      f.client.close();
    }
  });
}

for (const blockedId of [
  ALICE,
  "https://LOCAL.test:443/ap/users/alice/#profile",
]) {
  test(`recipient's retained personal block rejects typing: ${blockedId}`, async () => {
    const f = await fixture();
    try {
      await f.db
        .insert(blocks)
        .values({ blockerApId: BOB, blockedApId: blockedId });
      expect((await f.post()).status).toBe(404);
      expect(await f.db.select().from(dmTyping)).toHaveLength(0);
      expect(f.events).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

test("block hides already retained typing, and unblock permits normal operation", async () => {
  const f = await fixture();
  try {
    expect((await f.post()).status).toBe(200);
    const before = await f.db.select().from(dmTyping);
    await f.db.insert(blocks).values({ blockerApId: BOB, blockedApId: ALICE });
    expect(await (await f.poll()).json()).toEqual({
      is_typing: false,
      last_typed_at: null,
    });
    expect(await f.db.select().from(dmTyping)).toEqual(before);
    expect((await f.post()).status).toBe(404);
    expect(f.events).toHaveLength(1);
    await f.db.delete(blocks).where(eq(blocks.blockerApId, BOB));
    expect((await f.post()).status).toBe(200);
    expect(
      ((await (await f.poll()).json()) as { is_typing: boolean }).is_typing,
    ).toBe(true);
  } finally {
    f.client.close();
  }
});

for (const mode of [
  "unknown",
  "deletedLocal",
  "deletedLocalWithCache",
  "deletedLocalAliasCache",
  "reservedLocal",
  "reservedLocalAliasCache",
  "deletedRemote",
  "deletedRemoteAlias",
  "operatorActor",
  "operatorDomain",
] as const) {
  test(`unavailable typing peer has no row or event: ${mode}`, async () => {
    const f = await fixture();
    try {
      let peer = BOB;
      if (mode === "unknown") peer = `${APP}/ap/users/missing`;
      if (mode.startsWith("deletedLocal"))
        await f.db
          .update(actors)
          .set({ deletedAt: "2020-01-01T00:00:00Z" })
          .where(eq(actors.apId, BOB));
      if (mode === "deletedLocalWithCache")
        await f.db
          .insert(actorCache)
          .values({ apId: BOB, inbox: `${BOB}/inbox`, rawJson: "{}" });
      if (mode.startsWith("reservedLocal"))
        await f.db.insert(accountDeletionTargets).values({
          actorApId: BOB,
          operationId: "local-reservation-fixture",
          publicKeyPem: "unused-local-fixture",
          followersUrl: `${BOB}/followers`,
          deleteActivityApId: `${BOB}/delete`,
        });
      if (mode.endsWith("AliasCache")) {
        peer = "https://LOCAL.test:443/ap/users/bob/#profile";
        await f.db
          .insert(actorCache)
          .values({ apId: peer, inbox: `${BOB}/inbox`, rawJson: "{}" });
      }
      if (mode.startsWith("deletedRemote")) {
        peer =
          mode === "deletedRemoteAlias"
            ? "https://PEER.example:443/users/cached/#profile"
            : REMOTE;
        await f.db
          .insert(actorCache)
          .values({ apId: peer, inbox: `${REMOTE}/inbox`, rawJson: "{}" });
        await f.db.insert(remoteActorTombstones).values({
          actorApId: REMOTE,
          deleteActivityApId: `${REMOTE}/delete`,
        });
      }
      if (mode === "operatorActor")
        await f.db.insert(blockedActors).values({ actorApId: BOB });
      if (mode === "operatorDomain")
        await f.db.insert(blockedDomains).values({ domain: "local.test" });
      expect((await f.post(peer)).status).toBe(404);
      expect(await f.db.select().from(dmTyping)).toHaveLength(0);
      expect(f.events).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

for (const change of ["operator", "deleted", "reserved"] as const) {
  test(`polling hides retained typing from a currently ${change} sender`, async () => {
    const f = await fixture();
    try {
      expect((await f.post()).status).toBe(200);
      const before = await f.db.select().from(dmTyping);
      if (change === "operator")
        await f.db.insert(blockedActors).values({ actorApId: ALICE });
      if (change === "deleted") {
        await f.db
          .update(actors)
          .set({ deletedAt: "2020-01-01T00:00:00Z" })
          .where(eq(actors.apId, ALICE));
        await f.db
          .insert(actorCache)
          .values({ apId: ALICE, inbox: `${ALICE}/inbox`, rawJson: "{}" });
      }
      if (change === "reserved")
        await f.db.insert(accountDeletionTargets).values({
          actorApId: ALICE,
          operationId: "local-reservation-fixture",
          publicKeyPem: "unused-local-fixture",
          followersUrl: `${ALICE}/followers`,
          deleteActivityApId: `${ALICE}/delete`,
        });
      expect(await (await f.poll()).json()).toEqual({
        is_typing: false,
        last_typed_at: null,
      });
      expect(await f.db.select().from(dmTyping)).toEqual(before);
    } finally {
      f.client.close();
    }
  });
}

for (const table of ["blocks", "blocked_domains"] as const) {
  test(`unreadable ${table} authority is not an admission`, async () => {
    const f = await fixture();
    try {
      await f.db.run(sql.raw(`DROP TABLE ${table}`));
      expect((await f.post()).status).toBe(500);
      expect(await f.db.select().from(dmTyping)).toHaveLength(0);
      expect(f.events).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

for (const change of ["block", "recipientDeletion"] as const) {
  test(`a ${change} winning before commit rejects the typing upsert atomically`, async () => {
    const f = await fixture();
    try {
      const injected = f.hookOnce("insert", "before", async () => {
        if (change === "block")
          await f.db
            .insert(blocks)
            .values({ blockerApId: BOB, blockedApId: ALICE });
        else
          await f.db
            .update(actors)
            .set({ deletedAt: "2020-01-01T00:00:00Z" })
            .where(eq(actors.apId, BOB));
      });
      expect((await f.post()).status).toBe(404);
      expect(injected()).toBe(true);
      expect(await f.db.select().from(dmTyping)).toHaveLength(0);
      expect(f.events).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

for (const change of ["block", "unreadableAuthority"] as const) {
  test(`a ${change} after commit prevents the optional notification`, async () => {
    const f = await fixture();
    try {
      const injected = f.hookOnce("insert", "after", async () => {
        if (change === "block")
          await f.db
            .insert(blocks)
            .values({ blockerApId: BOB, blockedApId: ALICE });
        else await f.db.run(sql`DROP TABLE blocks`);
      });
      expect((await f.post()).status).toBe(200);
      expect(injected()).toBe(true);
      expect(await f.db.select().from(dmTyping)).toHaveLength(1);
      expect(f.events).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

for (const change of ["operator", "deleted", "reserved"] as const) {
  test(`a ${change} sender after commit cannot emit a typing notification`, async () => {
    const f = await fixture();
    try {
      const injected = f.hookOnce("insert", "after", async () => {
        if (change === "operator")
          await f.db.insert(blockedActors).values({ actorApId: ALICE });
        if (change === "deleted")
          await f.db
            .update(actors)
            .set({ deletedAt: "2020-01-01T00:00:00Z" })
            .where(eq(actors.apId, ALICE));
        if (change === "reserved")
          await f.db.insert(accountDeletionTargets).values({
            actorApId: ALICE,
            operationId: "local-reservation-fixture",
            publicKeyPem: "unused-local-fixture",
            followersUrl: `${ALICE}/followers`,
            deleteActivityApId: `${ALICE}/delete`,
          });
      });
      expect((await f.post()).status).toBe(200);
      expect(injected()).toBe(true);
      const rows = await f.db.select().from(dmTyping);
      expect(rows).toHaveLength(1);
      expect(await (await f.poll()).json()).toEqual({
        is_typing: false,
        last_typed_at: null,
      });
      expect(await f.db.select().from(dmTyping)).toEqual(rows);
      expect(f.events).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

for (const elapsed of [8000, 8001]) {
  test(`a delayed typing notification respects the polling lifetime at ${elapsed}ms`, async () => {
    const f = await fixture();
    const started = Date.now();
    setSystemTime(started);
    try {
      const injected = f.hookOnce("insert", "after", async () => {
        setSystemTime(started + elapsed);
      });
      expect((await f.post()).status).toBe(200);
      expect(injected()).toBe(true);
      const rows = await f.db.select().from(dmTyping);
      expect(rows).toHaveLength(1);
      const active = elapsed <= 8000;
      expect(await (await f.poll()).json()).toEqual({
        is_typing: active,
        last_typed_at: rows[0].lastTypedAt,
      });
      expect(f.events).toHaveLength(active ? 1 : 0);
      expect(await f.db.select().from(dmTyping)).toEqual(rows);
    } finally {
      setSystemTime();
      f.client.close();
    }
  });
}

test("expired polling cleanup cannot delete a newer legitimate typing update", async () => {
  const f = await fixture();
  try {
    expect((await f.post()).status).toBe(200);
    await f.db
      .update(dmTyping)
      .set({ lastTypedAt: "2020-01-01T00:00:00.000Z" });
    const injected = f.hookOnce("delete", "before", async () => {
      expect((await f.post()).status).toBe(200);
    });
    expect(await (await f.poll()).json()).toEqual({
      is_typing: false,
      last_typed_at: null,
    });
    expect(injected()).toBe(true);
    expect(await f.db.select().from(dmTyping)).toHaveLength(1);
    expect(
      ((await (await f.poll()).json()) as { is_typing: boolean }).is_typing,
    ).toBe(true);
  } finally {
    f.client.close();
  }
});

test("unauthenticated typing keeps its existing 401 and zero effects", async () => {
  const f = await fixture();
  try {
    expect((await f.post(BOB, null)).status).toBe(401);
    expect((await f.poll(ALICE, null)).status).toBe(401);
    expect(await f.db.select().from(dmTyping)).toHaveLength(0);
    expect(f.events).toHaveLength(0);
  } finally {
    f.client.close();
  }
});
