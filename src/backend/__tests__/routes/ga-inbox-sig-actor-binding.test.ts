import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actorCache } from "../../../db/index.ts";
import { generateKeyPair, signRequest } from "../../lib/ap-signing.ts";
import { createYurucommuBackendApp } from "../../index.ts";
import {
  isActorMismatch,
  signingActorFromKeyId,
} from "../../routes/activitypub/inbox.ts";

// DEEP round-2 #1 (HIGH): the HTTP-signature signer→actor binding accepted ANY
// signer that merely shared the same URL host as the activity actor
// ("domain-level key delegation"). On a multi-user remote host that let an
// attacker who controls one key (alice#main-key) sign an activity claiming
// `actor=victim` on the same host and have it accepted AS the victim —
// cross-actor impersonation (forged Delete, DM-as-victim, Move follower theft).
// The fix binds keyId-owner === activity.actor EXACTLY (after normalization),
// matching Mastodon/Lemmy, while still accepting the normal keyId===actor case
// (incl. relayed Announce signed by the relaying actor itself).

const APP_URL = "https://yuru.test";
const ALICE = "https://remote.example/users/alice";
const ALICE_KEY = `${ALICE}#main-key`;
const VICTIM = "https://remote.example/users/victim";
const RELAY = "https://relay.example/actor";
const RELAY_KEY = `${RELAY}#main-key`;

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function cacheKey(db: Database, apId: string, publicKeyPem: string) {
  await db.insert(actorCache).values({
    apId,
    type: "Person",
    inbox: `${apId}/inbox`,
    publicKeyPem,
    publicKeyId: `${apId}#main-key`,
    rawJson: "{}",
    // Fresh so fetchActorPublicKey resolves from cache (no network).
    lastFetchedAt: new Date().toISOString(),
  });
}

async function postSigned(
  db: Database,
  privateKeyPem: string,
  keyId: string,
  path: string,
  activity: Record<string, unknown>,
): Promise<Response> {
  const app = createYurucommuBackendApp();
  const url = `${APP_URL}${path}`;
  const body = JSON.stringify(activity);
  const signed = await signRequest(privateKeyPem, keyId, "POST", url, body);
  const headers: Record<string, string> = {
    ...signed,
    "content-type": "application/activity+json",
    "content-length": String(new TextEncoder().encode(body).length),
  };
  const env = { DB_INSTANCE: db, APP_URL, ENVIRONMENT: "test" } as never;
  return app.fetch(new Request(url, { method: "POST", headers, body }), env);
}

// ---------------------------------------------------------------------------
// Unit: the exact-binding predicate
// ---------------------------------------------------------------------------

test("isActorMismatch: same-host different-actor delegation is REJECTED", () => {
  // The core bug: signing key owner = alice, claimed actor = victim, same host.
  expect(isActorMismatch(signingActorFromKeyId(ALICE_KEY), VICTIM)).toBe(true);
});

test("isActorMismatch: exact keyId-owner === actor is accepted", () => {
  expect(isActorMismatch(signingActorFromKeyId(ALICE_KEY), ALICE)).toBe(false);
});

test("isActorMismatch: cosmetic differences (trailing slash, host case) accepted", () => {
  expect(isActorMismatch("https://remote.example/users/alice/", ALICE)).toBe(
    false,
  );
  expect(isActorMismatch("https://REMOTE.example/users/alice", ALICE)).toBe(
    false,
  );
});

test("isActorMismatch: missing signer and cross-host are rejected", () => {
  expect(isActorMismatch(undefined, ALICE)).toBe(true);
  expect(isActorMismatch("https://other.example/users/alice", ALICE)).toBe(
    true,
  );
});

// ---------------------------------------------------------------------------
// End-to-end through the real signed inbox pipeline
// ---------------------------------------------------------------------------

test("E2E: forged Create as a same-host victim (signed by alice) is rejected 401", async () => {
  const db = await freshDb();
  const alice = await generateKeyPair();
  await cacheKey(db, ALICE, alice.publicKeyPem);

  // Attacker holds alice's key, claims actor=victim on the same host.
  const res = await postSigned(
    db,
    alice.privateKeyPem,
    ALICE_KEY,
    "/ap/inbox",
    {
      id: `${VICTIM}/dm/1`,
      type: "Create",
      actor: VICTIM,
      object: {
        id: `${VICTIM}/notes/1`,
        type: "Note",
        attributedTo: VICTIM,
        content: "forged DM as victim",
      },
    },
  );
  expect(res.status).toBe(401);
  expect((await res.json()).error).toBe("Actor mismatch");
});

test("E2E: forged Delete as a same-host victim (signed by alice) is rejected 401", async () => {
  const db = await freshDb();
  const alice = await generateKeyPair();
  await cacheKey(db, ALICE, alice.publicKeyPem);

  const res = await postSigned(
    db,
    alice.privateKeyPem,
    ALICE_KEY,
    "/ap/inbox",
    {
      id: `${VICTIM}#delete`,
      type: "Delete",
      actor: VICTIM,
      object: VICTIM,
    },
  );
  expect(res.status).toBe(401);
  expect((await res.json()).error).toBe("Actor mismatch");
});

test("E2E: a normal activity where keyId-owner === actor is accepted (202)", async () => {
  const db = await freshDb();
  const alice = await generateKeyPair();
  await cacheKey(db, ALICE, alice.publicKeyPem);

  const res = await postSigned(
    db,
    alice.privateKeyPem,
    ALICE_KEY,
    "/ap/inbox",
    {
      id: `${ALICE}/notes/1/activity`,
      type: "Create",
      actor: ALICE,
      object: {
        id: `${ALICE}/notes/1`,
        type: "Note",
        attributedTo: ALICE,
        content: "hello",
      },
    },
  );
  // No local followers of alice → honest no-op, but the binding gate passed.
  expect(res.status).toBe(202);
});

test("E2E: a relayed Announce signed by the relaying actor itself is accepted (202)", async () => {
  const db = await freshDb();
  const relay = await generateKeyPair();
  await cacheKey(db, RELAY, relay.publicKeyPem);

  // The legitimate relay case: the Announce actor IS the relay actor, and it
  // signs with its own key (keyId-owner === actor). This must keep working.
  const res = await postSigned(
    db,
    relay.privateKeyPem,
    RELAY_KEY,
    "/ap/inbox",
    {
      id: `${RELAY}/announces/1`,
      type: "Announce",
      actor: RELAY,
      object: "https://remote.example/users/alice/notes/1",
    },
  );
  expect(res.status).toBe(202);
});
