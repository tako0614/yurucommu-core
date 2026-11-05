import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  type D1Statement,
  actorCache,
  actors,
  blocks,
  communities,
  communityBans,
  communityMembers,
  follows,
  inboundNoteUpdateEvents,
  inboundNoteUpdateHeads,
  inbox,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import { generateKeyPair, signRequest } from "../../federation-helpers.ts";
import { canViewerReadObjectFull } from "../../lib/post-visibility.ts";
import inboxRoutes from "../../routes/activitypub/inbox.ts";
import {
  canActorPostToInboundCommunity,
  inboundCommunityAdmissionsSql,
  type InboundCommunityAdmission,
} from "../../routes/activitypub/handlers/inbound-community-scope.ts";
import type { Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const HOST = "https://yuru.test";
const BOB = HOST + "/ap/users/bob";
const CAROL = HOST + "/ap/users/carol";
const AUTHOR = "https://remote.example/users/alice";
const OTHER = "https://remote.example/users/mallory";
const OBJECT = "https://remote.example/objects/ordered-note";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const ROOM = HOST + "/ap/groups/ordered-room";
const ROOM_URL = HOST + "/ap/rooms/ordered-room";
const keysPromise = Promise.all([generateKeyPair(), generateKeyPair()]);

async function fixture() {
  const f = await createTestDb();
  const [keys, otherKeys] = await keysPromise;
  for (const apId of [BOB, CAROL]) {
    await f.db.insert(actors).values({
      apId,
      preferredUsername: apId.split("/").at(-1)!,
      inbox: apId + "/inbox",
      outbox: apId + "/outbox",
      followersUrl: apId + "/followers",
      followingUrl: apId + "/following",
      publicKeyPem: "unused-local",
      privateKeyPem: "unused-local",
    });
  }
  for (const [actor, pair] of [
    [AUTHOR, keys],
    [OTHER, otherKeys],
  ] as const) {
    await f.db.insert(actorCache).values({
      apId: actor,
      type: "Person",
      preferredUsername: actor.split("/").at(-1),
      inbox: actor + "/inbox",
      publicKeyId: actor + "#main-key",
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
    patch: Record<string, unknown> = {},
    wireId = type as string,
    actor = AUTHOR,
    endpoint: "user" | "shared" | "group" = "user",
  ) {
    const body = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${actor}/activities/${wireId}`,
      type,
      actor,
      to: [BOB],
      object:
        type === "Delete"
          ? { id: OBJECT, type: "Tombstone", formerType: "Note" }
          : {
              id: OBJECT,
              type: "Note",
              ...(type === "Create"
                ? {
                    content: "Original body",
                    to: [BOB],
                    cc: [],
                    published: "2026-11-05T00:00:00.000Z",
                  }
                : {}),
              ...patch,
            },
    });
    const url =
      endpoint === "group"
        ? HOST + "/ap/actor/inbox"
        : endpoint === "shared"
          ? HOST + "/ap/inbox"
          : BOB + "/inbox";
    const signer = actor === OTHER ? OTHER : AUTHOR,
      pair = signer === AUTHOR ? keys : otherKeys;
    const headers = await signRequest(
      pair.privateKeyPem,
      signer + "#main-key",
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
  async function projection() {
    const row = await f.db
      .select()
      .from(objects)
      .where(eq(objects.apId, OBJECT))
      .get();
    return row
      ? {
          content: row.content,
          summary: row.summary,
          visibility: row.visibility,
          toJson: row.toJson,
          ccJson: row.ccJson,
          audienceJson: row.audienceJson,
          conversation: row.conversation,
          inReplyTo: row.inReplyTo,
          recipients: (await f.db.select().from(objectRecipients))
            .map((x) => ({ actor: x.recipientApId, type: x.type }))
            .sort((a, b) => a.actor.localeCompare(b.actor)),
        }
      : null;
  }
  async function room() {
    await f.db.insert(communities).values({
      apId: ROOM,
      preferredUsername: "ordered-room",
      name: "Ordered room",
      inbox: ROOM + "/inbox",
      outbox: ROOM + "/outbox",
      followersUrl: ROOM + "/followers",
      createdBy: BOB,
      publicKeyPem: "unused-local",
      privateKeyPem: "unused-local",
      postPolicy: "anyone",
      visibility: "public",
    });
  }
  return { ...f, request, projection, room };
}

for (const endpoint of ["user", "shared"] as const) {
  for (const early of [false, true]) {
    test(`signed ${endpoint} ${early ? "Update before Create" : "Create before Update"} retains the accepted edit after same-wire retry`, async () => {
      const f = await fixture();
      try {
        if (early)
          expect(
            (
              await f.request(
                "Update",
                { content: "Edited body" },
                "edit",
                AUTHOR,
                endpoint,
              )
            ).status,
          ).toBe(202);
        expect(
          (await f.request("Create", {}, "create", AUTHOR, endpoint)).status,
        ).toBe(202);
        expect(
          (
            await f.request(
              "Update",
              { content: "Edited body" },
              "edit",
              AUTHOR,
              endpoint,
            )
          ).status,
        ).toBe(202);
        expect((await f.projection())?.content).toBe("Edited body");
      } finally {
        f.client.close();
      }
    });
  }
}

test("several partial Updates before Create preserve every accepted changed field", async () => {
  const f = await fixture();
  try {
    expect(
      (await f.request("Update", { content: "First edit" }, "body-edit"))
        .status,
    ).toBe(202);
    expect(
      (await f.request("Update", { summary: "Second edit" }, "summary-edit"))
        .status,
    ).toBe(202);
    expect((await f.request("Create")).status).toBe(202);
    expect((await f.projection())?.content).toBe("First edit");
    expect((await f.projection())?.summary).toBe("Second edit");
  } finally {
    f.client.close();
  }
});

test("pending private reach is applied before the Create batch first exposes content or old recipients", async () => {
  const f = await fixture();
  const db = f.db as typeof f.db & {
    batch(
      statements: readonly [D1Statement, ...D1Statement[]],
    ): Promise<unknown[]>;
  };
  const batch = db.batch.bind(db);
  const observed: Awaited<ReturnType<typeof f.projection>>[] = [];
  try {
    expect(
      (
        await f.request(
          "Update",
          { content: "Private edited body", to: [CAROL], cc: [] },
          "private-edit",
        )
      ).status,
    ).toBe(202);
    db.batch = async (statements) => {
      const creates = statements.some((statement) =>
        (statement as unknown as { toSQL?: () => { sql: string } })
          .toSQL?.()
          .sql.startsWith('insert into "objects"'),
      );
      const result = await batch(statements);
      if (creates) observed.push(await f.projection());
      return result;
    };
    expect(
      (await f.request("Create", { to: [PUBLIC, BOB], cc: [] })).status,
    ).toBe(202);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.content).toBe("Private edited body");
    expect(observed[0]?.visibility).toBe("direct");
    expect(observed[0]?.recipients).toEqual([{ actor: CAROL, type: "to" }]);
    const row = (await f.db.select().from(objects).get())!;
    expect(await canViewerReadObjectFull(f.db, row, BOB)).toBe(false);
    expect(await canViewerReadObjectFull(f.db, row, CAROL)).toBe(true);
    expect(
      await f.db.select().from(inbox).where(eq(inbox.actorApId, BOB)),
    ).toHaveLength(0);
  } finally {
    db.batch = batch;
    f.client.close();
  }
});

test("a same-host actor's pending Update cannot alter another author's Create", async () => {
  const f = await fixture();
  try {
    expect(
      (
        await f.request(
          "Update",
          { content: "Attacker body", to: [CAROL] },
          "wrong-author",
        )
      ).status,
    ).toBe(202);
    expect((await f.request("Create", {}, "other-create", OTHER)).status).toBe(
      202,
    );
    expect((await f.projection())?.content).toBe("Original body");
    expect((await f.db.select().from(objects).get())?.attributedTo).toBe(OTHER);
    expect((await f.projection())?.recipients).toEqual([
      { actor: BOB, type: "to" },
    ]);
  } finally {
    f.client.close();
  }
});

test("retry of an older Update after a genuine SQL failure cannot overwrite a later accepted edit", async () => {
  const f = await fixture();
  try {
    expect((await f.request("Create")).status).toBe(202);
    await f.client.execute(
      "CREATE TRIGGER reject_first_ordered_edit BEFORE UPDATE ON objects WHEN NEW.content = 'First edit' BEGIN SELECT RAISE(ABORT, 'injected first note update failure'); END",
    );
    expect(
      (await f.request("Update", { content: "First edit" }, "edit-one")).status,
    ).toBe(503);
    await f.client.execute("DROP TRIGGER reject_first_ordered_edit");
    expect(
      (await f.request("Update", { content: "Later edit" }, "edit-two")).status,
    ).toBe(202);
    expect((await f.projection())?.content).toBe("Later edit");
    expect(
      (await f.request("Update", { content: "First edit" }, "edit-one")).status,
    ).toBe(202);
    expect((await f.projection())?.content).toBe("Later edit");
  } finally {
    f.client.close();
  }
});

test("an Update that wins before a Create commit prevents stale first exposure and survives retry", async () => {
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
      const creates = statements.some((statement) =>
        (statement as unknown as { toSQL?: () => { sql: string } })
          .toSQL?.()
          .sql.startsWith('insert into "objects"'),
      );
      if (!injected && creates) {
        injected = true;
        expect(
          (
            await f.request(
              "Update",
              { content: "Interleaved edit" },
              "interleaved",
            )
          ).status,
        ).toBe(202);
      }
      return batch(statements);
    };
    expect((await f.request("Create")).status).toBe(503);
    expect(injected).toBe(true);
    expect(await f.db.select().from(objects)).toHaveLength(0);
    expect(await f.db.select().from(inbox)).toHaveLength(0);
    expect((await f.request("Create")).status).toBe(202);
    expect((await f.projection())?.content).toBe("Interleaved edit");
  } finally {
    db.batch = batch;
    f.client.close();
  }
});

test("terminal Delete wins over a pending Update and late Create", async () => {
  const f = await fixture();
  try {
    expect(
      (await f.request("Update", { content: "Pending body" })).status,
    ).toBe(202);
    expect((await f.request("Delete")).status).toBe(202);
    expect((await f.request("Create")).status).toBe(202);
    expect(await f.projection()).toBe(null);
  } finally {
    f.client.close();
  }
});

test("pending Updates do not bypass a current local block and can apply after a valid new Create", async () => {
  const f = await fixture();
  try {
    expect(
      (await f.request("Update", { content: "Pending edit" })).status,
    ).toBe(202);
    await f.db.insert(blocks).values({ blockerApId: BOB, blockedApId: AUTHOR });
    expect((await f.request("Create", {}, "blocked-create")).status).toBe(202);
    expect(await f.projection()).toBe(null);
    await f.db.delete(blocks);
    expect((await f.request("Create", {}, "unblocked-create")).status).toBe(
      202,
    );
    expect((await f.projection())?.content).toBe("Pending edit");
  } finally {
    f.client.close();
  }
});

test("group actor inbox retains an Update delivered before the legitimate room Create", async () => {
  const f = await fixture();
  try {
    await f.room();
    expect(
      (
        await f.request(
          "Update",
          { content: "Edited group body", room: ROOM_URL },
          "group-edit",
          AUTHOR,
          "group",
        )
      ).status,
    ).toBe(202);
    expect(
      (
        await f.request(
          "Create",
          { room: ROOM_URL },
          "group-create",
          AUTHOR,
          "group",
        )
      ).status,
    ).toBe(202);
    expect((await f.projection())?.content).toBe("Edited group body");
    expect((await f.projection())?.visibility).toBe("group");
    expect((await f.projection())?.recipients).toEqual([
      { actor: ROOM, type: "audience" },
    ]);
  } finally {
    f.client.close();
  }
});

test("a late Create cannot restore a recipient revoked by an accepted Update", async () => {
  const f = await fixture();
  try {
    expect((await f.request("Create")).status).toBe(202);
    expect(
      (
        await f.request(
          "Update",
          { content: "Carol only", to: [CAROL], cc: [] },
          "retarget",
        )
      ).status,
    ).toBe(202);
    expect((await f.request("Create", {}, "late-old-create")).status).toBe(202);
    expect((await f.projection())?.recipients).toEqual([
      { actor: CAROL, type: "to" },
    ]);
    const row = (await f.db.select().from(objects).get())!;
    expect(await canViewerReadObjectFull(f.db, row, BOB)).toBe(false);
    expect(await canViewerReadObjectFull(f.db, row, CAROL)).toBe(true);
  } finally {
    f.client.close();
  }
});

test("the same Create repairs a genuine later notification failure without duplicating the object", async () => {
  const f = await fixture();
  const patch = { to: [PUBLIC], tag: [{ type: "Mention", href: BOB }] };
  try {
    await f.client.execute(
      "CREATE TRIGGER reject_ordered_create_notice BEFORE INSERT ON inbox BEGIN SELECT RAISE(ABORT, 'injected ordered notice failure'); END",
    );
    expect((await f.request("Create", patch)).status).toBe(503);
    expect(await f.db.select().from(objects)).toHaveLength(1);
    expect(await f.db.select().from(inbox)).toHaveLength(0);
    await f.client.execute("DROP TRIGGER reject_ordered_create_notice");
    expect((await f.request("Create", patch)).status).toBe(202);
    expect(await f.db.select().from(objects)).toHaveLength(1);
    expect(await f.db.select().from(inbox)).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

test("group Update rechecks the current ban and never widens room reach", async () => {
  const f = await fixture();
  try {
    await f.room();
    expect(
      (
        await f.request(
          "Create",
          { room: ROOM_URL },
          "group-create",
          AUTHOR,
          "group",
        )
      ).status,
    ).toBe(202);
    expect(
      (
        await f.request(
          "Update",
          {
            room: ROOM_URL,
            content: "Unwanted public body",
            to: [PUBLIC],
            audience: [],
          },
          "widen",
          AUTHOR,
          "group",
        )
      ).status,
    ).toBe(202);
    expect((await f.projection())?.content).toBe("Original body");
    expect((await f.projection())?.visibility).toBe("group");
    await f.db
      .insert(communityBans)
      .values({ communityApId: ROOM, bannedApId: AUTHOR });
    expect(
      (
        await f.request(
          "Update",
          { room: ROOM_URL, content: "Banned edit" },
          "banned",
          AUTHOR,
          "group",
        )
      ).status,
    ).toBe(202);
    expect((await f.projection())?.content).toBe("Original body");
    await f.db.delete(communityBans);
    expect(
      (
        await f.request(
          "Update",
          { room: ROOM_URL, content: "Allowed edit" },
          "allowed",
          AUTHOR,
          "group",
        )
      ).status,
    ).toBe(202);
    expect((await f.projection())?.content).toBe("Allowed edit");
    expect((await f.projection())?.recipients).toEqual([
      { actor: ROOM, type: "audience" },
    ]);
  } finally {
    f.client.close();
  }
});

test("all bounded pending recipients co-commit under real D1 parameter limits", async () => {
  const f = await fixture();
  const addresses = [
    BOB,
    ...Array.from(
      { length: 63 },
      (_, n) => `https://recipient.example/users/${n}`,
    ),
  ];
  try {
    expect(
      (
        await f.request(
          "Update",
          { content: "Bounded edit", to: addresses },
          "many-recipients",
        )
      ).status,
    ).toBe(202);
    expect((await f.request("Create")).status).toBe(202);
    expect((await f.projection())?.content).toBe("Bounded edit");
    expect((await f.projection())?.recipients).toHaveLength(64);
  } finally {
    f.client.close();
  }
});

test("Create recovery does not resurrect a removed generation and tracks a legitimate new materialization", async () => {
  const f = await fixture();
  const patch = { to: [PUBLIC], tag: [{ type: "Mention", href: BOB }] };
  try {
    await f.client.execute(
      "CREATE TRIGGER reject_generation_notice BEFORE INSERT ON inbox BEGIN SELECT RAISE(ABORT, 'injected generation notice failure'); END",
    );
    expect((await f.request("Create", patch, "generation-one")).status).toBe(
      503,
    );
    expect(await f.db.select().from(objects)).toHaveLength(1);
    await f.db.delete(objectRecipients);
    await f.db.delete(objects);
    await f.client.execute("DROP TRIGGER reject_generation_notice");
    expect((await f.request("Create", patch, "generation-one")).status).toBe(
      202,
    );
    expect(await f.db.select().from(objects)).toHaveLength(0);
    expect(await f.db.select().from(inbox)).toHaveLength(0);
    await f.client.execute(
      "CREATE TRIGGER reject_generation_notice BEFORE INSERT ON inbox BEGIN SELECT RAISE(ABORT, 'injected generation notice failure'); END",
    );
    expect(
      (
        await f.request(
          "Create",
          { ...patch, content: "New materialization" },
          "generation-two",
        )
      ).status,
    ).toBe(503);
    await f.client.execute("DROP TRIGGER reject_generation_notice");
    expect(
      (
        await f.request(
          "Create",
          { ...patch, content: "New materialization" },
          "generation-two",
        )
      ).status,
    ).toBe(202);
    expect((await f.projection())?.content).toBe("New materialization");
    expect(await f.db.select().from(inbox)).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

test("a group ban committed at the update batch boundary prevents the stale grant from writing", async () => {
  const f = await fixture();
  const db = f.db as typeof f.db & {
    batch(
      statements: readonly [D1Statement, ...D1Statement[]],
    ): Promise<unknown[]>;
  };
  const batch = db.batch.bind(db);
  let injected = false;
  try {
    await f.room();
    expect(
      (
        await f.request(
          "Create",
          { room: ROOM_URL },
          "group-create",
          AUTHOR,
          "group",
        )
      ).status,
    ).toBe(202);
    db.batch = async (statements) => {
      const edits = statements.some((statement) => {
        const query = (
          statement as unknown as { toSQL?: () => { sql: string } }
        ).toSQL?.().sql;
        return (
          query?.startsWith('update "objects"') && query.includes('"content" =')
        );
      });
      if (!injected && edits) {
        injected = true;
        await db
          .insert(communityBans)
          .values({ communityApId: ROOM, bannedApId: AUTHOR });
      }
      return batch(statements);
    };
    const response = await f.request(
      "Update",
      { room: ROOM_URL, content: "Forbidden concurrent edit" },
      "racing-edit",
      AUTHOR,
      "group",
    );
    expect(injected).toBe(true);
    expect(await f.db.select().from(communityBans)).toHaveLength(1);
    expect(response.status).toBe(503);
    expect((await f.projection())?.content).toBe("Original body");
    await f.db.delete(communityBans);
    expect(
      (
        await f.request(
          "Update",
          { room: ROOM_URL, content: "Forbidden concurrent edit" },
          "racing-edit",
          AUTHOR,
          "group",
        )
      ).status,
    ).toBe(202);
    expect((await f.projection())?.content).toBe("Forbidden concurrent edit");
  } finally {
    db.batch = batch;
    f.client.close();
  }
});

for (const revoked of ["alias-ban", "accepted-follow", "policy"] as const) {
  test(`group Update fences a concurrent ${revoked} change in the actual projection batch`, async () => {
    const f = await fixture();
    const db = f.db as typeof f.db & {
      batch(
        statements: readonly [D1Statement, ...D1Statement[]],
      ): Promise<unknown[]>;
    };
    const batch = db.batch.bind(db);
    let injected = false;
    const follower = AUTHOR + "/#retained-alias";
    try {
      await f.room();
      if (revoked === "accepted-follow") {
        await db.update(communities).set({ postPolicy: "members" });
        await db.insert(follows).values({
          followerApId: follower,
          followingApId: ROOM,
          status: "accepted",
        });
      }
      expect(
        (
          await f.request(
            "Create",
            { room: ROOM_URL },
            "group-create",
            AUTHOR,
            "group",
          )
        ).status,
      ).toBe(202);
      const before = await f.projection();
      db.batch = async (statements) => {
        const edits = statements.some((statement) => {
          const query = (
            statement as unknown as { toSQL?: () => { sql: string } }
          ).toSQL?.().sql;
          return (
            query?.startsWith('update "objects"') &&
            query.includes('"content" =')
          );
        });
        if (!injected && edits) {
          injected = true;
          if (revoked === "alias-ban")
            await db.insert(communityBans).values({
              communityApId: ROOM,
              bannedApId: AUTHOR + "/#banned-alias",
            });
          if (revoked === "accepted-follow") await db.delete(follows);
          if (revoked === "policy")
            await db.update(communities).set({ postPolicy: "owners" });
        }
        return batch(statements);
      };
      const patch = { room: ROOM_URL, content: "Concurrent edit" };
      expect(
        (await f.request("Update", patch, "racing-edit", AUTHOR, "group"))
          .status,
      ).toBe(503);
      expect(injected).toBe(true);
      expect(await f.projection()).toEqual(before);
      expect(
        (await db.select().from(inboundNoteUpdateHeads).get())?.appliedSequence,
      ).toBe(0);
      expect(
        (await db.select().from(inboundNoteUpdateEvents).get())?.patchJson,
      ).not.toBeNull();
      if (revoked === "alias-ban") await db.delete(communityBans);
      if (revoked === "accepted-follow")
        await db.insert(follows).values({
          followerApId: follower,
          followingApId: ROOM,
          status: "accepted",
        });
      if (revoked === "policy")
        await db.update(communities).set({ postPolicy: "anyone" });
      expect(
        (await f.request("Update", patch, "racing-edit", AUTHOR, "group"))
          .status,
      ).toBe(202);
      expect((await f.projection())?.content).toBe("Concurrent edit");
    } finally {
      db.batch = batch;
      f.client.close();
    }
  });
}

test("the actual local moderator witness cannot survive a role revocation", async () => {
  const f = await fixture();
  try {
    await f.room();
    await f.db.update(communities).set({ postPolicy: "mods" });
    await f.db
      .insert(communityMembers)
      .values({ communityApId: ROOM, actorApId: BOB, role: "moderator" });
    const community = (await f.db.select().from(communities).get())!;
    const admissions: InboundCommunityAdmission[] = [];
    expect(
      await canActorPostToInboundCommunity(f.db, BOB, community, (admission) =>
        admissions.push(admission),
      ),
    ).toBe(true);
    const allowed = async () =>
      (
        await f.db
          .select({
            allowed: sql<number>`${inboundCommunityAdmissionsSql(admissions, BOB)}`,
          })
          .from(communities)
          .get()
      )?.allowed;
    expect(await allowed()).toBe(1);
    await f.db.update(communityMembers).set({ role: "member" });
    expect(await canActorPostToInboundCommunity(f.db, BOB, community)).toBe(
      false,
    );
    expect(await allowed()).toBe(0);
    await f.db.update(communityMembers).set({ role: "moderator" });
    expect(await allowed()).toBe(1);
  } finally {
    f.client.close();
  }
});

test("all sixteen pending community admissions co-commit below the D1 variable ceiling", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 16; i++) {
      const room = ROOM + i;
      await f.db.insert(communities).values({
        apId: room,
        preferredUsername: "ordered-room" + i,
        name: "Ordered room",
        inbox: room + "/inbox",
        outbox: room + "/outbox",
        followersUrl: room + "/followers",
        createdBy: BOB,
        publicKeyPem: "unused-local",
        privateKeyPem: "unused-local",
        postPolicy: "anyone",
        visibility: "public",
      });
      expect(
        (
          await f.request(
            "Update",
            { audience: [room], content: "Edit " + i },
            "room-edit-" + i,
          )
        ).status,
      ).toBe(202);
    }
    expect((await f.request("Create", { to: [PUBLIC] })).status).toBe(202);
    expect((await f.projection())?.content).toBe("Edit 15");
    expect((await f.projection())?.audienceJson).toBe(
      JSON.stringify([ROOM + 15]),
    );
    expect(
      (await f.db.select().from(inboundNoteUpdateHeads).get())?.appliedSequence,
    ).toBe(16);
  } finally {
    f.client.close();
  }
});

test("hidden shared-inbox fanout retains every signed recipient without reviving later revoked reach", async () => {
  const f = await fixture();
  try {
    const hidden = { to: [], bto: [BOB], bcc: [CAROL] };
    expect(
      (await f.request("Create", hidden, "hidden-create", AUTHOR, "shared"))
        .status,
    ).toBe(202);
    expect((await f.projection())?.recipients).toEqual([
      { actor: BOB, type: "to" },
      { actor: CAROL, type: "to" },
    ]);
    expect(
      (await f.db.select().from(inbox)).map((row) => row.actorApId).sort(),
    ).toEqual([BOB, CAROL]);
    expect(
      (
        await f.request(
          "Update",
          { to: [], bto: [BOB], bcc: [], content: "Only Bob" },
          "hidden-revoke",
          AUTHOR,
          "shared",
        )
      ).status,
    ).toBe(202);
    expect(
      (
        await f.request(
          "Create",
          hidden,
          "late-hidden-create",
          AUTHOR,
          "shared",
        )
      ).status,
    ).toBe(202);
    expect((await f.projection())?.recipients).toEqual([
      { actor: BOB, type: "to" },
    ]);
    expect((await f.projection())?.content).toBe("Only Bob");
    const row = (await f.db.select().from(objects).get())!;
    expect(await canViewerReadObjectFull(f.db, row, CAROL)).toBe(false);
  } finally {
    f.client.close();
  }
});
