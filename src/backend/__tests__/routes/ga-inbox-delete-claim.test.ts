import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  type D1Statement,
  activities,
  actorCache,
  actors,
  communities,
  inboundActivityClaims,
  inboundObjectDeletions,
  inbox,
  objectRecipients,
  objects,
  runBatch,
} from "../../../db/index.ts";
import { activityDeleteCascadeStatements } from "../../lib/activity-delete-cascade.ts";
import { generateKeyPair, signRequest } from "../../federation-helpers.ts";
import inboxRoutes from "../../routes/activitypub/inbox.ts";
import { deleteObjectCascade } from "../../routes/posts/delete-cascade.ts";
import type { Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const HOST = "https://yuru.test";
const LOCAL = `${HOST}/ap/users/bob`;
const AUTHOR = "https://remote.example/users/alice";
const OTHER = "https://remote.example/users/mallory";
const OBJECT = "https://remote.example/objects/received-note";
const keyPair = generateKeyPair();
const otherKeyPair = generateKeyPair();

async function fixture() {
  const f = await createTestDb();
  const dbErrors: unknown[] = [];
  const batch = f.client.batch.bind(f.client);
  f.client.batch = async (...args: Parameters<typeof batch>) => {
    try {
      return await batch(...args);
    } catch (error) {
      dbErrors.push(error);
      throw error;
    }
  };
  const keys = await keyPair,
    otherKeys = await otherKeyPair;
  await f.db.insert(actors).values({
    apId: LOCAL,
    preferredUsername: "bob",
    inbox: `${LOCAL}/inbox`,
    outbox: `${LOCAL}/outbox`,
    followersUrl: `${LOCAL}/followers`,
    followingUrl: `${LOCAL}/following`,
    publicKeyPem: "unused-local-key",
    privateKeyPem: "unused-local-key",
  });
  for (const [actor, pair] of [
    [AUTHOR, keys],
    [OTHER, otherKeys],
  ] as const) {
    await f.db.insert(actorCache).values({
      apId: actor,
      type: "Person",
      preferredUsername: actor.split("/").at(-1),
      inbox: `${actor}/inbox`,
      publicKeyId: `${actor}#main-key`,
      publicKeyPem: pair.publicKeyPem,
      rawJson: JSON.stringify({ id: actor, type: "Person" }),
      lastFetchedAt: new Date().toISOString(),
    });
  }
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", f.db);
    await next();
  });
  app.route("/", inboxRoutes);
  async function request(
    type: "Create" | "Update" | "Delete",
    shared = false,
    actor = AUTHOR,
    wireId: string = type,
    content = type === "Update"
      ? "Updated while Delete waits"
      : "Message before deletion",
    addresses = [LOCAL],
    group = false,
    objectId = OBJECT,
  ) {
    const body = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${actor}/activities/${wireId}`,
      type,
      actor,
      to: addresses,
      object:
        type === "Delete"
          ? { id: objectId, type: "Tombstone", formerType: "Note" }
          : {
              id: objectId,
              type: "Note",
              attributedTo: actor,
              content,
              ...(group ? { room: `${HOST}/ap/rooms/terminal-room` } : {}),
              to: addresses,
              cc: [],
              published: "2026-11-05T00:00:00.000Z",
            },
    });
    const url = group
      ? `${HOST}/ap/actor/inbox`
      : shared
        ? `${HOST}/ap/inbox`
        : `${LOCAL}/inbox`;
    const signingActor = actor === OTHER ? OTHER : AUTHOR;
    const pair = signingActor === AUTHOR ? keys : otherKeys;
    const headers = await signRequest(
      pair.privateKeyPem,
      `${signingActor}#main-key`,
      "POST",
      url,
      body,
    );
    return app.fetch(
      new Request(url, {
        method: "POST",
        headers: { ...headers, "content-type": "application/activity+json" },
        body,
      }),
      { APP_URL: HOST } as Env,
    );
  }
  async function deletion(actor = AUTHOR) {
    return (await f.db.select().from(activities)).find(
      (row) => row.type === "Delete" && row.actorApId === actor,
    )!;
  }
  return { ...f, request, deletion, dbErrors };
}

