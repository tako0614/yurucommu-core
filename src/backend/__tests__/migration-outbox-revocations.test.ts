import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";

const root = new URL("../../../migrations/", import.meta.url);
const migration = "0032_outbox_revocations.sql";
const target = "https://object-host.example/note";
const author = "https://author-host.example/users/remote";
const booster = "https://yuru.test/ap/users/booster";

test("0032 preserves populated history and atomically revokes deleted-object publication without changing reserved activities", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.execute("PRAGMA foreign_keys = ON");
    const names = (await readdir(root))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    for (const name of names.filter((name) => name < migration)) {
      await client.executeMultiple(await readFile(new URL(name, root), "utf8"));
    }
    await client.execute({
      sql: "INSERT INTO objects (ap_id, type, attributed_to, content) VALUES (?, 'Note', ?, 'retained')",
      args: [target, author],
    });
    for (const type of [
      "Create",
      "Update",
      "Announce",
      "Undo",
      "Delete",
      "Like",
    ]) {
      await client.execute({
        sql: "INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction) VALUES (?, ?, ?, ?, ?, ?)",
        args: [
          type,
          type,
          booster,
          target,
          JSON.stringify({ type, object: target }),
          type === "Announce" ? null : "outbound",
        ],
      });
    }
    await client.execute({
      sql: "INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction) VALUES ('legacy-unknown', 'Announce', ?, 'https://unknown.example/note', '{}', 'outbound')",
      args: [booster],
    });
    const history = (
      await client.execute("SELECT * FROM activities ORDER BY ap_id")
    ).rows;
    const object = (await client.execute("SELECT * FROM objects")).rows;
    const sql = await readFile(new URL(migration, root), "utf8");
    await client.executeMultiple(sql);
    await client.executeMultiple(sql);
    expect(
      (await client.execute("SELECT * FROM activities ORDER BY ap_id")).rows,
    ).toEqual(history);
    expect((await client.execute("SELECT * FROM objects")).rows).toEqual(
      object,
    );
    expect(
      (await client.execute("SELECT * FROM outbox_revocations")).rows,
    ).toEqual([]);

    // A reserved booster must not block another author's object deletion. The
    // sidecar does not UPDATE that booster's protected ledger row.
    await client.execute({
      sql: "INSERT INTO account_deletion_targets (actor_ap_id, operation_id, public_key_pem, followers_url, delete_activity_ap_id) VALUES (?, 'reserved', 'pub', 'followers', 'delete')",
      args: [booster],
    });
    await expect(
      client.execute(
        "UPDATE activities SET processed = 1 WHERE ap_id = 'Announce'",
      ),
    ).rejects.toThrow("account deletion reserved");
    // Fail after the delete, proving both the object and trigger effect roll
    // back in the same atomic SQL batch. Then retry the exact deletion.
    await expect(
      client.batch(
        [
          { sql: "DELETE FROM objects WHERE ap_id = ?", args: [target] },
          "INSERT INTO outbox_revocations (activity_ap_id) VALUES (NULL)",
        ],
        "write",
      ),
    ).rejects.toThrow();
    expect((await client.execute("SELECT * FROM objects")).rows).toEqual(
      object,
    );
    expect(
      (await client.execute("SELECT * FROM outbox_revocations")).rows,
    ).toEqual([]);
    await client.execute({
      sql: "DELETE FROM objects WHERE ap_id = ?",
      args: [target],
    });
    expect(
      (
        await client.execute(
          "SELECT activity_ap_id FROM outbox_revocations ORDER BY activity_ap_id",
        )
      ).rows.map((row) => row.activity_ap_id),
    ).toEqual(["Announce", "Create", "Update"]);
    expect(
      (await client.execute("SELECT * FROM activities ORDER BY ap_id")).rows,
    ).toEqual(history);
    expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
    const plan = (
      await client.execute({
        sql: "EXPLAIN QUERY PLAN SELECT ap_id FROM activities WHERE object_ap_id = ? AND type IN ('Create', 'Update', 'Announce')",
        args: [target],
      })
    ).rows;
    expect(
      plan.some((row) =>
        /SEARCH activities USING INDEX .*object/.test(String(row.detail)),
      ),
    ).toBe(true);
    // Only the reserved operation owner may reap its Activity history.
    await client.execute(
      "INSERT INTO actor_write_assertions (id, witness, operation_id) VALUES ('worker', 1, 'reserved')",
    );
    await client.execute("DELETE FROM activities WHERE ap_id = 'Announce'");
    expect(
      (
        await client.execute(
          "SELECT activity_ap_id FROM outbox_revocations ORDER BY activity_ap_id",
        )
      ).rows.map((row) => row.activity_ap_id),
    ).toEqual(["Create", "Update"]);
  } finally {
    client.close();
  }
});
