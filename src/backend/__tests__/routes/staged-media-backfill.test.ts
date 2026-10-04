import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import {
  actors,
  communities,
  mediaBlobDeletionJobs,
  mediaUploadAttempts,
  mediaUploadLifetimes,
  mediaUploads,
  objects,
  type Database,
} from "../../../db/index.ts";
import {
  backfillStagedMediaReferences,
  claimExpiredStagedMedia,
} from "../../lib/staged-media-retention.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import type { Env } from "../../types.ts";
import { createTestDb, readMigration } from "../helpers/d1-semantics.ts";

const APP_URL = "https://staged-media-backfill.test";
const KEY_A = `uploads/${"a".repeat(64)}.webm`;
const KEY_B = `uploads/${"b".repeat(64)}.png`;
const KEY_C = `uploads/${"c".repeat(64)}.jpg`;
const KEY_D = `uploads/${"d".repeat(64)}.jpg`;
const KEY_E = `uploads/${"e".repeat(64)}.webm`;
const KEY_F = `uploads/${"f".repeat(64)}.webm`;
const LEGACY_KEY_A = `uploads/${"1".repeat(64)}.webm`;
const LEGACY_KEY_B = `uploads/${"2".repeat(64)}.png`;
const LEGACY_KEY_C = `uploads/${"3".repeat(64)}.jpg`;
const OLD = "2000-01-01T00:00:00.000Z";
const EXPIRED = "2000-01-08T00:00:00.000Z";
const MEDIA_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x01]);

function memoryKv() {
  return {
    async get() {
      return null;
    },
    async put() {},
    async delete() {},
  };
}

function objectStore() {
  const blobs = new Map<string, unknown>();
  const deleted: string[] = [];
  const media: ObjectStore = {
    async put(key, value) {
      blobs.set(key, value);
    },
    async get(key) {
      const value = blobs.get(key);
      return value === undefined ? null : ({ body: value } as never);
    },
    async delete(value) {
      for (const key of typeof value === "string" ? [value] : [...value]) {
        deleted.push(key);
        blobs.delete(key);
      }
    },
  };
  return { media, blobs, deleted };
}

function envFor(db: Database, media: ObjectStore): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    MEDIA: media,
    KV: memoryKv(),
    DELIVERY_QUEUE: { async send() {}, async sendBatch() {} },
    DELIVERY_DLQ: { async send() {}, async sendBatch() {} },
  } as unknown as Env;
}

