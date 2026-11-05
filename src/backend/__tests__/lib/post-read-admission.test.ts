import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  actors,
  blockedActors,
  blockedDomains,
  blocks,
  mutes,
  communities,
  communityMembers,
  follows,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import { canViewerReadObjectFull } from "../../lib/post-visibility.ts";
import {
  readInboundNoteParent,
  inboundNoteParentAdmissionSql,
} from "../../routes/activitypub/handlers/inbound-note-parent-admission.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const HOST = "https://yuru.test",
  OWNER = HOST + "/ap/users/owner",
  VIEWER = HOST + "/ap/users/viewer";
const PARENT = HOST + "/ap/objects/parent",
  ROOM = HOST + "/ap/groups/room";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

async function fixture() {
  const f = await createTestDb();
  for (const apId of [OWNER, VIEWER])
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
  await f.db.insert(objects).values({
    apId: PARENT,
    type: "Note",
    attributedTo: OWNER,
    isLocal: 1,
    content: "Parent",
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
  });
  async function room(visibility = "public", deletedAt: string | null = null) {
    await f.db.insert(communities).values({
      apId: ROOM,
      preferredUsername: "room",
      name: "Room",
      inbox: ROOM + "/inbox",
      outbox: ROOM + "/outbox",
      followersUrl: ROOM + "/followers",
      publicKeyPem: "unused-local",
      privateKeyPem: "unused-local",
      createdBy: OWNER,
      visibility,
      deletedAt,
    });
  }
  async function capture(viewer = VIEWER) {
    const result = await readInboundNoteParent(f.db, PARENT, viewer, HOST);
    expect(result.allowed).toBe(true);
    if (!result.allowed)
      throw new Error("Actual canonical read rejected the fixture");
    expect(result.admission).toBeDefined();
    const admission = result.admission;
    return async () => {
      const row = await f.db.get(
        sql`SELECT (${inboundNoteParentAdmissionSql(admission, PARENT, viewer)}) AS allowed`,
      );
      return (row as { allowed: number }).allowed;
    };
  }
  return { ...f, room, capture };
}

for (const revoked of [
  "reach",
  "deleted",
  "operator-actor",
  "operator-domain",
  "owner-block",
  "owner-mute",
] as const) {
  test(`canonical parent admission rejects a later ${revoked} revocation`, async () => {
    const f = await fixture();
    try {
      const allowed = await f.capture();
      expect(await allowed()).toBe(1);
      if (revoked === "reach")
        await f.db
          .update(objects)
          .set({ visibility: "direct", toJson: JSON.stringify([OWNER]) });
      if (revoked === "deleted")
        await f.db.update(objects).set({ deletedAt: new Date().toISOString() });
      if (revoked === "operator-actor")
        await f.db
          .insert(blockedActors)
          .values({ actorApId: OWNER + "/#retained-alias" });
      if (revoked === "operator-domain")
        await f.db.insert(blockedDomains).values({ domain: "yuru.test" });
      if (revoked === "owner-block")
        await f.db.insert(blocks).values({
          blockerApId: OWNER,
          blockedApId: VIEWER + "/#retained-alias",
        });
      if (revoked === "owner-mute")
        await f.db
          .insert(mutes)
          .values({ muterApId: OWNER, mutedApId: VIEWER + "/#retained-alias" });
      expect(await allowed()).toBe(0);
      expect(
        (await readInboundNoteParent(f.db, PARENT, VIEWER, HOST)).allowed,
      ).toBe(false);
    } finally {
      f.client.close();
    }
  });
}

for (const transition of [
  "public-private",
  "public-deleted",
  "unknown-private",
  "unknown-deleted",
  "private-membership",
] as const) {
  test(`canonical parent admission retains community resolution across ${transition}`, async () => {
    const f = await fixture();
    try {
      await f.db.update(objects).set({ audienceJson: JSON.stringify([ROOM]) });
      if (transition.startsWith("public-")) await f.room();
      if (transition === "private-membership") {
        await f.room("private");
        await f.db
          .insert(communityMembers)
          .values({ communityApId: ROOM, actorApId: VIEWER });
      }
      const allowed = await f.capture();
      expect(await allowed()).toBe(1);
      if (transition === "unknown-private") await f.room("private");
      if (transition === "unknown-deleted")
        await f.room("public", new Date().toISOString());
      if (transition === "public-private")
        await f.db.update(communities).set({ visibility: "private" });
      if (transition === "public-deleted")
        await f.db
          .update(communities)
          .set({ deletedAt: new Date().toISOString() });
      if (transition === "private-membership")
        await f.db.delete(communityMembers);
      expect(await allowed()).toBe(0);
      expect(
        (await readInboundNoteParent(f.db, PARENT, VIEWER, HOST)).allowed,
      ).toBe(false);
    } finally {
      f.client.close();
    }
  });
}

