import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  activities,
  actors,
  announces,
  bookmarks,
  follows,
  likes,
  objects,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import {
  purgeActorContent,
  purgeDomainContent,
} from "../../lib/blocklist-purge.ts";
import { blockDomain, isActorBlocked } from "../../lib/blocklist.ts";

// ---------------------------------------------------------------------------
// Audit #25 finding C — defederation must purge already-ingested content (the
// operator blocklist was otherwise ingest/delivery-only, leaving a blocked
// actor's/domain's prior posts live in timelines/search/object-serving) AND a
// domain block must cover subdomains.
// ---------------------------------------------------------------------------

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

async function seedActor(db: Database, apId: string, username: string) {
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
}

async function seedPost(db: Database, apId: string, author: string) {
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content: "x",
    visibility: "public",
    isLocal: 0,
  });
}

async function objectExists(db: Database, apId: string): Promise<boolean> {
  const row = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, apId))
    .get();
  return !!row;
}

async function activityExists(db: Database, apId: string): Promise<boolean> {
  const row = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(eq(activities.apId, apId))
    .get();
  return !!row;
}

async function seedInteractionSurface(
  db: Database,
  actorApIds: string[],
  suffix: string,
) {
  const localActor = `https://yuru.test/ap/users/local-${suffix}`;
  const postApId = `https://yuru.test/ap/objects/post-${suffix}`;
  const storyApId = `https://yuru.test/ap/objects/story-${suffix}`;
  await seedActor(db, localActor, `local-${suffix}`);
  await db
    .update(actors)
    .set({
      followerCount: actorApIds.length,
      followingCount: actorApIds.length,
    })
    .where(eq(actors.apId, localActor));
  await db.insert(objects).values([
    {
      apId: postApId,
      type: "Note",
      attributedTo: localActor,
      content: "local post",
      visibility: "public",
      likeCount: actorApIds.length,
      announceCount: actorApIds.length,
      replyCount: actorApIds.length,
      isLocal: 1,
    },
    {
      apId: storyApId,
      type: "Story",
      attributedTo: localActor,
      content: "local story",
      visibility: "public",
      likeCount: actorApIds.length,
      shareCount: actorApIds.length,
      isLocal: 1,
    },
  ]);

  for (const [index, actorApId] of actorApIds.entries()) {
    await db.insert(objects).values({
      apId: `https://content.example/objects/reply-${suffix}-${index}`,
      type: "Note",
      attributedTo: actorApId,
      content: "remote reply",
      inReplyTo: postApId,
      visibility: "public",
      isLocal: 0,
    });
    await db.insert(likes).values([
      { actorApId, objectApId: postApId },
      { actorApId, objectApId: storyApId },
    ]);
    await db.insert(announces).values({ actorApId, objectApId: postApId });
    await db.insert(bookmarks).values({ actorApId, objectApId: postApId });
    await db.insert(storyViews).values({ actorApId, storyApId });
    await db.insert(storyVotes).values({
      id: `vote-${suffix}-${index}`,
      storyApId,
      actorApId,
      optionIndex: 0,
    });
    await db.insert(storyShares).values({
      id: `share-${suffix}-${index}`,
      storyApId,
      actorApId,
    });
    await db.insert(follows).values([
      {
        followerApId: actorApId,
        followingApId: localActor,
        status: "accepted",
      },
      {
        followerApId: localActor,
        followingApId: actorApId,
        status: "accepted",
      },
    ]);
  }

  return { localActor, postApId, storyApId };
}

