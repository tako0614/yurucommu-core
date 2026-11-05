import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import {
  type Database,
  type D1Statement,
  activities,
  actorCache,
  actors,
  inboundActivityClaims,
  inbox,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import { generateKeyPair, signRequest } from "../../federation-helpers.ts";
import inboxRoutes from "../../routes/activitypub/inbox.ts";
import postsRoutes from "../../routes/posts/routes.ts";
import type { Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const HOST = "https://yuru.test";
const RECIPIENT = `${HOST}/ap/users/bob`;
const AUTHOR = "https://remote.example/users/alice";
const OTHER_AUTHOR = "https://remote.example/users/mallory";
const OTHER_RECIPIENT = `${HOST}/ap/users/carol`;
const OBJECT = "https://remote.example/objects/owned-dm";
const keyPair = generateKeyPair();
const otherKeyPair = generateKeyPair();

type BatchableDatabase = Database & {
  batch(
    statements: readonly [D1Statement, ...D1Statement[]],
  ): Promise<unknown[]>;
};

async function fixture() {
  const f = await createTestDb();
  const keys = await keyPair;
  await f.db.insert(actors).values({
    apId: RECIPIENT,
    preferredUsername: "bob",
    inbox: `${RECIPIENT}/inbox`,
    outbox: `${RECIPIENT}/outbox`,
    followersUrl: `${RECIPIENT}/followers`,
    followingUrl: `${RECIPIENT}/following`,
    publicKeyPem: "local-unused",
    privateKeyPem: "local-unused",
  });
  await f.db.insert(actorCache).values({
    apId: AUTHOR,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${AUTHOR}/inbox`,
    publicKeyId: `${AUTHOR}#main-key`,
    publicKeyPem: keys.publicKeyPem,
    rawJson: JSON.stringify({ id: AUTHOR, type: "Person" }),
    lastFetchedAt: new Date().toISOString(),
  });
  const otherKeys = await otherKeyPair;
  await f.db.insert(actors).values({
    apId: OTHER_RECIPIENT,
    preferredUsername: "carol",
    inbox: `${OTHER_RECIPIENT}/inbox`,
    outbox: `${OTHER_RECIPIENT}/outbox`,
    followersUrl: `${OTHER_RECIPIENT}/followers`,
    followingUrl: `${OTHER_RECIPIENT}/following`,
    publicKeyPem: "local-unused",
    privateKeyPem: "local-unused",
  });
  await f.db.insert(actorCache).values({
    apId: OTHER_AUTHOR,
    type: "Person",
    preferredUsername: "mallory",
    inbox: `${OTHER_AUTHOR}/inbox`,
    publicKeyId: `${OTHER_AUTHOR}#main-key`,
    publicKeyPem: otherKeys.publicKeyPem,
    rawJson: JSON.stringify({ id: OTHER_AUTHOR, type: "Person" }),
    lastFetchedAt: new Date().toISOString(),
  });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", f.db);
    await next();
  });
  app.route("/", inboxRoutes);
  let serial = 0;
  async function deliver(
    type: "Create" | "Update" | "Delete",
    author = AUTHOR,
    recipient = RECIPIENT,
    options: { generic?: boolean; status?: number; wireId?: string } = {},
  ) {
    const to = options.generic
      ? ["https://www.w3.org/ns/activitystreams#Public"]
      : [recipient];
    const body = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${author}/activities/${options.wireId ?? `${type}-${++serial}`}`,
      type,
      actor: author,
      to,
      object:
        type === "Delete"
          ? { id: OBJECT, type: "Tombstone", formerType: "Note" }
          : {
              id: OBJECT,
              type: "Note",
              attributedTo: author,
              content:
                author !== AUTHOR
                  ? "Mallory candidate"
                  : type === "Create"
                    ? "Alice private source"
                    : "Edited",
              to,
              cc: [],
              ...(options.generic ? { bcc: [recipient] } : {}),
              published: "2026-11-05T00:00:00.000Z",
              ...(type === "Update"
                ? { updated: "2026-11-05T00:01:00.000Z" }
                : {}),
            },
    });
    const url = `${recipient}/inbox`;
    const signer = author === AUTHOR ? keys : otherKeys;
    const headers = await signRequest(
      signer.privateKeyPem,
      `${author}#main-key`,
      "POST",
      url,
      body,
    );
    const response = await app.fetch(
      new Request(url, {
        method: "POST",
        headers: { ...headers, "content-type": "application/activity+json" },
        body,
      }),
      { APP_URL: HOST } as Env,
    );
    expect(response.status).toBe(options.status ?? 202);
  }
  return { ...f, deliver };
}