async function before0034(options?: { includeNullApId?: boolean }) {
  const fixture = await createTestDb({
    through: "0033_delivery_reconciliation.sql",
  });
  const db = fixture.db;
  const actorApId = `${APP_URL}/ap/users/backfill-owner`;
  const actor = {
    apId: actorApId,
    type: "Person",
    preferredUsername: "backfill-owner",
    name: "Backfill owner",
    inbox: `${actorApId}/inbox`,
    outbox: `${actorApId}/outbox`,
    followersUrl: `${actorApId}/followers`,
    followingUrl: `${actorApId}/following`,
    publicKeyPem: "backfill-owner-public-key",
    privateKeyPem: "backfill-owner-private-key",
    takosUserId: "backfill:owner",
    role: "owner",
    iconUrl: `/media/${"b".repeat(64)}.png`,
  };
  await db.insert(actors).values(actor);
  const legacyActorIds = [actorApId];
  for (let index = 0; index < 24; index += 1) {
    const apId = `${actorApId}-${String(index).padStart(2, "0")}`;
    legacyActorIds.push(apId);
    await db.insert(actors).values({
      apId,
      preferredUsername: `backfill-owner-${String(index).padStart(2, "0")}`,
      iconUrl: null,
      headerUrl: null,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: `actor-public-key-${index}`,
      privateKeyPem: `actor-private-key-${index}`,
      takosUserId: `backfill:actor:${index}`,
    });
  }

  const legacyObjectRows = Array.from({ length: 25 }, (_, index) => {
    const apId = `${actorApId}/objects/legacy-${String(index).padStart(2, "0")}`;
    return {
      apId,
      type: "Note",
      attributedTo: actorApId,
      content: `legacy-${index}`,
      attachmentsJson: JSON.stringify(
        index === 0
          ? {
              attachment: {
                r2_key: KEY_A,
                url: `/media/${"a".repeat(64)}.webm`,
              },
            }
          : [],
      ),
      published: OLD,
      isLocal: 1,
    };
  });
  legacyObjectRows.push(
    {
      apId: `${actorApId}/objects/legacy-malformed`,
      type: "Note",
      attributedTo: actorApId,
      content: "malformed legacy JSON",
      attachmentsJson: "{not-json",
      published: OLD,
      isLocal: 1,
    },
    {
      apId: `${actorApId}/objects/legacy-overlarge`,
      type: "Note",
      attributedTo: actorApId,
      content: "overlarge legacy payload",
      attachmentsJson: JSON.stringify({ text: "x".repeat(17_000) }),
      published: OLD,
      isLocal: 1,
    },
    {
      apId: `${actorApId}/objects/legacy-overdecoded`,
      type: "Note",
      attributedTo: actorApId,
      content: "legacy encoding depth exceeds normalizer",
      attachmentsJson: JSON.stringify({
        url: encodeNTimes(`${APP_URL}/media/${"%62".repeat(64)}%2epng`, 4),
      }),
      published: OLD,
      isLocal: 1,
    },
  );
  legacyObjectRows.push({
    apId: "",
    type: "Note",
    attributedTo: actorApId,
    content: "empty AP-ID legacy reference",
    attachmentsJson: JSON.stringify({ url: KEY_D }),
    published: OLD,
    isLocal: 1,
  });
  for (let offset = 0; offset < legacyObjectRows.length; offset += 5) {
    await db.insert(objects).values(legacyObjectRows.slice(offset, offset + 5));
  }
  if (options?.includeNullApId) {
    await fixture.client.execute({
      sql: `INSERT INTO objects (ap_id,type,attributed_to,content,attachments_json,published,is_local)
        VALUES (NULL,'Note',?,'NULL AP-ID legacy reference',?, ?,1)`,
      args: [actorApId, JSON.stringify({ url: KEY_E }), OLD],
    });
  }

  const legacyMediaUploads = [
    {
      id: "legacy-upload-a",
      r2Key: LEGACY_KEY_A,
      uploaderApId: actorApId,
      contentType: "video/webm",
      size: 6,
      createdAt: OLD,
    },
    {
      id: "legacy-upload-b",
      r2Key: LEGACY_KEY_B,
      uploaderApId: actorApId,
      contentType: "image/png",
      size: 6,
      createdAt: OLD,
    },
    {
      id: "legacy-upload-c",
      r2Key: LEGACY_KEY_C,
      uploaderApId: actorApId,
      contentType: "image/jpeg",
      size: 6,
      createdAt: OLD,
    },
  ];
  await db.insert(mediaUploads).values(legacyMediaUploads);

  const communityApId = `${APP_URL}/ap/communities/backfill-community`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "backfill-community",
    name: "Backfill community",
    iconUrl: `/media/${"c".repeat(64)}.jpg`,
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    publicKeyPem: "community-public-key",
    privateKeyPem: "community-private-key",
    createdBy: actorApId,
  });
  const legacyCommunityIds = [communityApId];
  for (let index = 0; index < 24; index += 1) {
    const apId = `${communityApId}-${String(index).padStart(2, "0")}`;
    legacyCommunityIds.push(apId);
    await db.insert(communities).values({
      apId,
      preferredUsername: `backfill-community-${String(index).padStart(2, "0")}`,
      name: `Backfill community ${index}`,
      iconUrl: null,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      publicKeyPem: `community-public-key-${index}`,
      privateKeyPem: `community-private-key-${index}`,
      createdBy: actorApId,
    });
  }

  const media = objectStore();
  const migration = await readMigration("0034_staged_media_retention.sql");
  await fixture.client.executeMultiple(migration);
  return {
    ...fixture,
    actor,
    actorApId,
    communityApId,
    orderedLegacyActorIds: [...legacyActorIds].sort(),
    orderedLegacyCommunityIds: [...legacyCommunityIds].sort(),
    legacyObjectRows,
    orderedLegacyObjectIds: legacyObjectRows.map(({ apId }) => apId).sort(),
    legacyMediaUploads,
    legacyActorIds,
    legacyCommunityIds,
    db,
    media,
    env: envFor(db, media.media),
  };
}

function encodeNTimes(value: string, count: number): string {
  let encoded = value;
  for (let index = 0; index < count; index += 1) {
    encoded = encodeURIComponent(encoded);
  }
  return encoded;
}