async function interactionSnapshot(
  db: Database,
  surface: Awaited<ReturnType<typeof seedInteractionSurface>>,
) {
  const post = await db
    .select({
      likeCount: objects.likeCount,
      announceCount: objects.announceCount,
      replyCount: objects.replyCount,
    })
    .from(objects)
    .where(eq(objects.apId, surface.postApId))
    .get();
  const story = await db
    .select({
      likeCount: objects.likeCount,
      shareCount: objects.shareCount,
    })
    .from(objects)
    .where(eq(objects.apId, surface.storyApId))
    .get();
  const localActor = await db
    .select({
      followerCount: actors.followerCount,
      followingCount: actors.followingCount,
    })
    .from(actors)
    .where(eq(actors.apId, surface.localActor))
    .get();

  return {
    post,
    story,
    localActor,
    likeActors: (
      await db.select({ actorApId: likes.actorApId }).from(likes)
    ).map((row) => row.actorApId),
    announceActors: (
      await db.select({ actorApId: announces.actorApId }).from(announces)
    ).map((row) => row.actorApId),
    bookmarkActors: (
      await db.select({ actorApId: bookmarks.actorApId }).from(bookmarks)
    ).map((row) => row.actorApId),
    viewActors: (
      await db.select({ actorApId: storyViews.actorApId }).from(storyViews)
    ).map((row) => row.actorApId),
    voteActors: (
      await db.select({ actorApId: storyVotes.actorApId }).from(storyVotes)
    ).map((row) => row.actorApId),
    shareActors: (
      await db.select({ actorApId: storyShares.actorApId }).from(storyShares)
    ).map((row) => row.actorApId),
    followActors: (
      await db
        .select({
          followerApId: follows.followerApId,
          followingApId: follows.followingApId,
        })
        .from(follows)
    ).flatMap((row) => [row.followerApId, row.followingApId]),
  };
}

test("purgeActorContent removes the blocked actor's posts and leaves others", async () => {
  const db = await freshDb();
  const evil = "https://evil.example/users/x";
  const other = "https://other.example/users/y";
  await seedActor(db, evil, "x");
  await seedActor(db, other, "y");
  await seedPost(db, "https://evil.example/objects/1", evil);
  await seedPost(db, "https://evil.example/objects/2", evil);
  await seedPost(db, "https://other.example/objects/1", other);

  await purgeActorContent(db, evil);

  expect(await objectExists(db, "https://evil.example/objects/1")).toBe(false);
  expect(await objectExists(db, "https://evil.example/objects/2")).toBe(false);
  // An unrelated actor's content is untouched.
  expect(await objectExists(db, "https://other.example/objects/1")).toBe(true);
});

test("purgeActorContent removes every cosmetic author spelling but preserves a path-case sibling", async () => {
  const db = await freshDb();
  const canonical = "https://remote.example/users/alice";
  const cosmetic = "https://REMOTE.example:443/users/alice/#legacy";
  const pathCaseSibling = "https://remote.example/users/Alice";
  const targetPost = "https://remote.example/objects/cosmetic-target";
  const siblingPost = "https://remote.example/objects/path-case-sibling";
  await seedPost(db, targetPost, cosmetic);
  await seedPost(db, siblingPost, pathCaseSibling);
  await db.insert(activities).values([
    {
      apId: "https://remote.example/activities/cosmetic-target",
      type: "Create",
      actorApId: cosmetic,
      objectApId: targetPost,
      rawJson: "{}",
      direction: "inbound",
    },
    {
      apId: "https://remote.example/activities/path-case-sibling",
      type: "Create",
      actorApId: pathCaseSibling,
      objectApId: siblingPost,
      rawJson: "{}",
      direction: "inbound",
    },
  ]);

  await purgeActorContent(db, canonical);

  expect({
    targetPost: await objectExists(db, targetPost),
    siblingPost: await objectExists(db, siblingPost),
    remainingActivityActors: (
      await db.select({ actorApId: activities.actorApId }).from(activities)
    ).map((row) => row.actorApId),
  }).toEqual({
    targetPost: false,
    siblingPost: true,
    remainingActivityActors: [pathCaseSibling],
  });
});

test("purgeActorContent removes retained interaction edges and reconciles counters for every cosmetic spelling", async () => {
  const db = await freshDb();
  const canonical = "https://remote.example/users/alice";
  const cosmetic = "https://REMOTE.example:443/users/alice/#legacy";
  const pathCaseSibling = "https://remote.example/users/Alice";
  const safe = "https://safe.example/users/bob";
  const surface = await seedInteractionSurface(
    db,
    [canonical, cosmetic, pathCaseSibling, safe],
    "actor-purge",
  );

  await purgeActorContent(db, canonical);

  const snapshot = await interactionSnapshot(db, surface);
  expect(snapshot.post).toEqual({
    likeCount: 2,
    announceCount: 2,
    replyCount: 2,
  });
  expect(snapshot.story).toEqual({ likeCount: 2, shareCount: 2 });
  expect(snapshot.localActor).toEqual({ followerCount: 2, followingCount: 2 });
  for (const actorIds of [
    snapshot.likeActors,
    snapshot.announceActors,
    snapshot.bookmarkActors,
    snapshot.viewActors,
    snapshot.voteActors,
    snapshot.shareActors,
    snapshot.followActors,
  ]) {
    expect(actorIds).not.toContain(canonical);
    expect(actorIds).not.toContain(cosmetic);
    expect(actorIds).toContain(pathCaseSibling);
    expect(actorIds).toContain(safe);
  }
});

