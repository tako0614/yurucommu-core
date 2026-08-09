import { expect, test } from "bun:test";

import {
  blocks,
  type D1Statement,
  insertMany,
  mutes,
  objects,
  runBatch,
} from "../../../db/index.ts";
import { excludeBlockedMutedAuthors } from "../../lib/feed-exclude.ts";
import { blockActorAndSeverFollowPair } from "../../lib/follow-edge-mutations.ts";
import {
  anyOwnerSuppressesInboundActor,
  canonicalPersonalModerationActorId,
  deletePersonalActorBlock,
  deletePersonalActorMute,
  LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT,
  personalActorIsBlockedBy,
  personalActorIsSuppressedBy,
  resolveRetainedPersonalBlockTarget,
  resolveRetainedPersonalMuteTarget,
} from "../../lib/personal-actor-moderation.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const OWNER = "https://yuru.test/ap/users/owner";
const ACTOR = "https://remote.example/users/alice";
const COSMETIC_ACTOR = "https://REMOTE.example:443/users/alice/#profile";
const MUTED_ACTOR = "https://remote.example/users/bob";
const COSMETIC_MUTED_ACTOR = "https://REMOTE.example:443/users/bob/#profile";

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

test("moderation decisions do not forget a cosmetic relation behind the legacy mutation scan bound", async () => {
  const { db } = await createTestDb();
  const rows = [
    {
      blockerApId: OWNER,
      blockedApId: COSMETIC_ACTOR,
      createdAt: "2020-01-01T00:00:00.000Z",
    },
    ...Array.from(
      { length: LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT },
      (_, index) => ({
        blockerApId: OWNER,
        blockedApId: `https://decoy-${index}.example/users/actor`,
        createdAt: "2026-08-09T00:00:00.000Z",
      }),
    ),
  ];
  await runBatch(
    db,
    insertMany(db, blocks, rows) as [D1Statement, ...D1Statement[]],
  );
  const muteRows = [
    {
      muterApId: OWNER,
      mutedApId: COSMETIC_MUTED_ACTOR,
      createdAt: "2020-01-01T00:00:00.000Z",
    },
    ...Array.from(
      { length: LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT },
      (_, index) => ({
        muterApId: OWNER,
        mutedApId: `https://mute-decoy-${index}.example/users/actor`,
        createdAt: "2026-08-09T00:00:00.000Z",
      }),
    ),
  ];
  await runBatch(
    db,
    insertMany(db, mutes, muteRows) as [D1Statement, ...D1Statement[]],
  );

  expect(
    await Promise.all([
      personalActorIsBlockedBy(db, OWNER, ACTOR),
      personalActorIsSuppressedBy(db, OWNER, ACTOR),
      personalActorIsSuppressedBy(db, OWNER, MUTED_ACTOR),
      anyOwnerSuppressesInboundActor(db, ACTOR),
      anyOwnerSuppressesInboundActor(db, MUTED_ACTOR),
    ]),
  ).toEqual([true, true, true, true, true]);
});

test("personal moderation mutations retain and remove cosmetic relations older than the legacy scan bound", async () => {
  const { db } = await createTestDb();
  await runBatch(
    db,
    insertMany(db, blocks, [
      {
        blockerApId: OWNER,
        blockedApId: COSMETIC_ACTOR,
        createdAt: "2020-01-01T00:00:00.000Z",
      },
      ...Array.from(
        { length: LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT },
        (_, index) => ({
          blockerApId: OWNER,
          blockedApId: `https://block-decoy-${index}.example/users/actor`,
          createdAt: "2026-08-09T00:00:00.000Z",
        }),
      ),
    ]) as [D1Statement, ...D1Statement[]],
  );
  await runBatch(
    db,
    insertMany(db, mutes, [
      {
        muterApId: OWNER,
        mutedApId: COSMETIC_MUTED_ACTOR,
        createdAt: "2020-01-01T00:00:00.000Z",
      },
      ...Array.from(
        { length: LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT },
        (_, index) => ({
          muterApId: OWNER,
          mutedApId: `https://mute-decoy-${index}.example/users/actor`,
          createdAt: "2026-08-09T00:00:00.000Z",
        }),
      ),
    ]) as [D1Statement, ...D1Statement[]],
  );

  expect(await resolveRetainedPersonalBlockTarget(db, OWNER, ACTOR)).toBe(
    COSMETIC_ACTOR,
  );
  expect(await resolveRetainedPersonalMuteTarget(db, OWNER, MUTED_ACTOR)).toBe(
    COSMETIC_MUTED_ACTOR,
  );

  await blockActorAndSeverFollowPair(db, OWNER, ACTOR);
  const retainedMute = await resolveRetainedPersonalMuteTarget(
    db,
    OWNER,
    MUTED_ACTOR,
  );
  await db
    .insert(mutes)
    .values({ muterApId: OWNER, mutedApId: retainedMute ?? MUTED_ACTOR })
    .onConflictDoNothing();

  expect(
    (await db.select().from(blocks)).filter((row) =>
      [ACTOR, COSMETIC_ACTOR].includes(row.blockedApId),
    ),
  ).toHaveLength(1);
  expect(
    (await db.select().from(mutes)).filter((row) =>
      [MUTED_ACTOR, COSMETIC_MUTED_ACTOR].includes(row.mutedApId),
    ),
  ).toHaveLength(1);

  await deletePersonalActorBlock(db, OWNER, ACTOR);
  await deletePersonalActorMute(db, OWNER, MUTED_ACTOR);

  expect(await personalActorIsBlockedBy(db, OWNER, ACTOR)).toBe(false);
  expect(await personalActorIsSuppressedBy(db, OWNER, MUTED_ACTOR)).toBe(false);
  expect(await db.select().from(blocks)).toHaveLength(
    LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT,
  );
  expect(await db.select().from(mutes)).toHaveLength(
    LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT,
  );
});

test("read exclusion expands cosmetic identities but keeps path, query, and credential siblings distinct", async () => {
  const { db } = await createTestDb();
  await db.insert(blocks).values([
    { blockerApId: OWNER, blockedApId: COSMETIC_ACTOR },
    {
      blockerApId: OWNER,
      blockedApId: "https://User@remote.example/users/credential",
    },
  ]);
  await db.insert(mutes).values({
    muterApId: OWNER,
    mutedApId: "https://REMOTE.example:443/users/bob?view=One#profile",
  });

  const authors = {
    canonical: ACTOR,
    rawCosmetic: COSMETIC_ACTOR,
    pathSibling: "https://remote.example/users/Alice",
    queryMatch: "https://remote.example/users/bob?view=One",
    querySibling: "https://remote.example/users/bob?view=one",
    credentialExact: "https://User@remote.example/users/credential",
    credentialSibling: "https://user@remote.example/users/credential",
  } as const;
  for (const [name, attributedTo] of Object.entries(authors)) {
    await db.insert(objects).values({
      apId: `https://yuru.test/ap/objects/${name}`,
      type: "Note",
      attributedTo,
      content: name,
      visibility: "public",
      isLocal: 0,
    });
  }

  const visible = await db
    .select({ author: objects.attributedTo })
    .from(objects)
    .where(excludeBlockedMutedAuthors(OWNER)!);
  expect(visible.map((row) => row.author).sort()).toEqual(
    [
      authors.pathSibling,
      authors.querySibling,
      authors.credentialSibling,
    ].sort(),
  );
});
