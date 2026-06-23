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

// Audit #12 finding #2: member auto-provisioning is CLOSED by default on a
// single-user instance. Once the owner exists, a brand-new external subject must
// NOT be able to self-provision a member account just by completing the issuer's
// OAuth flow (on a shared issuer that would let the whole population register).
test("member auto-provisioning is CLOSED by default: a second (non-allowlisted) login is REFUSED", async () => {
  const db = await freshDb();
  await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    userInfo("sub-operator"),
    "sub-operator",
  );
  const refused = await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    { id: "sub-guest", name: "Guest", username: "guest" },
    "sub-guest",
  );
  expect(refused).toBeNull();
});

test("a second login with NO owner pin set is also refused (registration closed by default)", async () => {
  const db = await freshDb();
  await createActorFromOAuth(
    db,
    envWith({}),
    userInfo("sub-owner"),
    "sub-owner",
  );
  const refused = await createActorFromOAuth(
    db,
    envWith({}),
    { id: "sub-guest", name: "Guest", username: "guest" },
    "sub-guest",
  );
  expect(refused).toBeNull();
});

test("a subject in OIDC_ALLOWED_SUBS CAN auto-provision a member after the owner exists", async () => {
  const db = await freshDb();
  await createActorFromOAuth(
    db,
    envWith({ OIDC_OWNER_SUB: "sub-operator" }),
    userInfo("sub-operator"),
    "sub-operator",
  );
  const member = await createActorFromOAuth(
    db,
    envWith({
      OIDC_OWNER_SUB: "sub-operator",
      OIDC_ALLOWED_SUBS: "sub-other, sub-guest",
    }),
    { id: "sub-guest", name: "Guest", username: "guest" },
    "sub-guest",
  );
  expect(member?.role).toBe("member");
});

// Audit #16 #11: the OAuth/OIDC login path is the one write to actors.name /
// iconUrl that escaped the profile caps every other path enforces. A malicious /
// multi-tenant issuer must not push an unbounded display name or a
// validator-bypassing icon URL into the local row (served + federated verbatim).
test("OAuth profile: oversized name is capped to 50 and an invalid icon URL is dropped", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({}),
    {
      id: "sub-evil",
      name: "X".repeat(500),
      username: "operator",
      picture: "javascript:alert(1)",
    },
    "sub-evil",
  );
  expect(actor).toBeTruthy();
  expect(actor?.name?.length).toBe(50);
  expect(actor?.iconUrl).toBeNull();
});

test("OAuth profile: a valid https picture is accepted", async () => {
  const db = await freshDb();
  const actor = await createActorFromOAuth(
    db,
    envWith({}),
    {
      id: "sub-ok",
      name: "Operator",
      username: "operator",
      picture: "https://cdn.example/avatar.png",
    },
    "sub-ok",
  );
  expect(actor?.iconUrl).toBe("https://cdn.example/avatar.png");
});