for (const replacementActor of [OTHER]) {
  test(`a stale signed Delete cannot remove the ${replacementActor === AUTHOR ? "same author changed-content" : "other author"} replacement or its projections`, async () => {
    const f = await fixture();
    const db = f.db as typeof f.db & {
      batch(
        statements: readonly [D1Statement, ...D1Statement[]],
      ): Promise<unknown[]>;
    };
    const batch = db.batch.bind(db);
    let injected = false;
    let replacement: (typeof objects.$inferSelect)[] = [];
    let recipients: (typeof objectRecipients.$inferSelect)[] = [];
    let notifications: (typeof inbox.$inferSelect)[] = [];
    try {
      expect((await f.request("Create")).status).toBe(202);
      db.batch = async (statements) => {
        const cleanup = statements.some((statement) => {
          const query = (
            statement as unknown as { toSQL?: () => { sql: string } }
          ).toSQL?.();
          return query?.sql.startsWith('delete from "object_recipients"');
        });
        if (!injected && cleanup) {
          injected = true;
          expect(
            (await f.request("Delete", false, AUTHOR, "second-delete")).status,
          ).toBe(202);
          expect(
            (
              await f.request(
                "Create",
                false,
                replacementActor,
                "replacement",
                "New incarnation while Delete waits",
              )
            ).status,
          ).toBe(202);
          replacement = await db.select().from(objects);
          recipients = await db.select().from(objectRecipients);
          notifications = await db.select().from(inbox);
          expect((await db.select().from(objects).get())?.attributedTo).toBe(
            replacementActor,
          );
        }
        return batch(statements);
      };
      const response = await f.request("Delete", false, AUTHOR, "first-delete");
      expect(injected).toBe(true);
      expect(replacement).toHaveLength(1);
      expect(await db.select().from(objects)).toEqual(replacement);
      expect(await db.select().from(objectRecipients)).toEqual(recipients);
      expect(await db.select().from(inbox)).toEqual(notifications);
      expect(response.status).toBe(503); // The competing Delete retired this dispatch's claim.
      expect(
        (await f.request("Delete", false, AUTHOR, "first-delete")).status,
      ).toBe(202);
      if (replacementActor === AUTHOR) {
        expect(await db.select().from(objects)).toHaveLength(0);
        expect(await db.select().from(objectRecipients)).toHaveLength(0);
      } else {
        expect(await db.select().from(objects)).toEqual(replacement);
        expect(await db.select().from(objectRecipients)).toEqual(recipients);
      }
    } finally {
      db.batch = batch;
      f.client.close();
    }
  });
}

test("an Update arriving after terminal Delete admission cannot change the cleanup source", async () => {
  const f = await fixture();
  const db = f.db as typeof f.db & {
    batch(
      statements: readonly [D1Statement, ...D1Statement[]],
    ): Promise<unknown[]>;
  };
  const batch = db.batch.bind(db);
  let injected = false;
  const observation: { status: number | null; body: string | null } = {
    status: null,
    body: null,
  };
  try {
    expect((await f.request("Create")).status).toBe(202);
    db.batch = async (statements) => {
      const cleanup = statements.some((statement) =>
        (statement as unknown as { toSQL?: () => { sql: string } })
          .toSQL?.()
          .sql.startsWith('delete from "object_recipients"'),
      );
      if (!injected && cleanup) {
        injected = true;
        // Observations only: the handler under test catches database errors.
        // Assertions inside this callback could be mistaken for an intended503.
        observation.status = (
          await f.request("Update", false, AUTHOR, "interleaved-update")
        ).status;
        observation.body =
          (await db.select().from(objects).get())?.content ?? null;
      }
      return batch(statements);
    };
    const response = await f.request("Delete");
    expect(response.status).toBe(202);
    expect(injected).toBe(true);
    expect(observation.status).toBe(202);
    expect(observation.body).toBe("Message before deletion");
    expect(await db.select().from(objects)).toHaveLength(0);
    expect(await db.select().from(objectRecipients)).toHaveLength(0);
    expect(await db.select().from(inbox)).toHaveLength(0);
    expect((await f.request("Delete")).status).toBe(202);
  } finally {
    db.batch = batch;
    f.client.close();
  }
});