test("purgeActorContent drains more than two pages of cosmetic interaction spellings", async () => {
  const db = await freshDb();
  const canonical = "https://remote.example/users/alice";
  const localActor = "https://yuru.test/ap/users/cosmetic-pages";
  const objectApId = "https://yuru.test/ap/objects/cosmetic-pages";
  const aliases = Array.from(
    { length: 81 },
    (_, index) =>
      `https://REMOTE.example:443/users/alice/#legacy-${String(index).padStart(3, "0")}`,
  );
  await seedActor(db, localActor, "cosmetic-pages");
  await db.insert(objects).values({
    apId: objectApId,
    type: "Note",
    attributedTo: localActor,
    content: "local",
    likeCount: aliases.length,
    isLocal: 1,
  });
  for (const actorApId of aliases) {
    await db.insert(likes).values({ actorApId, objectApId });
  }

  expect(await purgeActorContent(db, canonical)).toEqual({
    complete: true,
    deletedObjects: 0,
    deletedActivities: 0,
  });
  expect(await db.select().from(likes)).toEqual([]);
  expect(
    await db
      .select({ likeCount: objects.likeCount })
      .from(objects)
      .where(eq(objects.apId, objectApId))
      .get(),
  ).toEqual({ likeCount: 0 });
});

test("purgeActorContent finds cosmetic actor rows across bounded history pages", async () => {
  const db = await freshDb();
  const canonical = "https://remote.example/users/alice";
  const cosmetic = "https://REMOTE.example:443/users/alice/#legacy";
  const targetCount = 181;
  const unrelatedCount = 513;

  for (let index = 0; index < unrelatedCount; index += 1) {
    const suffix = String(index).padStart(4, "0");
    const placement = index % 2 === 0 ? "aaa" : "zzz";
    const actor = `https://unrelated.example/users/${suffix}`;
    const objectApId = `https://content.example/${placement}-objects/${suffix}`;
    await seedPost(db, objectApId, actor);
    await db.insert(activities).values({
      apId: `https://content.example/${placement}-activities/${suffix}`,
      type: "Create",
      actorApId: actor,
      objectApId,
      rawJson: "{}",
      direction: "inbound",
    });
  }
  for (let index = 0; index < targetCount; index += 1) {
    const suffix = String(index).padStart(4, "0");
    const objectApId = `https://content.example/middle-objects/${suffix}`;
    await seedPost(db, objectApId, cosmetic);
    await db.insert(activities).values({
      apId: `https://content.example/middle-activities/${suffix}`,
      type: "Create",
      actorApId: cosmetic,
      objectApId,
      rawJson: "{}",
      direction: "inbound",
    });
  }

  const result = await purgeActorContent(db, canonical);

  expect(result).toEqual({
    complete: true,
    deletedObjects: targetCount,
    deletedActivities: targetCount,
  });
  expect(await db.select({ apId: objects.apId }).from(objects)).toHaveLength(
    unrelatedCount,
  );
  expect(
    await db.select({ apId: activities.apId }).from(activities),
  ).toHaveLength(unrelatedCount);
});

test("purgeActorContent reports bounded partial progress and converges on retry", async () => {
  const db = await freshDb();
  const actor = "https://retry.example/users/alice";
  const targetCount = 181;

  for (let index = 0; index < targetCount; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const objectApId = `https://retry.example/objects/${suffix}`;
    await seedPost(db, objectApId, actor);
    await db.insert(activities).values({
      apId: `https://retry.example/activities/${suffix}`,
      type: "Create",
      actorApId: actor,
      objectApId,
      rawJson: "{}",
      direction: "inbound",
    });
  }
  await db.run(
    sql.raw(`
      CREATE TRIGGER reject_second_actor_purge_chunk
      BEFORE DELETE ON objects
      WHEN OLD.ap_id = 'https://retry.example/objects/100'
      BEGIN
        SELECT RAISE(ABORT, 'simulated second-chunk purge failure');
      END
    `),
  );

  expect(await purgeActorContent(db, actor)).toEqual({
    complete: false,
    deletedObjects: 90,
    deletedActivities: 0,
  });
  expect(await db.select({ apId: objects.apId }).from(objects)).toHaveLength(
    91,
  );
  expect(
    await db.select({ apId: activities.apId }).from(activities),
  ).toHaveLength(targetCount);

  await db.run(sql`DROP TRIGGER reject_second_actor_purge_chunk`);
  expect(await purgeActorContent(db, actor)).toEqual({
    complete: true,
    deletedObjects: 91,
    deletedActivities: targetCount,
  });
  expect(await db.select({ apId: objects.apId }).from(objects)).toEqual([]);
  expect(await db.select({ apId: activities.apId }).from(activities)).toEqual(
    [],
  );
});