for (const generic of [false, true])
  test(`another signed author cannot grant ${generic ? "hidden generic" : "direct"} access to a retained private Note`, async () => {
    const f = await fixture();
    try {
      await f.deliver("Create");
      await f.deliver("Create", OTHER_AUTHOR, OTHER_RECIPIENT, { generic });
      const retained = await f.db
        .select()
        .from(objects)
        .where(eq(objects.apId, OBJECT))
        .get();
      expect(retained?.attributedTo).toBe(AUTHOR);
      expect(retained?.content).toBe("Alice private source");
      const app = new Hono<{ Bindings: Env; Variables: Variables }>();
      app.use("*", async (c, next) => {
        c.set("db", f.db);
        c.set("actor", {
          ap_id: OTHER_RECIPIENT,
          preferred_username: "carol",
        } as never);
        await next();
      });
      app.route("/api/posts", postsRoutes);
      const response = await app.fetch(
        new Request(`${HOST}/api/posts/${encodeURIComponent(OBJECT)}`),
        { APP_URL: HOST } as Env,
      );
      const body = (await response.json()) as { post?: { content: string } };
      expect(body.post?.content).not.toBe("Alice private source");
      expect(response.status).toBe(404);
      expect(
        (
          await f.db
            .select()
            .from(objectRecipients)
            .where(eq(objectRecipients.objectApId, OBJECT))
        ).map((r) => r.recipientApId),
      ).toEqual([RECIPIENT]);
      const row = await f.db
        .select()
        .from(objects)
        .where(eq(objects.apId, OBJECT))
        .get();
      expect(row?.attributedTo).toBe(AUTHOR);
      expect(row?.content).toBe("Alice private source");
    } finally {
      f.client.close();
    }
  });

test("a same-author redelivery repairs missing recipient projection and preserves the source body", async () => {
  const f = await fixture();
  try {
    await f.deliver("Create");
    await f.db
      .delete(objectRecipients)
      .where(eq(objectRecipients.objectApId, OBJECT));
    await f.deliver("Create");
    expect(
      (await f.db.select().from(objectRecipients)).map((r) => r.recipientApId),
    ).toEqual([RECIPIENT]);
    expect(
      (await f.db.select().from(objects).where(eq(objects.apId, OBJECT)).get())
        ?.content,
    ).toBe("Alice private source");
  } finally {
    f.client.close();
  }
});

test("the same verified author can repair a historical cosmetic actor spelling without replacing its retained identity", async () => {
  const f = await fixture();
  const historical = "https://REMOTE.example:443/users/alice/";
  try {
    await f.deliver("Create");
    await f.db
      .update(objects)
      .set({ attributedTo: historical })
      .where(eq(objects.apId, OBJECT));
    await f.db
      .delete(objectRecipients)
      .where(eq(objectRecipients.objectApId, OBJECT));
    await f.deliver("Create");
    expect(
      (await f.db.select().from(objects).where(eq(objects.apId, OBJECT)).get())
        ?.attributedTo,
    ).toBe(historical);
    expect(
      (await f.db.select().from(objectRecipients)).map((r) => r.recipientApId),
    ).toEqual([RECIPIENT]);
  } finally {
    f.client.close();
  }
});