for (const shared of [false, true]) {
  test(`signed ${shared ? "shared" : "user"} inbox Delete acknowledges its first completed effect and releases its own claim`, async () => {
    const f = await fixture();
    try {
      expect((await f.request("Create")).status).toBe(202);
      const response = await f.request("Delete", shared);
      expect(await f.db.select().from(objects)).toHaveLength(0);
      expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
      expect(await f.db.select().from(inbox)).toHaveLength(0);
      expect(response.status).toBe(202);
      const activity = await f.deletion();
      expect(activity.processed).toBe(1);
      const claims = await f.db.select().from(inboundActivityClaims);
      expect(claims.map((row) => row.activityApId)).toEqual([activity.apId]);
      expect(claims[0]?.processingToken).toBeNull();
      expect(claims[0]?.leaseExpiresAt).toBeNull();
      const before = await f.db.select().from(activities);
      expect((await f.request("Delete", shared)).status).toBe(202);
      expect(await f.db.select().from(activities)).toEqual(before);
      expect(
        (await f.db.select().from(inboundActivityClaims)).map(
          (row) => row.processingToken,
        ),
      ).toEqual([null]);
      expect(await f.db.select().from(inbox)).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

test("another correctly signed same-origin actor cannot delete the Note or its projections", async () => {
  const f = await fixture();
  try {
    expect((await f.request("Create")).status).toBe(202);
    const before = {
      objects: await f.db.select().from(objects),
      recipients: await f.db.select().from(objectRecipients),
      inbox: await f.db.select().from(inbox),
    };
    expect((await f.request("Delete", false, OTHER)).status).toBe(202);
    expect(await f.db.select().from(objects)).toEqual(before.objects);
    expect(await f.db.select().from(objectRecipients)).toEqual(
      before.recipients,
    );
    expect(await f.db.select().from(inbox)).toEqual(before.inbox);
    expect((await f.deletion(OTHER)).processed).toBe(1);
  } finally {
    f.client.close();
  }
});

test("default object projection cleanup still removes all selected inbound claims", async () => {
  const f = await fixture();
  try {
    expect((await f.request("Create")).status).toBe(202);
    expect(await f.db.select().from(inboundActivityClaims)).toHaveLength(1);
    await deleteObjectCascade(f.db, OBJECT);
    expect(await f.db.select().from(inboundActivityClaims)).toHaveLength(0);
    expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
    expect(await f.db.select().from(inbox)).toHaveLength(0);
    expect(await f.db.select().from(objects)).toHaveLength(1); // Caller still owns object removal.
    expect(await f.db.select().from(activities)).toHaveLength(1); // Retained ledger.
  } finally {
    f.client.close();
  }
});

test("hard Activity deletion still honors its guard and cannot retain a projection-only claim hint", async () => {
  const f = await fixture();
  try {
    expect((await f.request("Create")).status).toBe(202);
    const [activity] = await f.db.select().from(activities);
    const where = eq(activities.apId, activity!.apId);
    const hint = {
      preserveInboundClaimActivityApId: activity!.apId,
      guard: sql`0`,
    };
    await runBatch(f.db, activityDeleteCascadeStatements(f.db, where, hint));
    expect(await f.db.select().from(activities)).toHaveLength(1);
    expect(await f.db.select().from(inboundActivityClaims)).toHaveLength(1);
    expect(await f.db.select().from(inbox)).toHaveLength(1);
    await runBatch(
      f.db,
      activityDeleteCascadeStatements(f.db, where, { ...hint, guard: sql`1` }),
    );
    expect(await f.db.select().from(activities)).toHaveLength(0);
    expect(await f.db.select().from(inboundActivityClaims)).toHaveLength(0);
    expect(await f.db.select().from(inbox)).toHaveLength(0);
    expect(await f.db.select().from(objects)).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

test("a real final object-delete failure remains retryable without losing the Delete claim", async () => {
  const f = await fixture();
  try {
    expect((await f.request("Create")).status).toBe(202);
    await f.client.execute(
      "CREATE TRIGGER reject_object_delete BEFORE DELETE ON objects BEGIN SELECT RAISE(ABORT,'synthetic final object deletion'); END",
    );
    expect((await f.request("Delete")).status).toBe(503);
    expect(f.dbErrors.map(String).join("\n")).toContain(
      "synthetic final object deletion",
    );
    expect(
      await f.db.select().from(objects).where(eq(objects.apId, OBJECT)),
    ).toHaveLength(1);
    const activity = await f.deletion();
    expect(activity.processed).toBe(0);
    const claim = await f.db
      .select()
      .from(inboundActivityClaims)
      .where(eq(inboundActivityClaims.activityApId, activity.apId))
      .get();
    expect(claim).toBeDefined();
    expect(claim?.processingToken).toBeNull();
    await f.client.execute("DROP TRIGGER reject_object_delete");
    expect((await f.request("Delete")).status).toBe(202); // Same original wire Activity id/body.
    expect((await f.deletion()).processed).toBe(1);
    expect(await f.db.select().from(objects)).toHaveLength(0);
    expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
    expect(await f.db.select().from(inbox)).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

for (const shared of [false, true]) {
  for (const publicNote of [false, true]) {
    const addresses = publicNote
      ? ["https://www.w3.org/ns/activitystreams#Public", LOCAL]
      : [LOCAL];
    test(`terminal signed Delete before ${shared ? "shared" : "user"} ${publicNote ? "public" : "direct"} Create never exposes the late object`, async () => {
      const f = await fixture();
      try {
        expect((await f.request("Delete", shared)).status).toBe(202);
        expect(
          (
            await f.request(
              "Create",
              shared,
              AUTHOR,
              "late-create",
              "Late body",
              addresses,
            )
          ).status,
        ).toBe(202);
        expect(await f.db.select().from(objects)).toHaveLength(0);
        expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
        expect(await f.db.select().from(inbox)).toHaveLength(0);
        expect((await f.request("Delete", shared)).status).toBe(202);
      } finally {
        f.client.close();
      }
    });
    test(`terminal signed Delete survives ledger cleanup and ${shared ? "shared" : "user"} ${publicNote ? "public" : "direct"} Create redelivery`, async () => {
      const f = await fixture();
      try {
        expect(
          (
            await f.request(
              "Create",
              shared,
              AUTHOR,
              "first-create",
              "Original body",
              addresses,
            )
          ).status,
        ).toBe(202);
        expect((await f.request("Delete", shared)).status).toBe(202);
        expect(await f.db.select().from(objects)).toHaveLength(0);
        await f.db.delete(activities);
        expect(
          (
            await f.request(
              "Create",
              shared,
              AUTHOR,
              "new-create-id",
              "Resurrected body",
              addresses,
            )
          ).status,
        ).toBe(202);
        expect(await f.db.select().from(objects)).toHaveLength(0);
        expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
        expect(await f.db.select().from(inbox)).toHaveLength(0);
      } finally {
        f.client.close();
      }
    });
  }
}

test("terminal signed Delete of an unknown target cannot suppress another actor on the same host", async () => {
  const f = await fixture();
  try {
    expect((await f.request("Delete")).status).toBe(202);
    expect(
      (await f.request("Create", false, OTHER, "other-create")).status,
    ).toBe(202);
    const retained = await f.db.select().from(objects);
    expect(retained).toHaveLength(1);
    expect(retained[0].attributedTo).toBe(OTHER);
    expect(
      (await f.request("Delete", false, AUTHOR, "another-delete")).status,
    ).toBe(202);
    expect(await f.db.select().from(objects)).toEqual(retained);
  } finally {
    f.client.close();
  }
});

test("terminal signed Delete between a Create pre-read and actual batch prevents its first exposure", async () => {
  const f = await fixture();
  const db = f.db as typeof f.db & {
    batch(
      statements: readonly [D1Statement, ...D1Statement[]],
    ): Promise<unknown[]>;
  };
  const batch = db.batch.bind(db);
  let injected = false;
  try {
    db.batch = async (statements) => {
      const inserting = statements.some((statement) =>
        (statement as unknown as { toSQL?: () => { sql: string } })
          .toSQL?.()
          .sql.startsWith('insert into "objects"'),
      );
      if (!injected && inserting) {
        injected = true;
        expect((await f.request("Delete")).status).toBe(202);
      }
      return batch(statements);
    };
    expect((await f.request("Create")).status).toBe(202);
    expect(injected).toBe(true);
    expect(await db.select().from(objects)).toHaveLength(0);
    expect(await db.select().from(objectRecipients)).toHaveLength(0);
    expect(await db.select().from(inbox)).toHaveLength(0);
  } finally {
    db.batch = batch;
    f.client.close();
  }
});

test("terminal signed Delete records its intent before an absent-object read can become stale", async () => {
  const f = await fixture();
  const execute = f.client.execute.bind(f.client);
  let injected = false;
  try {
    f.client.execute = async (...args: Parameters<typeof execute>) => {
      const result = await execute(...args);
      const statement: unknown = args[0];
      const query =
        typeof statement === "string"
          ? statement
          : (statement as { sql: string }).sql;
      if (
        !injected &&
        query.startsWith("select ") &&
        query.includes('from "objects"') &&
        query.includes('"attachments_json"') &&
        query.includes('"deleted_at"')
      ) {
        injected = true;
        expect(
          (await f.request("Create", false, AUTHOR, "interleaved-create"))
            .status,
        ).toBe(202);
      }
      return result;
    };
    expect((await f.request("Delete")).status).toBe(202);
    expect(injected).toBe(true);
    expect(await f.db.select().from(objects)).toHaveLength(0);
    expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
    expect(await f.db.select().from(inbox)).toHaveLength(0);
  } finally {
    f.client.execute = execute;
    f.client.close();
  }
});

for (const createFirst of [false, true]) {
  test(`terminal signed Delete in actor inbox fences ${createFirst ? "redelivered" : "late"} group messages without suppressing another actor`, async () => {
    const f = await fixture();
    const room = `${HOST}/ap/groups/terminal-room`;
    try {
      await f.db.insert(communities).values({
        apId: room,
        preferredUsername: "terminal-room",
        name: "Terminal room",
        inbox: `${room}/inbox`,
        outbox: `${room}/outbox`,
        followersUrl: `${room}/followers`,
        createdBy: LOCAL,
        publicKeyPem: "unused-local-key",
        privateKeyPem: "unused-local-key",
        postPolicy: "anyone",
        visibility: "public",
      });
      if (createFirst) {
        expect(
          (
            await f.request(
              "Create",
              false,
              AUTHOR,
              "first-group",
              "Group body",
              [LOCAL],
              true,
            )
          ).status,
        ).toBe(202);
        expect((await f.db.select().from(objects).get())?.visibility).toBe(
          "group",
        );
        expect(await f.db.select().from(objectRecipients)).toHaveLength(1);
      }
      expect(
        (
          await f.request(
            "Delete",
            false,
            AUTHOR,
            "group-delete",
            "",
            [LOCAL],
            true,
          )
        ).status,
      ).toBe(202);
      expect(
        (
          await f.request(
            "Create",
            false,
            AUTHOR,
            "late-group",
            "Late group body",
            [LOCAL],
            true,
          )
        ).status,
      ).toBe(202);
      expect(await f.db.select().from(objects)).toHaveLength(0);
      expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
      expect(
        (
          await f.request(
            "Create",
            false,
            OTHER,
            "other-group",
            "Other member body",
            [LOCAL],
            true,
          )
        ).status,
      ).toBe(202);
      expect((await f.db.select().from(objects).get())?.attributedTo).toBe(
        OTHER,
      );
      expect(
        (await f.db.select().from(objectRecipients).get())?.recipientApId,
      ).toBe(room);
    } finally {
      f.client.close();
    }
  });
}

test("terminal signed Delete uses canonical signer identity but exact object identity", async () => {
  const f = await fixture();
  try {
    const cosmetic = "https://REMOTE.example:443/users/alice/";
    expect((await f.request("Delete", false, cosmetic)).status).toBe(202);
    expect(
      (await f.request("Create", false, AUTHOR, "canonical-create")).status,
    ).toBe(202);
    expect(await f.db.select().from(objects)).toHaveLength(0);
    const distinct = OBJECT + "?revision=1";
    expect(
      (
        await f.request(
          "Create",
          false,
          AUTHOR,
          "distinct-object",
          "New object identity",
          [LOCAL],
          false,
          distinct,
        )
      ).status,
    ).toBe(202);
    expect((await f.db.select().from(objects).get())?.apId).toBe(distinct);
    expect(
      (await f.db.select().from(inboundObjectDeletions).get())?.actorApId,
    ).toBe(AUTHOR);
  } finally {
    f.client.close();
  }
});

test("terminal signed Delete cannot mint local, foreign-origin or unsafe object reservations", async () => {
  const f = await fixture();
  try {
    for (const [index, id] of [
      `${HOST}/ap/objects/local`,
      "https://other.example/objects/foreign",
      "javascript:unsafe",
    ].entries()) {
      expect(
        (
          await f.request(
            "Delete",
            false,
            AUTHOR,
            `invalid-delete-${index}`,
            "",
            [LOCAL],
            false,
            id,
          )
        ).status,
      ).toBe(202);
    }
    expect(await f.db.select().from(inboundObjectDeletions)).toHaveLength(0);
    expect((await f.request("Create")).status).toBe(202);
    expect((await f.db.select().from(objects).get())?.attributedTo).toBe(
      AUTHOR,
    );
  } finally {
    f.client.close();
  }
});