test("purgeDomainContent removes the host AND its subdomains but NOT a similarly-named domain", async () => {
  const db = await freshDb();
  const apex = "https://evil.example/users/a";
  const sub = "https://node1.evil.example/users/b";
  const lookalike = "https://notevil.example/users/c"; // must NOT be purged
  await seedActor(db, apex, "a");
  await seedActor(db, sub, "b");
  await seedActor(db, lookalike, "c");
  await seedPost(db, "https://evil.example/objects/p", apex);
  await seedPost(db, "https://node1.evil.example/objects/p", sub);
  await seedPost(db, "https://notevil.example/objects/p", lookalike);

  await purgeDomainContent(db, "evil.example");

  expect(await objectExists(db, "https://evil.example/objects/p")).toBe(false);
  expect(await objectExists(db, "https://node1.evil.example/objects/p")).toBe(
    false,
  );
  // `notevil.example` ends with `evil.example` but is NOT a subdomain of it.
  expect(await objectExists(db, "https://notevil.example/objects/p")).toBe(
    true,
  );
});

test("purgeDomainContent matches the same hostname boundary as block decisions", async () => {
  const db = await freshDb();
  const domain = "port-blocked.example";
  const blockedActorsWithNonCanonicalAuthorities = [
    `https://${domain}:8443/users/apex`,
    `https://node.${domain}:9443/users/subdomain`,
    `https://${domain}.:443/users/trailing-dot`,
    `http://legacy.${domain}:8080/users/http-actor`,
  ];
  const survivingActors = [
    `https://${domain}@safe.example/users/credential-lookalike`,
    `https://not${domain}:8443/users/suffix-lookalike`,
  ];

  for (const [index, actor] of [
    ...blockedActorsWithNonCanonicalAuthorities,
    ...survivingActors,
  ].entries()) {
    const objectApId = `https://content.example/objects/domain-boundary-${index}`;
    await seedPost(db, objectApId, actor);
    await db.insert(activities).values({
      apId: `https://content.example/activities/domain-boundary-${index}`,
      type: "Create",
      actorApId: actor,
      objectApId,
      rawJson: "{}",
      direction: "inbound",
    });
  }
  await blockDomain(db, domain, null);

  for (const actor of blockedActorsWithNonCanonicalAuthorities) {
    expect(await isActorBlocked(db, actor)).toBe(true);
  }
  for (const actor of survivingActors) {
    expect(await isActorBlocked(db, actor)).toBe(false);
  }

  const result = await purgeDomainContent(db, domain);

  expect(result).toEqual({
    complete: true,
    deletedObjects: blockedActorsWithNonCanonicalAuthorities.length,
    deletedActivities: blockedActorsWithNonCanonicalAuthorities.length,
  });
  expect(
    (await db.select({ attributedTo: objects.attributedTo }).from(objects))
      .map((row) => row.attributedTo)
      .sort(),
  ).toEqual([...survivingActors].sort());
  expect(
    (await db.select({ actorApId: activities.actorApId }).from(activities))
      .map((row) => row.actorApId)
      .sort(),
  ).toEqual([...survivingActors].sort());
});

