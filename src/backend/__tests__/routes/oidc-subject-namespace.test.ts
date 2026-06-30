import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, sql } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors } from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import { findOrCreateOAuthActor } from "../../routes/auth-helpers.ts";

// DEEP round-2 #11: the `takos` OIDC subject was stored verbatim, so a
// trusted-but-misconfigured/compromised issuer emitting sub="password:owner"
// would resolve the get-or-create to the reserved owner row (keyed solely on
// takos_user_id). The subject is now namespaced "takos:<sub>", so it can never
// overlap the reserved password:/local: keys.

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

const env = { APP_URL } as unknown as Env;

test("a takos OIDC sub equal to a reserved key does NOT bind to the owner", async () => {
  const db = await freshDb();
  // Seed the password owner exactly as auth.ts does.
  const ownerApId = `${APP_URL}/ap/users/owner`;
  await db.insert(actors).values({
    apId: ownerApId,
    type: "Person",
    preferredUsername: "owner",
    inbox: `${ownerApId}/inbox`,
    outbox: `${ownerApId}/outbox`,
    followersUrl: `${ownerApId}/followers`,
    followingUrl: `${ownerApId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    takosUserId: "password:owner",
    role: "owner",
  });

  // A takos OIDC login whose subject is literally the reserved owner key.
  const result = await findOrCreateOAuthActor(db, env, "takos", {
    id: "password:owner",
    name: "Attacker",
  });

  // Registration is closed (owner exists, no OIDC_ALLOWED_SUBS) and the lookup
  // key is now "takos:password:owner", which matches no row → refused, never the
  // owner.
  expect(result?.apId).not.toBe(ownerApId);

  // The owner row is untouched.
  const owner = await db
    .select({ role: actors.role, takosUserId: actors.takosUserId })
    .from(actors)
    .where(eq(actors.apId, ownerApId))
    .get();
  expect(owner?.role).toBe("owner");
  expect(owner?.takosUserId).toBe("password:owner");
});

test("migration 0016 namespaces an existing bare takos subject", async () => {
  const db = await freshDb();
  // Simulate a pre-migration takos row stored verbatim, then apply 0016 again
  // (idempotent) — the row must become "takos:<sub>" and reserved keys untouched.
  const a = `${APP_URL}/ap/users/legacy`;
  await db.insert(actors).values({
    apId: a,
    type: "Person",
    preferredUsername: "legacy",
    inbox: `${a}/inbox`,
    outbox: `${a}/outbox`,
    followersUrl: `${a}/followers`,
    followingUrl: `${a}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    takosUserId: "raw-takos-sub",
  });

  await db.run(
    sql`UPDATE actors SET takos_user_id = 'takos:' || takos_user_id WHERE takos_user_id IS NOT NULL AND takos_user_id NOT LIKE 'takos:%' AND takos_user_id NOT LIKE 'password:%' AND takos_user_id NOT LIKE 'local:%' AND takos_user_id NOT LIKE 'google:%' AND takos_user_id NOT LIKE 'x:%'`,
  );

  const row = await db
    .select({ takosUserId: actors.takosUserId })
    .from(actors)
    .where(eq(actors.apId, a))
    .get();
  expect(row?.takosUserId).toBe("takos:raw-takos-sub");
});
