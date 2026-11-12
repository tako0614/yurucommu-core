import { expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  accountDeletions,
  accountDeletionTargets,
  activities,
  actors,
  actorWriteAssertions,
  callSessions,
  legacyCallSessions,
  type Database,
} from "../../../db/index.ts";
import {
  getCallSession,
  listCallSessions,
  upsertCallSession,
} from "../../lib/rtc/call-store.ts";
import type { CallRecord } from "../../runtime/call-hub-core.ts";
import { isAccountDeletionWriteConflict } from "../../lib/errors.ts";
import { teardownActor } from "../../routes/account-teardown.ts";
import { deleteLocalAccount } from "../../routes/account-deletion-lifecycle.ts";
import type { Env } from "../../types.ts";
import { createTestDb, readMigration } from "../helpers/d1-semantics.ts";

const FIRST = "https://local.test/ap/users/first";
const SECOND = "https://local.test/ap/users/second";
const PEER = "https://peer.example/users/contact";

const MIGRATION = "0041_call_sessions_actor_scope.sql";

async function fixture(opts?: Parameters<typeof createTestDb>[0]) {
  const f = await createTestDb(opts);
  try {
    for (const [index, id] of [FIRST, SECOND].entries())
      await f.db.insert(actors).values({
        apId: id,
        type: "Person",
        preferredUsername: `fixture${index}`,
        inbox: `${id}/inbox`,
        outbox: `${id}/outbox`,
        followersUrl: `${id}/followers`,
        followingUrl: `${id}/following`,
        publicKeyPem: "unused-local-fixture",
        privateKeyPem: "unused-local-fixture",
      });
    return f;
  } catch (error) {
    f.client.close();
    throw error;
  }
}

function call(state: CallRecord["state"] = "ringing"): CallRecord {
  const now = Date.now();
  return {
    callId: "same-harmless-local-id",
    peerApId: PEER,
    direction: "incoming",
    state,
    media: { audio: true, video: false },
    sfuFocus: null,
    createdAt: now,
    updatedAt: now,
    ...(state === "connected" ? { connectedAt: now } : {}),
  };
}

test("two local owners retain independent histories for the same call ID", async () => {
  const { db, client } = await fixture();
  try {
    const first = call();
    await upsertCallSession(db, FIRST, first);
    const retained = await getCallSession(db, FIRST, first.callId);
    const second = {
      ...call("connected"),
      peerApId: "https://another.example/users/contact",
      direction: "outgoing" as const,
      media: { audio: true, video: true },
    };
    await upsertCallSession(db, SECOND, second);
    expect({
      first: await getCallSession(db, FIRST, first.callId),
      second: await getCallSession(db, SECOND, second.callId),
    }).toEqual({
      first: retained,
      second: {
        id: second.callId,
        peer: second.peerApId,
        direction: second.direction,
        state: second.state,
        media: second.media,
        createdAt: expect.any(String),
        connectedAt: new Date(second.connectedAt!).toISOString(),
        endedAt: null,
        endReason: null,
      },
    });
    expect(await listCallSessions(db, FIRST)).toHaveLength(1);
    expect(await listCallSessions(db, SECOND)).toHaveLength(1);
    await upsertCallSession(db, FIRST, { ...first, state: "ended" });
    expect((await getCallSession(db, FIRST, first.callId))?.state).toBe(
      "ended",
    );
    expect((await getCallSession(db, SECOND, second.callId))?.state).toBe(
      "connected",
    );
  } finally {
    client.close();
  }
});

async function seedLegacy(db: Database, owner = FIRST, id = "legacy-call") {
  await db.insert(legacyCallSessions).values({
    id,
    localActorApId: owner,
    peerActorApId: PEER,
    direction: "incoming",
    state: "connected",
    mediaAudio: 0,
    mediaVideo: 1,
    sfuFocus: null,
    peerSignalEndpoint: "https://peer.example/ap/rtc/signal",
    endReason: "retained-local-note",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-02T00:00:00.000Z",
    connectedAt: "2020-01-01T00:00:30.000Z",
    endedAt: null,
  });
}