for (const grant of ["follow", "hidden-recipient"] as const) {
  test(`the parent's actual ${grant} grant must survive until commit`, async () => {
    const f = await fixture();
    try {
      await f.db.update(objects).set({
        visibility: grant === "follow" ? "followers" : "direct",
        toJson: "[]",
      });
      if (grant === "follow")
        await f.db.insert(follows).values({
          followerApId: VIEWER,
          followingApId: OWNER,
          status: "accepted",
        });
      else
        await f.db
          .insert(objectRecipients)
          .values({ objectApId: PARENT, recipientApId: VIEWER, type: "to" });
      const allowed = await f.capture();
      expect(await allowed()).toBe(1);
      if (grant === "follow") await f.db.delete(follows);
      else await f.db.delete(objectRecipients);
      expect(await allowed()).toBe(0);
      expect(
        (await readInboundNoteParent(f.db, PARENT, VIEWER, HOST)).allowed,
      ).toBe(false);
    } finally {
      f.client.close();
    }
  });
}

test("an absent parent becoming private invalidates its actual absence receipt", async () => {
  const f = await fixture();
  try {
    await f.db.delete(objects);
    const result = await readInboundNoteParent(f.db, PARENT, VIEWER, HOST);
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("missing parent denied");
    const allowed = async () =>
      (
        (await f.db.get(
          sql`SELECT (${inboundNoteParentAdmissionSql(result.admission, PARENT, VIEWER)}) AS allowed`,
        )) as { allowed: number }
      ).allowed;
    expect(await allowed()).toBe(1);
    await f.db.insert(objects).values({
      apId: PARENT,
      type: "Note",
      attributedTo: OWNER,
      isLocal: 1,
      visibility: "direct",
      toJson: JSON.stringify([OWNER]),
    });
    expect(await allowed()).toBe(0);
    expect(
      (await readInboundNoteParent(f.db, PARENT, VIEWER, HOST)).allowed,
    ).toBe(false);
  } finally {
    f.client.close();
  }
});

test("a non-owner Story parent expires without any row mutation", async () => {
  const f = await fixture();
  try {
    await f.db.insert(follows).values({
      followerApId: VIEWER,
      followingApId: OWNER,
      status: "accepted",
    });
    const expires = new Date(Date.now() + 1000).toISOString();
    await f.db.update(objects).set({ type: "Story", endTime: expires });
    const allowed = await f.capture();
    expect(await allowed()).toBe(1);
    await Bun.sleep(Math.max(0, Date.parse(expires) - Date.now() + 30));
    expect(await allowed()).toBe(0);
    expect(
      (await readInboundNoteParent(f.db, PARENT, VIEWER, HOST)).allowed,
    ).toBe(false);
  } finally {
    f.client.close();
  }
});

test("the canonical own-Story shortcut retains operator and parent-lifecycle boundaries", async () => {
  const f = await fixture();
  try {
    await f.room("private");
    await f.db.update(objects).set({
      type: "Story",
      endTime: "2000-01-01T00:00:00.000Z",
      audienceJson: JSON.stringify([ROOM]),
    });
    const allowed = await f.capture(OWNER);
    expect(await allowed()).toBe(1);
    await f.db.update(communities).set({ deletedAt: new Date().toISOString() });
    expect(await allowed()).toBe(1);
    await f.db.insert(blockedActors).values({ actorApId: OWNER });
    expect(await allowed()).toBe(0);
    expect(
      (await readInboundNoteParent(f.db, PARENT, OWNER, HOST)).allowed,
    ).toBe(false);
  } finally {
    f.client.close();
  }
});

test("bounded unknown audiences and unrelated parent edits preserve a valid admission", async () => {
  const f = await fixture();
  try {
    await f.db.update(objects).set({
      audienceJson: JSON.stringify(
        Array.from({ length: 64 }, (_, i) => HOST + "/ap/groups/unknown-" + i),
      ),
    });
    const allowed = await f.capture();
    expect(await allowed()).toBe(1);
    await f.db
      .update(objects)
      .set({ content: "Edited parent body", replyCount: 123 });
    expect(await allowed()).toBe(1);
    expect(
      await canViewerReadObjectFull(
        f.db,
        (await f.db
          .select()
          .from(objects)
          .where(eq(objects.apId, PARENT))
          .get())!,
        VIEWER,
      ),
    ).toBe(true);
  } finally {
    f.client.close();
  }
});
