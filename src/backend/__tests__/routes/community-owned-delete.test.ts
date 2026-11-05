import { expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  actors,
  objects,
  objectRecipients,
  communities,
  communityMembers,
  actorWriteAssertions,
  activities,
  likes,
  mediaBlobDeletionJobs,
  blockedActors,
  mediaUploads,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import messages from "../../routes/communities/messages.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import { guardActorWrites } from "../../lib/account-deletion-admission.ts";

const origin = "https://group-delete.test",
  author = origin + "/ap/users/alice",
  manager = origin + "/ap/users/mod",
  member = origin + "/ap/users/member",
  group = origin + "/ap/groups/friends";
async function fixture(opaque = false) {
  const f = await createTestDb(),
    db = f.db;
  for (const apId of [author, manager, member])
    await db.insert(actors).values({
      apId,
      preferredUsername: apId.split("/").at(-1)!,
      inbox: apId + "/inbox",
      outbox: apId + "/outbox",
      followersUrl: apId + "/followers",
      followingUrl: apId + "/following",
      publicKeyPem: "public-fixture",
      privateKeyPem: "private-fixture",
    });
  await db.insert(communities).values({
    apId: group,
    preferredUsername: "friends",
    name: "Friends",
    inbox: group + "/inbox",
    outbox: group + "/outbox",
    followersUrl: group + "/followers",
    visibility: "private",
    publicKeyPem: "public-fixture",
    privateKeyPem: "private-fixture",
    createdBy: author,
  });
  for (const actorApId of [author, manager, member])
    await db.insert(communityMembers).values({
      communityApId: group,
      actorApId,
      role: actorApId === manager ? "moderator" : "member",
    });
  const id =
    origin +
    (opaque ? "/ap/objects/opaque%2Fone?value=%25" : "/ap/objects/message");
  await db.insert(objects).values({
    apId: id,
    type: "Note",
    attributedTo: author,
    content: "Original",
    visibility: "unlisted",
    toJson: JSON.stringify([group]),
    audienceJson: JSON.stringify([group]),
    published: "2026-11-05T00:00:00Z",
    isLocal: 1,
  });
  await db
    .insert(objectRecipients)
    .values({ objectApId: id, recipientApId: group, type: "audience" });
  await db.insert(likes).values({ objectApId: id, actorApId: member });
  await db.insert(activities).values({
    apId: id + "#create",
    type: "Create",
    actorApId: author,
    objectApId: id,
    direction: "outbound",
    rawJson: JSON.stringify({
      type: "Create",
      object: { id, content: "Original" },
    }),
  });
  const env = { APP_URL: origin, DB_INSTANCE: db } as Env,
    path = `/api/communities/${encodeURIComponent(group)}/messages/${encodeURIComponent(id)}`;
  const errors: unknown[] = [];
  function request(
    method = "DELETE",
    revision?: string,
    viewer: string | null = author,
    guarded = false,
  ) {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
      const a = viewer
        ? ({
            ap_id: viewer,
            preferred_username: viewer.split("/").at(-1),
            name: "Fixture",
            icon_url: null,
            public_key_pem: "public-fixture",
            takos_user_id: null,
          } as Actor)
        : null;
      c.set("db", a && guarded ? guardActorWrites(db, a) : db);
      if (a) c.set("actor", a);
      await next();
    });
    app.onError((error, c) => {
      errors.push(error);
      return c.json({ error: "controlled failure" }, 500);
    });
    app.route("/api/communities", messages);
    return app.fetch(
      new Request(origin + path, {
        method,
        headers:
          revision === undefined
            ? {}
            : { "if-match": JSON.stringify(revision) },
      }),
      env,
    );
  }
  async function revision() {
    return ((await (await request("GET")).json()) as { revision: string })
      .revision;
  }
  async function snapshot() {
    return {
      objects: await db.select().from(objects),
      recipients: await db.select().from(objectRecipients),
      likes: await db.select().from(likes),
      activities: await db.select().from(activities),
      media: await db.select().from(mediaBlobDeletionJobs),
      uploads: await db.select().from(mediaUploads),
      assertions: await db.select().from(actorWriteAssertions),
    };
  }
  return { ...f, id, path, request, revision, snapshot, errors, env };
}

test("author GET advertises the implemented conditional Group delete contract", async () => {
  const f = await fixture();
  try {
    const r = await f.request("GET");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      message_actions: {
        delete: { version: 1, precondition: "group-message-v1" },
      },
    });
  } finally {
    f.client.close();
  }
});