test("0041 preserves applied history, guards and FK; reads do not backfill", async () => {
  const { db, client } = await fixture({
    through: "0040_delivery_endpoint_recovery.sql",
  });
  try {
    await seedLegacy(db);
    const before = await db.select().from(legacyCallSessions);
    const fingerprint = () =>
      client.execute(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name='call_sessions' ORDER BY type,name",
      );
    const schema = (await fingerprint()).rows;
    await client.executeMultiple(await readMigration(MIGRATION));
    await client.executeMultiple(await readMigration(MIGRATION));
    expect((await fingerprint()).rows).toEqual(schema);
    expect(await db.select().from(legacyCallSessions)).toEqual(before);
    expect((await getCallSession(db, FIRST, "legacy-call"))?.state).toBe(
      "connected",
    );
    expect(await listCallSessions(db, FIRST)).toHaveLength(1);
    expect(await db.select().from(callSessions)).toHaveLength(0);
    expect(await db.select().from(legacyCallSessions)).toEqual(before);
    expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  } finally {
    client.close();
  }
});

test("a legacy successor preserves own identity metadata and never edits the old row", async () => {
  const { db, client } = await fixture();
  try {
    await seedLegacy(db);
    const before = await db.select().from(legacyCallSessions);
    const transition = { ...call("ended"), callId: "legacy-call" };
    await upsertCallSession(db, FIRST, transition);
    expect(await db.select().from(legacyCallSessions)).toEqual(before);
    const summary = await getCallSession(db, FIRST, "legacy-call");
    expect(summary).toMatchObject({
      id: "legacy-call",
      peer: PEER,
      direction: "incoming",
      media: { audio: false, video: true },
      createdAt: before[0].createdAt,
      endReason: before[0].endReason,
      state: "ended",
    });
    expect(summary?.endedAt).not.toBeNull();
    expect(await listCallSessions(db, FIRST)).toHaveLength(1);
    await upsertCallSession(db, SECOND, {
      ...transition,
      state: "ringing",
      peerApId: "https://other.example/users/contact",
    });
    expect((await getCallSession(db, SECOND, "legacy-call"))?.peer).toBe(
      "https://other.example/users/contact",
    );
    expect((await getCallSession(db, FIRST, "legacy-call"))?.state).toBe(
      "ended",
    );
    expect(await db.select().from(callSessions)).toHaveLength(2);
    expect(await db.select().from(legacyCallSessions)).toEqual(before);
  } finally {
    client.close();
  }
});

test("mixed history lists remain owner-bound, ordered and limited without duplicates", async () => {
  const { db, client } = await fixture();
  try {
    await seedLegacy(db, FIRST, "legacy-only");
    await seedLegacy(db, FIRST, "has-successor");
    await upsertCallSession(db, FIRST, {
      ...call("ended"),
      callId: "has-successor",
    });
    await upsertCallSession(db, FIRST, { ...call(), callId: "newest" });
    await upsertCallSession(db, SECOND, { ...call(), callId: "foreign" });
    const list = await listCallSessions(db, FIRST);
    expect(list).toHaveLength(3);
    expect(list[0].id).toBe("newest");
    expect(list.filter((row) => row.id === "has-successor")).toHaveLength(1);
    expect(list.some((row) => row.id === "foreign")).toBe(false);
    expect(await listCallSessions(db, FIRST, 1)).toEqual([list[0]]);
    expect(await listCallSessions(db, FIRST, 0)).toEqual([list[0]]);
    expect(await getCallSession(db, SECOND, "legacy-only")).toBeNull();
  } finally {
    client.close();
  }
});

test("a missing local owner still fails its FK instead of acknowledging an empty insert", async () => {
  const { db, client } = await fixture();
  try {
    await expect(
      upsertCallSession(db, "https://local.test/ap/users/absent", call()),
    ).rejects.toThrow();
    expect(await db.select().from(callSessions)).toHaveLength(0);
    expect(await db.select().from(legacyCallSessions)).toHaveLength(0);
  } finally {
    client.close();
  }
});

async function reserveFirst(db: Database) {
  await db.insert(accountDeletions).values({
    id: "local-deletion-fixture",
    rootActorApId: FIRST,
    rootPublicKeyPem: "unused-local-fixture",
    workerToken: "unused-local-fixture",
    leaseExpiresAt: "2000-01-01T00:00:00.000Z",
  });
  await db.insert(accountDeletionTargets).values({
    actorApId: FIRST,
    operationId: "local-deletion-fixture",
    publicKeyPem: "unused-local-fixture",
    followersUrl: `${FIRST}/followers`,
    deleteActivityApId: "https://local.test/ap/activities/local-deletion",
  });
}

