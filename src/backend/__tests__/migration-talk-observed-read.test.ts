import { expect, test } from "bun:test";
import {
  createTestDb,
  listMigrationFiles,
  readMigration,
} from "./helpers/d1-semantics.ts";
import { readFile } from "node:fs/promises";

const migration = "0037_talk_observed_read.sql";
const before = "0036_notification_push_actor_fk_repair.sql";

for (const historical of [false, true]) {
  test(`0037 is additive/idempotent with ${historical ? "historical 3.2 push" : "current"} migration lineage`, async () => {
    const { client } = await createTestDb(
      historical ? { migrate: false } : { through: before },
    );
    try {
      if (historical) {
        for (const name of await listMigrationFiles()) {
          if (name > before) break;
          const body =
            name === "0019_notification_push_delivery.sql"
              ? await readFile(
                  new URL(
                    "./fixtures/core-3.2.0-0019_notification_push_delivery.sql",
                    import.meta.url,
                  ),
                  "utf8",
                )
              : await readMigration(name);
          await client.executeMultiple(body);
        }
      }
      await client.execute(
        "INSERT INTO objects (ap_id, type, attributed_to, content, visibility, conversation, published) VALUES ('https://remote.test/message', 'Note', 'https://remote.test/actor', 'retained', 'direct', 'old-conversation', '2020-01-01T00:00:00Z')",
      );
      await client.execute(
        "INSERT INTO dm_read_status (actor_ap_id, conversation_id, last_read_at) VALUES ('https://local.test/reader', 'old-conversation', '2021-01-01T00:00:00Z')",
      );
      await client.execute(
        "INSERT INTO dm_archived_conversations (actor_ap_id, conversation_id, archived_at) VALUES ('https://local.test/reader', 'old-conversation', '2020-02-03T00:00:00Z')",
      );
      const tables = [
        "objects",
        "dm_read_status",
        "dm_community_read_status",
        "dm_archived_conversations",
        "notification_pushers",
        "notification_push_jobs",
        "account_deletion_targets",
      ];
      const snapshot = async () =>
        Promise.all(
          tables.map(
            async (name) =>
              (await client.execute(`SELECT * FROM ${name}`)).rows,
          ),
        );
      const original = await snapshot();
      await client.executeMultiple(await readMigration(migration));
      await client.executeMultiple(await readMigration(migration));
      expect(await snapshot()).toEqual(original);
      for (const name of [
        "talk_read_modes",
        "talk_message_reads",
        "talk_read_assertions",
        "dm_peer_archived_conversations",
        "dm_archive_expansions",
      ]) {
        expect((await client.execute(`SELECT * FROM ${name}`)).rows).toEqual(
          [],
        );
      }
      expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual(
        [],
      );
      expect(
        (await client.execute("PRAGMA foreign_keys")).rows[0].foreign_keys,
      ).toBe(1);
    } finally {
      client.close();
    }
  });
}