test("purgeDomainContent removes retained interaction edges from the host and subdomains and reconciles counters", async () => {
  const db = await freshDb();
  const apex = "https://blocked.example/users/alice";
  const subdomain = "https://node.blocked.example/users/bob";
  const suffixLookalike = "https://notblocked.example/users/carol";
  const safe = "https://safe.example/users/dave";
  const surface = await seedInteractionSurface(
    db,
    [apex, subdomain, suffixLookalike, safe],
    "domain-purge",
  );

  await purgeDomainContent(db, "blocked.example");

  const snapshot = await interactionSnapshot(db, surface);
  expect(snapshot.post).toEqual({
    likeCount: 2,
    announceCount: 2,
    replyCount: 2,
  });
  expect(snapshot.story).toEqual({ likeCount: 2, shareCount: 2 });
  expect(snapshot.localActor).toEqual({ followerCount: 2, followingCount: 2 });
  for (const actorIds of [
    snapshot.likeActors,
    snapshot.announceActors,
    snapshot.bookmarkActors,
    snapshot.viewActors,
    snapshot.voteActors,
    snapshot.shareActors,
    snapshot.followActors,
  ]) {
    expect(actorIds).not.toContain(apex);
    expect(actorIds).not.toContain(subdomain);
    expect(actorIds).toContain(suffixLookalike);
    expect(actorIds).toContain(safe);
  }
});

test("purgeDomainContent commits interaction cleanup in bounded pages and converges after a failed page", async () => {
  const db = await freshDb();
  const localActor = "https://yuru.test/ap/users/domain-pages";
  const objectApId = "https://yuru.test/ap/objects/domain-pages";
  const actorApIds = Array.from(
    { length: 81 },
    (_, index) =>
      `https://node.bulk-interactions.example/users/${String(index).padStart(3, "0")}`,
  );
  await seedActor(db, localActor, "domain-pages");
  await db.insert(objects).values({
    apId: objectApId,
    type: "Note",
    attributedTo: localActor,
    content: "local",
    likeCount: actorApIds.length,
    isLocal: 1,
  });
  for (const actorApId of actorApIds) {
    await db.insert(likes).values({ actorApId, objectApId });
  }
  await db.run(
    sql.raw(`
      CREATE TRIGGER reject_second_domain_interaction_page
      BEFORE DELETE ON likes
      WHEN OLD.actor_ap_id = 'https://node.bulk-interactions.example/users/040'
      BEGIN
        SELECT RAISE(ABORT, 'simulated interaction-page purge failure');
      END
    `),
  );

  expect(await purgeDomainContent(db, "bulk-interactions.example")).toEqual({
    complete: false,
    deletedObjects: 0,
    deletedActivities: 0,
  });
  expect(await db.select().from(likes)).toHaveLength(41);
  expect(
    await db
      .select({ likeCount: objects.likeCount })
      .from(objects)
      .where(eq(objects.apId, objectApId))
      .get(),
  ).toEqual({ likeCount: 41 });

  await db.run(sql`DROP TRIGGER reject_second_domain_interaction_page`);
  expect(await purgeDomainContent(db, "bulk-interactions.example")).toEqual({
    complete: true,
    deletedObjects: 0,
    deletedActivities: 0,
  });
  expect(await db.select().from(likes)).toEqual([]);
  expect(
    await db
      .select({ likeCount: objects.likeCount })
      .from(objects)
      .where(eq(objects.apId, objectApId))
      .get(),
  ).toEqual({ likeCount: 0 });
});

test("purgeDomainContent parses an explicit port after an IPv6 hostname", async () => {
  const db = await freshDb();
  const actor = "https://[2001:db8::1]:8443/users/alice";
  const objectApId = "https://content.example/objects/ipv6-domain-target";
  await seedPost(db, objectApId, actor);
  await db.insert(activities).values({
    apId: "https://content.example/activities/ipv6-domain-target",
    type: "Create",
    actorApId: actor,
    objectApId,
    rawJson: "{}",
    direction: "inbound",
  });
  await blockDomain(db, actor, null);

  expect(await isActorBlocked(db, actor)).toBe(true);
  expect(await purgeDomainContent(db, actor)).toEqual({
    complete: true,
    deletedObjects: 1,
    deletedActivities: 1,
  });
  expect(await objectExists(db, objectApId)).toBe(false);
  expect(
    await activityExists(
      db,
      "https://content.example/activities/ipv6-domain-target",
    ),
  ).toBe(false);
});