async function addExpiredSettledUpload(
  state: Awaited<ReturnType<typeof before0034>>,
  key: string,
  uploadId: string,
): Promise<void> {
  await state.db.insert(mediaUploadAttempts).values({
    id: uploadId,
    r2Key: key,
    uploaderApId: state.actorApId,
    publicKeyPem: state.actor.publicKeyPem,
    phase: "putting",
    createdAt: OLD,
  });
  await state.db
    .update(mediaUploadAttempts)
    .set({ phase: "cleanup" })
    .where(eq(mediaUploadAttempts.id, uploadId));
  await state.db.insert(mediaUploads).values({
    id: uploadId,
    r2Key: key,
    uploaderApId: state.actorApId,
    contentType: key.endsWith(".png")
      ? "image/png"
      : key.endsWith(".jpg")
        ? "image/jpeg"
        : "video/webm",
    size: MEDIA_BYTES.byteLength,
    createdAt: OLD,
  });
  await state.db.insert(mediaUploadLifetimes).values({
    r2Key: key,
    uploadId,
    uploaderApId: state.actorApId,
    publicKeyPem: state.actor.publicKeyPem,
    state: "staged",
    createdAt: OLD,
    expiresAt: EXPIRED,
  });
  await state.db
    .delete(mediaUploadAttempts)
    .where(eq(mediaUploadAttempts.id, uploadId));
  state.media.blobs.set(key, MEDIA_BYTES);
}

async function rows<T extends Record<string, unknown>>(
  db: Database,
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  return db.all<T>(query);
}

test("0034 migration preserves legacy payloads and leaves the backfill durable and initially empty", async () => {
  const state = await before0034();
  expect(state.applied).toContain("0033_delivery_reconciliation.sql");
  expect(await state.db.select().from(objects)).toHaveLength(29);
  expect(await state.db.select().from(actors)).toHaveLength(25);
  expect(await state.db.select().from(communities)).toHaveLength(25);
  expect(
    (
      await state.db
        .select({ attachmentsJson: objects.attachmentsJson })
        .from(objects)
        .where(eq(objects.apId, state.legacyObjectRows[0]!.apId))
        .get()
    )?.attachmentsJson,
  ).toBe(state.legacyObjectRows[0]!.attachmentsJson);
  expect(await state.db.select().from(mediaUploadLifetimes)).toHaveLength(0);
  expect(await state.db.select().from(mediaUploads)).toEqual(
    state.legacyMediaUploads,
  );
  expect(
    await rows(state.db, sql`SELECT r2_key FROM media_staged_references`),
  ).toHaveLength(0);
  expect(
    await rows(
      state.db,
      sql`SELECT source_kind,source_id FROM media_staged_ambiguity`,
    ),
  ).toHaveLength(0);
  expect(
    await rows(
      state.db,
      sql`SELECT source_kind,cursor,complete FROM media_staged_backfill ORDER BY source_kind`,
    ),
  ).toEqual([
    { source_kind: "actor", cursor: null, complete: 0 },
    { source_kind: "community", cursor: null, complete: 0 },
    { source_kind: "object", cursor: null, complete: 0 },
  ]);
});