test("the first atomic Create winner keeps its author and recipients when another valid Create arrives at the batch boundary", async () => {
  const f = await fixture();
  const db = f.db as BatchableDatabase;
  const batch = db.batch.bind(db);
  let inject = true;
  db.batch = async (statements) => {
    if (inject) {
      inject = false;
      await f.deliver("Create", OTHER_AUTHOR, OTHER_RECIPIENT);
    }
    return batch(statements);
  };
  try {
    await f.deliver("Create");
    const row = await f.db
      .select()
      .from(objects)
      .where(eq(objects.apId, OBJECT))
      .get();
    expect(inject).toBe(false);
    expect(row?.attributedTo).toBe(OTHER_AUTHOR);
    expect(row?.content).toBe("Mallory candidate");
    expect(
      (await f.db.select().from(objectRecipients)).map((r) => r.recipientApId),
    ).toEqual([OTHER_RECIPIENT]);
    expect(
      (await f.db.select().from(activities)).every((r) => r.processed === 1),
    ).toBe(true);
  } finally {
    db.batch = batch;
    f.client.close();
  }
});

test("a Note removed after its object batch cannot acquire a later ghost notification", async () => {
  const f = await fixture();
  const db = f.db as BatchableDatabase;
  const batch = db.batch.bind(db);
  let batches = 0;
  db.batch = async (statements) => {
    if (++batches === 2) {
      await db
        .delete(objectRecipients)
        .where(eq(objectRecipients.objectApId, OBJECT));
      await db.delete(objects).where(eq(objects.apId, OBJECT));
    }
    return batch(statements);
  };
  try {
    await f.deliver("Create");
    expect(batches).toBeGreaterThanOrEqual(2);
    expect(await f.db.select().from(objects)).toHaveLength(0);
    expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
    expect(await f.db.select().from(inbox)).toHaveLength(0);
    expect(
      (await f.db.select().from(activities)).map((r) => r.processed),
    ).toEqual([1]);
  } finally {
    db.batch = batch;
    f.client.close();
  }
});

for (const conflicting of [
  { type: "Story" },
  { isLocal: 1 },
  { deletedAt: "2026-11-05T00:01:00Z" },
  { attributedTo: "https://remote.example/users/Alice" },
  { attributedTo: "https://remote.example/users/alice?other=1" },
]) {
  test(`Create cannot repair projections for a conflicting retained identity ${JSON.stringify(conflicting)}`, async () => {
    const f = await fixture();
    try {
      await f.deliver("Create");
      await f.db
        .update(objects)
        .set(conflicting)
        .where(eq(objects.apId, OBJECT));
      const before = await f.db.select().from(objects);
      await f.deliver("Create", AUTHOR, OTHER_RECIPIENT);
      expect(await f.db.select().from(objects)).toEqual(before);
      expect(
        (await f.db.select().from(objectRecipients)).map(
          (r) => r.recipientApId,
        ),
      ).toEqual([RECIPIENT]);
    } finally {
      f.client.close();
    }
  });
}

test("a non-admission database failure rolls back and remains retryable instead of being silently accepted", async () => {
  const f = await fixture();
  try {
    await f.client.execute(
      "CREATE TRIGGER reject_recipient BEFORE INSERT ON object_recipients BEGIN SELECT RAISE(ABORT,'synthetic recipient failure'); END",
    );
    await f.deliver("Create", AUTHOR, RECIPIENT, {
      status: 503,
      wireId: "retry",
    });
    expect(await f.db.select().from(objects)).toHaveLength(0);
    expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
    expect(
      (await f.db.select().from(activities)).map((r) => r.processed),
    ).toEqual([0]);
    await f.client.execute("DROP TRIGGER reject_recipient");
    await f.deliver("Create", AUTHOR, RECIPIENT, { wireId: "retry" });
    expect(await f.db.select().from(objects)).toHaveLength(1);
    expect(
      (await f.db.select().from(activities)).map((r) => r.processed),
    ).toEqual([1]);
    expect(
      (await f.db.select().from(inboundActivityClaims)).map(
        (r) => r.processingToken,
      ),
    ).toEqual([null]);
  } finally {
    f.client.close();
  }
});
