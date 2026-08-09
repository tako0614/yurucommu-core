import { expect, test } from "bun:test";

import type { Database } from "../../../../db/index.ts";
import { activities } from "../../../../db/index.ts";
import { resolveInboundActivityReference } from "../../../routes/activitypub/inbound-activity-reference.ts";
import { createTestDb } from "../../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const ALICE = "https://peer.example/users/alice";
const MALLORY = "https://peer.example/users/mallory";
const WIRE_ID = "https://peer.example/activities/shared-id";
const ALICE_INTERNAL = `${APP_URL}/ap/activities/inbound-alice`;
const MALLORY_INTERNAL = `${APP_URL}/ap/activities/inbound-mallory`;

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

test("resolves a retained wire id within the verified actor despite sibling collisions and corrupt legacy JSON", async () => {
  const db = await freshDb();
  await db.insert(activities).values([
    {
      apId: `${APP_URL}/ap/activities/inbound-corrupt`,
      type: "Like",
      actorApId: ALICE,
      objectApId: `${APP_URL}/ap/objects/1`,
      rawJson: "{",
      direction: "inbound",
    },
    {
      apId: MALLORY_INTERNAL,
      type: "Like",
      actorApId: MALLORY,
      objectApId: `${APP_URL}/ap/objects/1`,
      rawJson: JSON.stringify({ id: WIRE_ID, type: "Like", actor: MALLORY }),
      direction: "inbound",
    },
    {
      apId: ALICE_INTERNAL,
      type: "Like",
      actorApId: ALICE,
      objectApId: `${APP_URL}/ap/objects/1`,
      rawJson: JSON.stringify({ id: WIRE_ID, type: "Like", actor: ALICE }),
      direction: "inbound",
    },
  ]);

  expect(
    await resolveInboundActivityReference(db, WIRE_ID, ALICE, APP_URL),
  ).toBe(ALICE_INTERNAL);
  expect(
    await resolveInboundActivityReference(db, WIRE_ID, MALLORY, APP_URL),
  ).toBe(MALLORY_INTERNAL);
  expect(
    await resolveInboundActivityReference(db, ALICE_INTERNAL, ALICE, APP_URL),
  ).toBe(ALICE_INTERNAL);
  expect(
    await resolveInboundActivityReference(db, ALICE_INTERNAL, MALLORY, APP_URL),
  ).toBeNull();
});

test("rejects an oversized reference before retained-envelope lookup", async () => {
  const db = await freshDb();
  expect(
    await resolveInboundActivityReference(
      db,
      `https://peer.example/${"x".repeat(2048)}`,
      ALICE,
      APP_URL,
    ),
  ).toBeNull();
});