test("each backfill call indexes at most ten rows per family and keeps claims closed until all cursors finish", async () => {
  const state = await before0034();
  await addExpiredSettledUpload(state, KEY_A, "a".repeat(64));
  await addExpiredSettledUpload(state, KEY_B, "b".repeat(64));
  await addExpiredSettledUpload(state, KEY_C, "c".repeat(64));
  await addExpiredSettledUpload(state, KEY_D, "d".repeat(64));
  await addExpiredSettledUpload(state, KEY_E, "e".repeat(64));

  expect(await claimExpiredStagedMedia(state.db)).toBe(0);
  expect(
    await rows(
      state.db,
      sql`SELECT source_kind,cursor,complete FROM media_staged_backfill ORDER BY source_kind`,
    ),
  ).toEqual([
    {
      source_kind: "actor",
      cursor: state.orderedLegacyActorIds[9],
      complete: 0,
    },
    {
      source_kind: "community",
      cursor: state.orderedLegacyCommunityIds[9],
      complete: 0,
    },
    {
      source_kind: "object",
      cursor: state.orderedLegacyObjectIds[9],
      complete: 0,
    },
  ]);
  expect(
    await rows(
      state.db,
      sql`SELECT source_kind,count(*) AS count FROM media_staged_source_inputs GROUP BY source_kind`,
    ),
  ).toHaveLength(0);
  expect(await state.db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
  expect(state.media.deleted).toHaveLength(0);

  // The next page crosses malformed/oversize/deeply encoded source rows. They
  // become durable conservative ambiguity markers rather than being skipped.
  await backfillStagedMediaReferences(state.db);
  expect(
    await rows(
      state.db,
      sql`SELECT source_kind,cursor,complete FROM media_staged_backfill ORDER BY source_kind`,
    ),
  ).toEqual([
    {
      source_kind: "actor",
      cursor: state.orderedLegacyActorIds[19],
      complete: 0,
    },
    {
      source_kind: "community",
      cursor: state.orderedLegacyCommunityIds[19],
      complete: 0,
    },
    {
      source_kind: "object",
      cursor: state.orderedLegacyObjectIds[19],
      complete: 0,
    },
  ]);
  expect(
    await rows(
      state.db,
      sql`SELECT source_kind,source_id FROM media_staged_ambiguity`,
    ),
  ).toHaveLength(0);
  await backfillStagedMediaReferences(state.db);
  expect(
    await rows(
      state.db,
      sql`SELECT source_kind,source_id FROM media_staged_ambiguity ORDER BY source_id`,
    ),
  ).toEqual(
    ["legacy-malformed", "legacy-overdecoded", "legacy-overlarge"].map(
      (suffix) => ({
        source_kind: "object",
        source_id: `${state.actorApId}/objects/${suffix}`,
      }),
    ),
  );
  expect(
    await rows(
      state.db,
      sql`SELECT source_kind,cursor,complete FROM media_staged_backfill ORDER BY source_kind`,
    ),
  ).toEqual([
    {
      source_kind: "actor",
      cursor: state.orderedLegacyActorIds.at(-1),
      complete: 1,
    },
    {
      source_kind: "community",
      cursor: state.orderedLegacyCommunityIds.at(-1),
      complete: 1,
    },
    {
      source_kind: "object",
      cursor: state.orderedLegacyObjectIds.at(-1),
      complete: 1,
    },
  ]);

  expect(
    await rows(
      state.db,
      sql`SELECT r2_key,source_kind,source_id FROM media_staged_references ORDER BY r2_key,source_kind,source_id`,
    ),
  ).toContainEqual({
    r2_key: KEY_A,
    source_kind: "object",
    source_id: state.legacyObjectRows[0]!.apId,
  });
  expect(
    await rows(
      state.db,
      sql`SELECT r2_key,source_kind,source_id FROM media_staged_references ORDER BY r2_key,source_kind,source_id`,
    ),
  ).toContainEqual({
    r2_key: KEY_C,
    source_kind: "community",
    source_id: state.communityApId,
  });
  expect(
    await rows(
      state.db,
      sql`SELECT r2_key,source_kind,source_id FROM media_staged_references ORDER BY r2_key,source_kind,source_id`,
    ),
  ).toContainEqual({
    r2_key: KEY_B,
    source_kind: "actor",
    source_id: state.legacyActorIds[0],
  });
  expect(
    await rows(
      state.db,
      sql`SELECT r2_key,source_kind,source_id FROM media_staged_references ORDER BY r2_key,source_kind,source_id`,
    ),
  ).toContainEqual({
    r2_key: KEY_D,
    source_kind: "object",
    source_id: "",
  });

  // Ambiguity is global and fail-safe: even an unrelated staged key is not
  // collected until its owning legacy row is corrected or removed.
  expect(await claimExpiredStagedMedia(state.db)).toBe(0);
  expect(await state.db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
  expect(state.media.deleted).toHaveLength(0);

  const malformedId = `${state.actorApId}/objects/legacy-malformed`;
  await state.db
    .update(objects)
    .set({ attachmentsJson: "[]" })
    .where(eq(objects.apId, malformedId));
  expect(
    await rows(
      state.db,
      sql`SELECT source_kind,source_id FROM media_staged_ambiguity WHERE source_id=${malformedId}`,
    ),
  ).toHaveLength(0);
  // Other conservative rows still block; deleting each source clears only its
  // own blocker and never rewrites the preserved source payloads.
  await state.db
    .delete(objects)
    .where(eq(objects.apId, `${state.actorApId}/objects/legacy-overlarge`));
  await state.db
    .delete(objects)
    .where(eq(objects.apId, `${state.actorApId}/objects/legacy-overdecoded`));
  expect(await claimExpiredStagedMedia(state.db)).toBe(1);
  expect(
    await state.db
      .select({ r2Key: mediaBlobDeletionJobs.r2Key })
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, KEY_E)),
  ).toEqual([{ r2Key: KEY_E }]);
  expect(state.media.deleted).toHaveLength(0);
});