test("purgeDomainContent handles a long valid D1 domain without matching path text", async () => {
  const db = await freshDb();
  const domain = `${"a".repeat(63)}.example`;
  const apexActor = `https://${domain}/users/a`;
  const subdomainActor = `https://node.${domain}/users/b`;
  const pathOnlyActor = `https://safe.example/users/${domain}`;
  const credentialActor = `https://${domain}@safe.example/users/d`;
  const apexPost = `https://${domain}/objects/apex`;
  const subdomainPost = `https://node.${domain}/objects/subdomain`;
  const pathOnlyPost = "https://safe.example/objects/path-only";
  const credentialPost = "https://safe.example/objects/credential";

  await seedPost(db, apexPost, apexActor);
  await seedPost(db, subdomainPost, subdomainActor);
  await seedPost(db, pathOnlyPost, pathOnlyActor);
  await seedPost(db, credentialPost, credentialActor);
  await db.insert(activities).values([
    {
      apId: `https://${domain}/activities/apex`,
      type: "Create",
      actorApId: apexActor,
      rawJson: "{}",
      direction: "inbound",
    },
    {
      apId: `https://node.${domain}/activities/subdomain`,
      type: "Create",
      actorApId: subdomainActor,
      rawJson: "{}",
      direction: "inbound",
    },
    {
      apId: "https://safe.example/activities/path-only",
      type: "Create",
      actorApId: pathOnlyActor,
      rawJson: "{}",
      direction: "inbound",
    },
    {
      apId: "https://safe.example/activities/credential",
      type: "Create",
      actorApId: credentialActor,
      rawJson: "{}",
      direction: "inbound",
    },
  ]);

  await purgeDomainContent(db, domain);

  expect({
    apexPost: await objectExists(db, apexPost),
    subdomainPost: await objectExists(db, subdomainPost),
    pathOnlyPost: await objectExists(db, pathOnlyPost),
    credentialPost: await objectExists(db, credentialPost),
    apexActivity: await activityExists(db, `https://${domain}/activities/apex`),
    subdomainActivity: await activityExists(
      db,
      `https://node.${domain}/activities/subdomain`,
    ),
    pathOnlyActivity: await activityExists(
      db,
      "https://safe.example/activities/path-only",
    ),
    credentialActivity: await activityExists(
      db,
      "https://safe.example/activities/credential",
    ),
  }).toEqual({
    apexPost: false,
    subdomainPost: false,
    pathOnlyPost: true,
    credentialPost: true,
    apexActivity: false,
    subdomainActivity: false,
    pathOnlyActivity: true,
    credentialActivity: true,
  });
});

test("purgeDomainContent crosses unrelated history and more than two D1 chunks", async () => {
  const db = await freshDb();
  const domain = "bulk-blocked.example";
  const actor = `https://${domain}/users/a`;
  const targetApIds = Array.from(
    { length: 181 },
    (_, index) => `https://content.example/zzzz-blocked-objects/${index}`,
  );
  const survivorApIds = Array.from(
    { length: 513 },
    (_, index) => `https://content.example/aaaa-safe-objects/${index}`,
  );

  // Seed one statement per object so the fixture itself obeys D1's 100-bound-
  // parameter ceiling. Unrelated rows sort before every target, so the purge
  // must advance its keyset rather than restarting there for every delete page.
  for (const [index, apId] of survivorApIds.entries()) {
    await seedPost(db, apId, `https://safe.example/users/${index}`);
  }
  for (const [index, apId] of targetApIds.entries()) {
    await seedPost(db, apId, actor);
    await db.insert(activities).values({
      apId: `https://content.example/zzzz-blocked-activities/${index}`,
      type: "Create",
      actorApId: actor,
      objectApId: apId,
      rawJson: "{}",
      direction: "inbound",
    });
  }

  const result = await purgeDomainContent(db, domain);

  expect(result).toEqual({
    complete: true,
    deletedObjects: 181,
    deletedActivities: 181,
  });
  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.attributedTo, actor)),
  ).toEqual([]);
  expect(
    await db
      .select({ apId: activities.apId })
      .from(activities)
      .where(eq(activities.actorApId, actor)),
  ).toEqual([]);
  expect(await db.select({ apId: objects.apId }).from(objects)).toHaveLength(
    survivorApIds.length,
  );
});

test("a domain block is enforced on subdomains (isActorBlocked)", async () => {
  const db = await freshDb();
  await blockDomain(db, "evil.example", null);

  expect(await isActorBlocked(db, "https://evil.example/users/x")).toBe(true);
  expect(await isActorBlocked(db, "https://a.evil.example/users/x")).toBe(true);
  expect(await isActorBlocked(db, "https://deep.a.evil.example/users/x")).toBe(
    true,
  );
  // A different registrable domain that merely ends with the same labels.
  expect(await isActorBlocked(db, "https://notevil.example/users/x")).toBe(
    false,
  );
});