async function expectDeletionConflict(pending: Promise<unknown>) {
  let caught: unknown;
  try {
    await pending;
  } catch (error) {
    caught = error;
  }
  expect(isAccountDeletionWriteConflict(caught)).toBe(true);
}

for (const mode of ["owner", "peer"] as const) {
  test(`a retained ${mode} deletion reservation fences both history tables`, async () => {
    const { db, client } = await fixture();
    try {
      const owner = mode === "owner" ? FIRST : SECOND;
      const record = { ...call(), peerApId: mode === "peer" ? FIRST : PEER };
      await upsertCallSession(db, owner, record);
      await seedLegacy(db, owner);
      if (mode === "peer")
        await db.update(legacyCallSessions).set({ peerActorApId: FIRST });
      const scoped = await db.select().from(callSessions);
      const legacy = await db.select().from(legacyCallSessions);
      await reserveFirst(db);
      await expectDeletionConflict(upsertCallSession(db, owner, record));
      await expectDeletionConflict(
        upsertCallSession(db, owner, { ...record, callId: "new-reserved" }),
      );
      for (const history of [callSessions, legacyCallSessions]) {
        await expectDeletionConflict(
          db.update(history).set({ state: "ended" }).then(),
        );
        await expectDeletionConflict(db.delete(history).then());
      }
      expect(await db.select().from(callSessions)).toEqual(scoped);
      expect(await db.select().from(legacyCallSessions)).toEqual(legacy);
    } finally {
      client.close();
    }
  });
}

test("account teardown removes owner and peer histories in both tables and keeps unrelated rows", async () => {
  const { db, client } = await fixture();
  try {
    await upsertCallSession(db, FIRST, call());
    await upsertCallSession(db, SECOND, {
      ...call(),
      callId: "other-owner-to-first",
      peerApId: FIRST,
    });
    await upsertCallSession(db, SECOND, {
      ...call(),
      callId: "unrelated",
    });
    await seedLegacy(db, FIRST);
    await seedLegacy(db, SECOND, "old-peer-first");
    await db
      .update(legacyCallSessions)
      .set({ peerActorApId: FIRST })
      .where(eq(legacyCallSessions.id, "old-peer-first"));
    await seedLegacy(db, SECOND, "old-unrelated");
    const env = { APP_URL: "https://local.test", DB_INSTANCE: db } as Env;
    await teardownActor(db, env, env.APP_URL, FIRST, `${FIRST}/followers`);
    expect((await db.select().from(callSessions)).map((row) => row.id)).toEqual(
      ["unrelated"],
    );
    expect(
      (await db.select().from(legacyCallSessions)).map((row) => row.id),
    ).toEqual(["old-unrelated"]);
    expect(
      (await db.select().from(actors).where(eq(actors.apId, FIRST)))[0]
        .deletedAt,
    ).not.toBeNull();
  } finally {
    client.close();
  }
});

test("a history cleanup failure keeps the actor live and retries the same Delete intent", async () => {
  const { db, client } = await fixture();
  try {
    await upsertCallSession(db, FIRST, call());
    await seedLegacy(db);
    await client.executeMultiple(`CREATE TRIGGER local_history_cleanup_fault
      BEFORE DELETE ON call_sessions BEGIN SELECT RAISE(ABORT,'local fixture'); END;`);
    const env = { APP_URL: "https://local.test", DB_INSTANCE: db } as Env;
    await expect(
      teardownActor(db, env, env.APP_URL, FIRST, `${FIRST}/followers`),
    ).rejects.toThrow();
    expect(
      (await db.select().from(actors).where(eq(actors.apId, FIRST)))[0]
        .deletedAt,
    ).toBeNull();
    expect(await db.select().from(callSessions)).toHaveLength(0);
    expect(await db.select().from(legacyCallSessions)).toHaveLength(1);
    const intent = await db
      .select({ id: activities.apId })
      .from(activities)
      .where(
        and(eq(activities.actorApId, FIRST), eq(activities.type, "Delete")),
      );
    expect(intent).toHaveLength(1);
    await client.execute("DROP TRIGGER local_history_cleanup_fault");
    await teardownActor(db, env, env.APP_URL, FIRST, `${FIRST}/followers`);
    expect(await db.select().from(callSessions)).toHaveLength(0);
    expect(await db.select().from(legacyCallSessions)).toHaveLength(0);
    expect(
      await db
        .select({ id: activities.apId })
        .from(activities)
        .where(
          and(eq(activities.actorApId, FIRST), eq(activities.type, "Delete")),
        ),
    ).toEqual(intent);
  } finally {
    client.close();
  }
});