test("a stale Group delete precondition has zero effects", async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot();
    expect(
      (await f.request("DELETE", "group-message-v1:" + "a".repeat(64))).status,
    ).toBe(409);
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("conditional Group delete handles opaque IDs once and composes with actor admission", async () => {
  const f = await fixture(true);
  try {
    const rev = await f.revision(),
      r = await f.request("DELETE", rev, author, true);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      success: true,
      community_ap_id: group,
      message_id: f.id,
    });
    expect(await f.db.select().from(objects)).toHaveLength(0);
    expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
    expect(await f.db.select().from(likes)).toHaveLength(0);
    expect(await f.db.select().from(actorWriteAssertions)).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("final Group object failure rolls back the actual cascade", async () => {
  const f = await fixture();
  try {
    const rev = await f.revision();
    await f.client.execute(
      "CREATE TRIGGER stop_group_final_delete BEFORE DELETE ON objects BEGIN SELECT RAISE(ABORT,'synthetic final delete failure'); END",
    );
    const before = await f.snapshot();
    expect((await f.request("DELETE", rev)).status).toBe(500);
    expect(String(f.errors[0])).toContain("synthetic final delete failure");
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("legacy Group deletion preserves author and current manager permissions", async () => {
  for (const viewer of [author, manager]) {
    const f = await fixture();
    try {
      expect((await f.request("DELETE", undefined, viewer)).status).toBe(200);
      expect(await f.db.select().from(objects)).toHaveLength(0);
    } finally {
      f.client.close();
    }
  }
  const f = await fixture();
  try {
    const before = await f.snapshot();
    for (const viewer of [null, member])
      expect((await f.request("DELETE", undefined, viewer)).status).toBe(
        viewer ? 403 : 401,
      );
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("Group delete cannot mutate a feed post or a deleted community", async () => {
  for (const scope of ["feed", "deleted"]) {
    const f = await fixture();
    try {
      if (scope === "feed")
        await f.db
          .update(objects)
          .set({ communityApId: group })
          .where(eq(objects.apId, f.id));
      else
        await f.db
          .update(communities)
          .set({ deletedAt: "2026-11-05T00:00:01Z" });
      const before = await f.snapshot();
      expect((await f.request()).status).toBe(404);
      expect(await f.snapshot()).toEqual(before);
    } finally {
      f.client.close();
    }
  }
});

for (const change of [
  "content",
  "membership",
  "recipient",
  "manager-role",
] as const) {
  test(`Group delete rechecks ${change} at the actual batch boundary`, async () => {
    const f = await fixture();
    try {
      const rev = await f.revision(),
        batch = f.client.batch.bind(f.client);
      let before: Awaited<ReturnType<typeof f.snapshot>> | undefined;
      f.client.batch = (async (statements, ...rest) => {
        if (!before) {
          if (change === "content")
            await f.db
              .update(objects)
              .set({ content: "Other device" })
              .where(eq(objects.apId, f.id));
          if (change === "membership")
            await f.db
              .delete(communityMembers)
              .where(eq(communityMembers.actorApId, author));
          if (change === "recipient") await f.db.delete(objectRecipients);
          if (change === "manager-role")
            await f.db
              .update(communityMembers)
              .set({ role: "member" })
              .where(eq(communityMembers.actorApId, manager));
          before = await f.snapshot();
        }
        return batch(statements, ...rest);
      }) as typeof f.client.batch;
      expect(
        (
          await f.request(
            "DELETE",
            rev,
            change === "manager-role" ? manager : author,
          )
        ).status,
      ).toBe(409);
      expect(before).toBeDefined();
      if (!before) throw Error("real delete batch not reached");
      expect(await f.snapshot()).toEqual(before);
    } finally {
      f.client.close();
    }
  });
}

test("legacy NULL/public Group author deletion does not require membership", async () => {
  const f = await fixture();
  try {
    await f.db.delete(communityMembers);
    await f.client.execute("UPDATE communities SET visibility=NULL");
    expect((await f.request("DELETE", await f.revision())).status).toBe(200);
    expect(await f.db.select().from(objects)).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("a current manager can still remove an operator-hidden chat message without serving it", async () => {
  const f = await fixture();
  try {
    await f.db.insert(blockedActors).values({ actorApId: author });
    expect((await f.request("DELETE", undefined, manager)).status).toBe(200);
    expect(await f.db.select().from(objects)).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

for (const failure of ["none", "final-object", "object-store"] as const) {
  test(`Group media deletion keeps commit-before-purge and durable retry (${failure})`, async () => {
    const f = await fixture();
    try {
      const key = "uploads/" + "a".repeat(64) + ".png",
        deleted: string[] = [];
      await f.db
        .update(objects)
        .set({
          attachmentsJson: JSON.stringify([
            {
              type: "Document",
              mediaType: "image/png",
              r2_key: key,
              url: "/media/" + key.slice(8),
            },
          ]),
        })
        .where(eq(objects.apId, f.id));
      await f.db.insert(mediaUploads).values({
        id: "synthetic-upload",
        r2Key: key,
        uploaderApId: author,
        contentType: "image/png",
        size: 123,
      });
      let objectRowsAtPurge: number | undefined;
      f.env.MEDIA = {
        put: async () => {},
        get: async () => null,
        delete: async (keys) => {
          objectRowsAtPurge = (await f.db.select().from(objects)).length;
          deleted.push(...(typeof keys === "string" ? [keys] : keys));
          if (failure === "object-store")
            throw Error("synthetic storage failure");
        },
      };
      if (failure === "final-object")
        await f.client.execute(
          "CREATE TRIGGER stop_final_media_delete BEFORE DELETE ON objects BEGIN SELECT RAISE(ABORT,'synthetic final delete failure'); END",
        );
      const rev = await f.revision(),
        before = await f.snapshot(),
        response = await f.request("DELETE", rev);
      expect(response.status).toBe(failure === "final-object" ? 500 : 200);
      if (failure === "final-object") {
        expect(deleted).toHaveLength(0);
        expect(await f.snapshot()).toEqual(before);
      } else {
        expect(deleted).toEqual([key]);
        expect(objectRowsAtPurge).toBe(0);
        expect(await f.db.select().from(objects)).toHaveLength(0);
        expect(await f.db.select().from(mediaBlobDeletionJobs)).toHaveLength(
          failure === "object-store" ? 1 : 0,
        );
      }
    } finally {
      f.client.close();
    }
  });
}

test("Group delete rejects malformed or other-protocol revisions without side effects", async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot();
    for (const revision of [
      "*",
      "dm-v1:" + "a".repeat(64),
      "group-message-v1:bad",
    ]) {
      expect((await f.request("DELETE", revision)).status).toBe(400);
      expect(await f.snapshot()).toEqual(before);
    }
  } finally {
    f.client.close();
  }
});
