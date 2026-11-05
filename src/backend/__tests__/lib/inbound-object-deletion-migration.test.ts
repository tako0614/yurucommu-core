import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  activities,
  actors,
  inboundObjectDeletions,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import { createTestDb, readMigration } from "../helpers/d1-semantics.ts";

test("terminal deletion migration preserves existing schema/data and has no lifetime-owning foreign key", async () => {
  const { db, client } = await createTestDb({
    through: "0037_talk_observed_read.sql",
  });
  const actor = "https://yuru.test/ap/users/retained",
    object = "https://yuru.test/ap/objects/retained";
  try {
    await db.insert(actors).values({
      apId: actor,
      preferredUsername: "retained",
      inbox: actor + "/inbox",
      outbox: actor + "/outbox",
      followersUrl: actor + "/followers",
      followingUrl: actor + "/following",
      publicKeyPem: "unused",
      privateKeyPem: "unused",
    });
    await db.insert(objects).values({
      apId: object,
      attributedTo: actor,
      content: "Existing private content",
      visibility: "direct",
    });
    await db
      .insert(objectRecipients)
      .values({ objectApId: object, recipientApId: actor, type: "to" });
    await db.insert(activities).values({
      apId: actor + "/activities/create",
      type: "Create",
      actorApId: actor,
      objectApId: object,
      rawJson: "{}",
      direction: "outbound",
      processed: 1,
    });
    const before = [
      await db.select().from(actors),
      await db.select().from(objects),
      await db.select().from(objectRecipients),
      await db.select().from(activities),
    ];
    const schema = (
      await client.execute(
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
      )
    ).rows;
    const migration = await readMigration("0038_inbound_object_deletions.sql");
    await client.executeMultiple(migration);
    expect([
      await db.select().from(actors),
      await db.select().from(objects),
      await db.select().from(objectRecipients),
      await db.select().from(activities),
    ]).toEqual(before);
    expect(
      (
        await client.execute(
          "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> 'inbound_object_deletions' ORDER BY type, name",
        )
      ).rows,
    ).toEqual(schema);
    expect(await db.select().from(inboundObjectDeletions)).toHaveLength(0);
    const remote = "https://remote.example/users/deleted",
      absent = "https://remote.example/objects/already-gone";
    await db.insert(inboundObjectDeletions).values({
      actorApId: remote,
      objectApId: absent,
      deleteActivityApId: actor + "/activities/create",
    });
    await db.delete(activities);
    await db.delete(objects).where(eq(objects.apId, object));
    const receipt = await db.select().from(inboundObjectDeletions);
    expect(receipt).toHaveLength(1);
    await client.executeMultiple(migration);
    expect(await db.select().from(inboundObjectDeletions)).toEqual(receipt);
    expect(
      (
        await client.execute(
          "PRAGMA foreign_key_list(inbound_object_deletions)",
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (await client.execute("PRAGMA foreign_key_check")).rows,
    ).toHaveLength(0);
  } finally {
    client.close();
  }
});
