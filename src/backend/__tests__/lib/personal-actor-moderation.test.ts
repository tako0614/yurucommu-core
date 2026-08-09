import { expect, test } from "bun:test";

import { blocks, mutes } from "../../../db/index.ts";
import {
  anyOwnerSuppressesInboundActor,
  canonicalPersonalModerationActorId,
  deletePersonalActorBlock,
  deletePersonalActorMute,
  personalActorIsBlockedBy,
  personalActorIsSuppressedBy,
} from "../../lib/personal-actor-moderation.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const OWNER = "https://yuru.test/ap/users/owner";
const ACTOR = "https://remote.example/users/alice";
const COSMETIC_ACTOR = "https://REMOTE.example:443/users/alice/#profile";

test("personal moderation canonicalizes only accepted cosmetic actor differences", () => {
  expect(canonicalPersonalModerationActorId(COSMETIC_ACTOR)).toBe(ACTOR);
  expect(
    canonicalPersonalModerationActorId("https://remote.example/users/Alice"),
  ).toBe("https://remote.example/users/Alice");
  expect(canonicalPersonalModerationActorId("legacy-non-url-id")).toBe(
    "legacy-non-url-id",
  );
});

test("legacy cosmetic block and mute rows suppress and delete by verified actor identity", async () => {
  const { db } = await createTestDb();
  await db.insert(blocks).values([
    { blockerApId: OWNER, blockedApId: COSMETIC_ACTOR },
    { blockerApId: OWNER, blockedApId: ACTOR },
  ]);
  await db.insert(mutes).values([
    { muterApId: OWNER, mutedApId: COSMETIC_ACTOR },
    { muterApId: OWNER, mutedApId: ACTOR },
  ]);

  expect(await personalActorIsBlockedBy(db, OWNER, ACTOR)).toBe(true);
  expect(await personalActorIsSuppressedBy(db, OWNER, ACTOR)).toBe(true);
  expect(await anyOwnerSuppressesInboundActor(db, ACTOR)).toBe(true);

  await deletePersonalActorBlock(db, OWNER, ACTOR);
  await deletePersonalActorMute(db, OWNER, ACTOR);
  expect(await db.select().from(blocks)).toEqual([]);
  expect(await db.select().from(mutes)).toEqual([]);
});

test("personal moderation never folds actor path case", async () => {
  const { db } = await createTestDb();
  await db.insert(blocks).values({
    blockerApId: OWNER,
    blockedApId: "https://remote.example/users/Alice",
  });

  expect(await personalActorIsBlockedBy(db, OWNER, ACTOR)).toBe(false);
  expect(await anyOwnerSuppressesInboundActor(db, ACTOR)).toBe(false);
});