test("the actual deletion worker authorizes both history guards and clears its markers", async () => {
  const { db, client } = await fixture();
  try {
    await seedLegacy(db);
    await upsertCallSession(db, FIRST, call());
    await upsertCallSession(db, SECOND, {
      ...call(),
      callId: "other-owner-to-first",
      peerApId: FIRST,
    });
    const env = { APP_URL: "https://local.test", DB_INSTANCE: db } as Env;
    const options = {
      cascadeOwnedAccounts: false,
      expectedPublicKeyPem: "unused-local-fixture",
      expectedTakosUserId: null,
      expectedOwnerActorApId: null,
    };
    expect(
      await deleteLocalAccount(db, env, FIRST, {
        ...options,
        expectedPublicKeyPem: "a-different-local-fixture",
      }),
    ).toBe("busy");
    expect(await db.select().from(callSessions)).toHaveLength(2);
    expect(await db.select().from(legacyCallSessions)).toHaveLength(1);
    expect(await deleteLocalAccount(db, env, FIRST, options)).toBe("deleted");
    expect(await db.select().from(callSessions)).toHaveLength(0);
    expect(await db.select().from(legacyCallSessions)).toHaveLength(0);
    expect(await db.select().from(actorWriteAssertions)).toHaveLength(0);
    expect(await db.select().from(accountDeletionTargets)).toHaveLength(0);
    expect(await db.select().from(accountDeletions)).toHaveLength(0);
  } finally {
    client.close();
  }
});

test("an interrupted additive migration can finish without rewriting legacy history", async () => {
  const { db, client } = await fixture({
    through: "0040_delivery_endpoint_recovery.sql",
  });
  try {
    await seedLegacy(db);
    const before = await db.select().from(legacyCallSessions);
    const migration = await readMigration(MIGRATION);
    await client.executeMultiple(
      migration.slice(0, migration.indexOf(";") + 1),
    );
    expect(
      (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='actor_call_sessions'",
        )
      ).rows,
    ).toEqual([]);
    expect(await db.select().from(legacyCallSessions)).toEqual(before);
    await client.executeMultiple(migration);
    expect(
      (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='actor_call_sessions'",
        )
      ).rows,
    ).toHaveLength(3);
    expect(await db.select().from(legacyCallSessions)).toEqual(before);
    await upsertCallSession(db, SECOND, { ...call(), callId: "legacy-call" });
    expect((await getCallSession(db, FIRST, "legacy-call"))?.state).toBe(
      "connected",
    );
    expect((await getCallSession(db, SECOND, "legacy-call"))?.state).toBe(
      "ringing",
    );
  } finally {
    client.close();
  }
});

test("missing 0041 fails closed without falling back to unsafe global-ID writes", async () => {
  const { db, client } = await fixture({
    through: "0040_delivery_endpoint_recovery.sql",
  });
  try {
    await seedLegacy(db);
    const before = await db.select().from(legacyCallSessions);
    await expect(listCallSessions(db, FIRST)).rejects.toThrow();
    await expect(getCallSession(db, FIRST, "legacy-call")).rejects.toThrow();
    await expect(
      upsertCallSession(db, SECOND, { ...call(), callId: "legacy-call" }),
    ).rejects.toThrow();
    expect(await db.select().from(legacyCallSessions)).toEqual(before);
  } finally {
    client.close();
  }
});

test("same-owner retries update one row and keep other-owner reads empty", async () => {
  const { db, client } = await fixture();
  try {
    const first = call();
    await upsertCallSession(db, FIRST, first);
    await upsertCallSession(db, FIRST, { ...first, state: "connecting" });
    expect(await listCallSessions(db, FIRST)).toHaveLength(1);
    expect((await getCallSession(db, FIRST, first.callId))?.state).toBe(
      "connecting",
    );
    expect(await listCallSessions(db, SECOND)).toHaveLength(0);
    expect(await getCallSession(db, SECOND, first.callId)).toBeNull();
  } finally {
    client.close();
  }
});
