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
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import messages from "../../routes/communities/messages.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import { guardActorWrites } from "../../lib/account-deletion-admission.ts";

const origin = "https://group-edit.test",
  me = origin + "/ap/users/alice",
  group = origin + "/ap/groups/friends";

async function fixture(opaque = true) {
  const f = await createTestDb(),
    db = f.db;
  await db.insert(actors).values({
    apId: me,
    preferredUsername: "alice",
    inbox: me + "/inbox",
    outbox: me + "/outbox",
    followersUrl: me + "/followers",
    followingUrl: me + "/following",
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
    postPolicy: "members",
    publicKeyPem: "public-fixture",
    privateKeyPem: "private-fixture",
    createdBy: me,
  });
  await db
    .insert(communityMembers)
    .values({ communityApId: group, actorApId: me, role: "member" });
  const id =
    origin +
    (opaque ? "/ap/objects/opaque%2Fone?value=%25" : "/ap/objects/message");
  await db.insert(objects).values({
    apId: id,
    type: "Note",
    attributedTo: me,
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
  const actor = {
    ap_id: me,
    preferred_username: "alice",
    name: "Alice",
    icon_url: null,
    public_key_pem: "public-fixture",
    takos_user_id: null,
  } as Actor;
  const env = { APP_URL: origin, DB_INSTANCE: db } as Env;
  const path = `/api/communities/${encodeURIComponent(group)}/messages/${encodeURIComponent(id)}`;
  function app(viewer: Actor | null = actor, guarded = false) {
    const a = new Hono<{ Bindings: Env; Variables: Variables }>();
    a.use("*", async (c, next) => {
      c.set("db", viewer && guarded ? guardActorWrites(db, viewer) : db);
      if (viewer) c.set("actor", viewer);
      await next();
    });
    a.route("/api/communities", messages);
    return a;
  }
  function request(
    method = "GET",
    content?: string,
    revision?: string,
    viewer: Actor | null = actor,
    guarded = false,
  ) {
    return app(viewer, guarded).fetch(
      new Request(origin + path, {
        method,
        headers: {
          ...(content !== undefined
            ? { "content-type": "application/json" }
            : {}),
          ...(revision !== undefined
            ? { "if-match": JSON.stringify(revision) }
            : {}),
        },
        ...(content !== undefined ? { body: JSON.stringify({ content }) } : {}),
      }),
      env,
    );
  }
  async function snapshot() {
    return {
      objects: await db.select().from(objects),
      recipients: await db.select().from(objectRecipients),
      assertions: await db.select().from(actorWriteAssertions),
    };
  }
  return { ...f, actor, id, path, request, snapshot };
}

test("group author readback is exact, no-store and write-free, including opaque IDs", async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot(),
      r = await f.request();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const d = (await r.json()) as {
      revision: string;
      community_ap_id: string;
      message: { id: string; content: string; sender: { ap_id: string } };
    };
    expect(d).toMatchObject({
      community_ap_id: group,
      message: { id: f.id, content: "Original", sender: { ap_id: me } },
    });
    expect(d.revision).toMatch(/^group-message-v1:[a-f0-9]{64}$/);
    expect(r.headers.get("etag")).toBe(JSON.stringify(d.revision));
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("group conditional edit rejects a stale revision with no effect", async () => {
  const f = await fixture(false);
  try {
    const before = await f.snapshot();
    expect(
      (
        await f.request(
          "PATCH",
          "Lost update",
          "group-message-v1:" + "a".repeat(64),
        )
      ).status,
    ).toBe(409);
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("group edits retain legacy callers and return a new exact readback revision", async () => {
  const f = await fixture();
  try {
    const initial = await f.request();
    expect(initial.status).toBe(200);
    const first = (await initial.json()) as { revision: string };
    const r = await f.request(
      "PATCH",
      "  Updated  ",
      first.revision,
      f.actor,
      true,
    );
    expect(r.status).toBe(200);
    const d = (await r.json()) as { revision: string };
    expect(d).toMatchObject({
      success: true,
      message: { id: f.id, content: "Updated" },
    });
    expect(d.revision).not.toBe(first.revision);
    expect((await f.request("PATCH", "Legacy update")).status).toBe(200);
    expect(await f.db.select().from(actorWriteAssertions)).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("group readback/edit preserve authentication, author and private membership boundaries", async () => {
  const f = await fixture(false);
  try {
    for (const viewer of [null, { ...f.actor, ap_id: "another-author" }]) {
      for (const method of ["GET", "PATCH"]) {
        const r = await f.request(
          method,
          method === "PATCH" ? "Unauthorized" : undefined,
          undefined,
          viewer,
        );
        expect(r.status).toBe(viewer ? 403 : 401);
        expect(await r.text()).not.toContain("Original");
      }
    }
    await f.db.delete(communityMembers);
    const before = await f.snapshot();
    for (const method of ["GET", "PATCH"])
      expect(
        (await f.request(method, method === "PATCH" ? "Kicked" : undefined))
          .status,
      ).toBe(403);
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("group exact author route cannot edit a community feed post as chat", async () => {
  const f = await fixture(false);
  try {
    await f.db
      .update(objects)
      .set({ communityApId: group })
      .where(eq(objects.apId, f.id));
    const before = await f.snapshot();
    for (const method of ["GET", "PATCH"])
      expect(
        (
          await f.request(
            method,
            method === "PATCH" ? "Wrong scope" : undefined,
          )
        ).status,
      ).toBe(404);
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

for (const change of [
  "content",
  "membership",
  "recipient",
  "deleted-community",
  "feed-scope",
] as const) {
  test(`group edit rechecks ${change} at the real atomic batch boundary`, async () => {
    const f = await fixture(false);
    try {
      const first = (await (await f.request()).json()) as { revision: string };
      const batch = f.client.batch.bind(f.client);
      let before: Awaited<ReturnType<typeof f.snapshot>> | undefined;
      f.client.batch = (async (statements, ...rest) => {
        if (!before) {
          if (change === "content")
            await f.db
              .update(objects)
              .set({ content: "Other device", updated: "2026-11-05T00:00:01Z" })
              .where(eq(objects.apId, f.id));
          if (change === "membership") await f.db.delete(communityMembers);
          if (change === "recipient") await f.db.delete(objectRecipients);
          if (change === "deleted-community")
            await f.db
              .update(communities)
              .set({ deletedAt: "2026-11-05T00:00:01Z" });
          if (change === "feed-scope")
            await f.db
              .update(objects)
              .set({ communityApId: group })
              .where(eq(objects.apId, f.id));
          before = await f.snapshot();
        }
        return batch(statements, ...rest);
      }) as typeof f.client.batch;
      expect(
        (await f.request("PATCH", "Must not commit", first.revision)).status,
      ).toBe(409);
      expect(before).toBeDefined();
      if (!before) throw new Error("atomic batch hook was not reached");
      expect(await f.snapshot()).toEqual(before);
    } finally {
      f.client.close();
    }
  });
}

test("public chat preserves author edits without membership and does not promote moderator authorship", async () => {
  const f = await fixture(false);
  try {
    await f.db
      .update(communities)
      .set({ visibility: "public", postPolicy: "owners" });
    await f.db.delete(communityMembers);
    expect((await f.request()).status).toBe(200);
    expect((await f.request("PATCH", "Own history")).status).toBe(200);
    await f.db.insert(actors).values({
      apId: "moderator",
      preferredUsername: "moderator",
      inbox: "moderator/inbox",
      outbox: "moderator/outbox",
      followersUrl: "moderator/followers",
      followingUrl: "moderator/following",
      publicKeyPem: "public-fixture",
      privateKeyPem: "private-fixture",
    });
    await f.db.insert(communityMembers).values({
      communityApId: group,
      actorApId: "moderator",
      role: "moderator",
    });
    const before = await f.snapshot();
    expect(
      (
        await f.request("PATCH", "Not mine", undefined, {
          ...f.actor,
          ap_id: "moderator",
        })
      ).status,
    ).toBe(403);
    expect(await f.snapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("group If-Match rejects other protocols and malformed validators without mutation", async () => {
  const f = await fixture(false);
  try {
    const before = await f.snapshot();
    for (const revision of [
      "*",
      "dm-v1:" + "a".repeat(64),
      "group-message-v1:bad",
    ]) {
      expect(
        (await f.request("PATCH", "Invalid precondition", revision)).status,
      ).toBe(400);
      expect(await f.snapshot()).toEqual(before);
    }
  } finally {
    f.client.close();
  }
});

test("legacy nullable visibility retains the reader's public author-edit contract", async () => {
  const f = await fixture(false);
  try {
    await f.db.delete(communityMembers);
    // The actual migration column is nullable even though the Drizzle model
    // declares notNull. Preserve the existing reader's NULL -> public rule.
    await f.client.execute("UPDATE communities SET visibility=NULL");
    const read = await f.request();
    expect(read.status).toBe(200);
    const current = (await read.json()) as { revision: string };
    expect(
      (await f.request("PATCH", "Legacy public edit", current.revision)).status,
    ).toBe(200);
    expect((await f.db.select().from(objects))[0]?.content).toBe(
      "Legacy public edit",
    );
    expect(await f.db.select().from(actorWriteAssertions)).toHaveLength(0);
  } finally {
    f.client.close();
  }
});
