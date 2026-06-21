import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * Owner-slot protection for OAuth/OIDC login.
 *
 * yurucommu is single-tenant: the FIRST actor created becomes `owner`. On an
 * OIDC-seeded Capsule a third party who can obtain a valid token for the
 * materialized client could otherwise race the operator for that slot. When
 * `OIDC_OWNER_SUB` pins the operator's subject, only that subject may take the
 * owner slot; any other first-login is REFUSED (returns null, not downgraded to
 * member — downgrading would consume the owner slot and lock the operator out).
 * With no pin set, first-login-owner is preserved.
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors } from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import { createActorFromOAuth } from "../../routes/auth-helpers.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0007_moderation_reports.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function envWith(extra: Partial<Env>): Env {
  return { APP_URL, ...extra } as unknown as Env;
}

const userInfo = (id: string) => ({
  id,
  name: "Operator",
  username: "operator",
});

test("no owner pin: first OAuth login becomes owner (legacy)", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({}),
    userInfo("sub-anyone"),
    "sub-anyone",
  );
  expect(actor).toBeTruthy();
  expect(actor?.role).toBe("owner");
});

test("OIDC_OWNER_SUB set: matching first login becomes owner", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    userInfo("sub-operator"),
    "sub-operator",
  );
  expect(actor?.role).toBe("owner");
});

test("OIDC_OWNER_SUB set: a non-matching first login is REFUSED (owner slot preserved)", async () => {
  const db = await freshDb();
  const refused = await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    userInfo("sub-attacker"),
    "sub-attacker",
  );
  expect(refused).toBeNull();
  // No actor row was consumed — the owner slot is still open for the operator.
  const count = (await db.select().from(actors).all()).length;
  expect(count).toBe(0);

  // …and the real operator can still claim owner afterwards.
  const owner = await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    userInfo("sub-operator"),
    "sub-operator",
  );
  expect(owner?.role).toBe("owner");
});

test("TAKOSUMI_ACCOUNTS_OWNER_SUB is honored as the pin too", async () => {
  const db = await freshDb();
  const refused = await createActorFromOAuth(
    db,
    envWith({ TAKOSUMI_ACCOUNTS_OWNER_SUB: "sub-operator" }),
    userInfo("sub-attacker"),
    "sub-attacker",
  );
  expect(refused).toBeNull();
});

test("pin only guards the owner slot: a second login is a normal member regardless", async () => {
  const db = await freshDb();
  await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    userInfo("sub-operator"),
    "sub-operator",
  );
  const member = await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    { id: "sub-guest", name: "Guest", username: "guest" },
    "sub-guest",
  );
  expect(member?.role).toBe("member");
});