test("backfill reads the current source payload and does not restore stale references", async () => {
  const state = await before0034();
  const apId = state.legacyObjectRows[0]!.apId;
  await state.db
    .update(objects)
    .set({ attachmentsJson: JSON.stringify({ attachment: { r2_key: KEY_B } }) })
    .where(eq(objects.apId, apId));
  expect(
    await rows(
      state.db,
      sql`SELECT r2_key FROM media_staged_references WHERE source_kind='object' AND source_id=${apId}`,
    ),
  ).toEqual([{ r2_key: KEY_B }]);

  await backfillStagedMediaReferences(state.db);
  expect(
    await rows(
      state.db,
      sql`SELECT r2_key FROM media_staged_references WHERE source_kind='object' AND source_id=${apId}`,
    ),
  ).toEqual([{ r2_key: KEY_B }]);
});

test("a legacy NULL object AP-ID keeps collection closed without deleting its blob", async () => {
  const state = await before0034({ includeNullApId: true });
  await addExpiredSettledUpload(state, KEY_E, "e".repeat(64));
  for (let page = 0; page < 5; page += 1) {
    await backfillStagedMediaReferences(state.db);
  }

  // Resolve the unrelated parse ambiguities so the NULL source identity is the
  // only remaining reason the staged collector must stay closed.
  await state.db
    .update(objects)
    .set({ attachmentsJson: "[]" })
    .where(eq(objects.apId, `${state.actorApId}/objects/legacy-malformed`));
  await state.db
    .delete(objects)
    .where(eq(objects.apId, `${state.actorApId}/objects/legacy-overlarge`));
  await state.db
    .delete(objects)
    .where(eq(objects.apId, `${state.actorApId}/objects/legacy-overdecoded`));

  expect(
    await rows(
      state.db,
      sql`SELECT source_kind,cursor,complete FROM media_staged_backfill WHERE source_kind='object'`,
    ),
  ).toEqual([
    {
      source_kind: "object",
      cursor: state.orderedLegacyObjectIds.at(-1),
      complete: 1,
    },
  ]);
  expect(
    await rows(
      state.db,
      sql`SELECT count(*) AS count FROM objects WHERE ap_id IS NULL`,
    ),
  ).toEqual([{ count: 1 }]);

  expect(await claimExpiredStagedMedia(state.db)).toBe(0);
  expect(await state.db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
  expect(state.media.blobs.has(KEY_E)).toBe(true);
  expect(state.media.deleted).not.toContain(KEY_E);

  await expect(
    state.db
      .update(mediaUploadLifetimes)
      .set({ state: "deleting" })
      .where(eq(mediaUploadLifetimes.r2Key, KEY_E))
      .run(),
  ).rejects.toThrow();

  await state.client.execute({
    sql: "DELETE FROM objects WHERE ap_id IS NULL",
  });
  expect(await claimExpiredStagedMedia(state.db)).toBe(1);
  expect(
    await rows(
      state.db,
      sql`SELECT r2_key,uploader_ap_id FROM media_blob_deletion_jobs`,
    ),
  ).toEqual([{ r2_key: KEY_E, uploader_ap_id: state.actorApId }]);
});

test("journal triggers keep inserts behind the cursor and updates/deletes synchronized", async () => {
  const state = await before0034();
  await backfillStagedMediaReferences(state.db);
  const key = KEY_A;
  const lateId = `${state.actorApId}/objects/000-behind-cursor`;
  await state.db.insert(objects).values({
    apId: lateId,
    type: "Note",
    attributedTo: state.actorApId,
    content: "inserted behind existing cursor",
    attachmentsJson: JSON.stringify({ url: key }),
    published: OLD,
    isLocal: 1,
  });
  expect(
    await rows(
      state.db,
      sql`SELECT r2_key FROM media_staged_references WHERE source_kind='object' AND source_id=${lateId}`,
    ),
  ).toEqual([{ r2_key: key }]);

  await state.db
    .update(objects)
    .set({ attachmentsJson: JSON.stringify({ image: KEY_B }) })
    .where(eq(objects.apId, lateId));
  expect(
    await rows(
      state.db,
      sql`SELECT r2_key FROM media_staged_references WHERE source_kind='object' AND source_id=${lateId}`,
    ),
  ).toEqual([{ r2_key: KEY_B }]);
  await state.db.delete(objects).where(eq(objects.apId, lateId));
  expect(
    await rows(
      state.db,
      sql`SELECT r2_key FROM media_staged_references WHERE source_kind='object' AND source_id=${lateId}`,
    ),
  ).toHaveLength(0);
});
