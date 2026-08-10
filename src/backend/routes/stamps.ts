import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";

import {
  mediaUploads,
  stampEntitlements,
  stampFavorites,
  stampInstallations,
  stampPackReleases,
  stampPacks,
  stampRecents,
  stampReleaseItems,
  stampRevisions,
  stamps as stampRows,
  insertMany,
  runBatch,
  type D1Statement,
} from "../../db/index.ts";
import { safeJsonParse } from "../federation-helpers.ts";
import {
  MAX_STAMP_ASSET_BYTES,
  prepareStampAsset,
  sha256Text,
  type StampAssetMediaType,
} from "../lib/stamp-assets.ts";
import {
  buildStampPackManifest,
  MAX_STAMP_PACK_STAMPS,
} from "../lib/stamp-manifest.ts";
import {
  refreshRemoteStampPack,
  RemoteStampPackError,
} from "../lib/stamp-pack-import.ts";
import { normalizeStampUri } from "../lib/stamps.ts";
import type { Env, Variables } from "../types.ts";

const stamps = new Hono<{ Bindings: Env; Variables: Variables }>();

const PACK_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STAMP_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SOURCE_R2_KEY = /^uploads\/[a-f0-9]+\.(png|webp)$/;
const LOCALE = /^[a-zA-Z0-9-]{1,35}$/;

function localizedText(
  value: unknown,
  maxLength: number,
): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 8) return null;
  const normalized: Array<[string, string]> = [];
  for (const [locale, rawText] of entries) {
    if (!LOCALE.test(locale) || typeof rawText !== "string") return null;
    const text = rawText.trim();
    if (!text || text.length > maxLength) return null;
    normalized.push([locale.toLowerCase(), text]);
  }
  normalized.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(normalized);
}

function optionalLocalizedText(
  value: unknown,
  maxLength: number,
): Record<string, string> | null | undefined {
  if (value === undefined || value === null) return undefined;
  return localizedText(value, maxLength);
}

type NewPackStamp = {
  key: string;
  sourceR2Key: string;
  alt: Record<string, string>;
  tags: string[];
};

type NewPack = {
  slug: string;
  name: Record<string, string>;
  description?: Record<string, string>;
  visibility: "public" | "unlisted" | "private" | "community";
  stamps: NewPackStamp[];
};

function parseNewPack(value: unknown): NewPack | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (JSON.stringify(value).length > 32 * 1024) return null;
  const body = value as Record<string, unknown>;
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const name = localizedText(body.name, 100);
  const description = optionalLocalizedText(body.description, 500);
  const visibility = body.visibility ?? "public";
  if (
    !PACK_SLUG.test(slug) ||
    !name ||
    description === null ||
    (visibility !== "public" &&
      visibility !== "unlisted" &&
      visibility !== "private" &&
      visibility !== "community") ||
    !Array.isArray(body.stamps) ||
    body.stamps.length < 1 ||
    body.stamps.length > MAX_STAMP_PACK_STAMPS
  ) {
    return null;
  }

  const seenKeys = new Set<string>();
  const parsedStamps: NewPackStamp[] = [];
  for (const raw of body.stamps) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const stamp = raw as Record<string, unknown>;
    const key = typeof stamp.key === "string" ? stamp.key.trim() : "";
    const sourceR2Key =
      typeof stamp.source_r2_key === "string" ? stamp.source_r2_key.trim() : "";
    const alt = localizedText(stamp.alt, 200);
    if (
      !STAMP_KEY.test(key) ||
      seenKeys.has(key) ||
      !SOURCE_R2_KEY.test(sourceR2Key) ||
      !alt ||
      !Array.isArray(stamp.tags) ||
      stamp.tags.length > 16 ||
      stamp.tags.some(
        (tag) => typeof tag !== "string" || !tag.trim() || tag.length > 32,
      )
    ) {
      return null;
    }
    seenKeys.add(key);
    parsedStamps.push({
      key,
      sourceR2Key,
      alt,
      tags: [
        ...new Set(
          (stamp.tags as string[]).map((tag) => tag.trim()).filter(Boolean),
        ),
      ],
    });
  }

  return {
    slug,
    name,
    ...(description ? { description } : {}),
    visibility,
    stamps: parsedStamps,
  };
}

stamps.post("/packs", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json<unknown>();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const input = parseNewPack(rawBody);
  if (!input) return c.json({ error: "Invalid Stamp pack" }, 400);

  const media = c.env.MEDIA;
  if (!media) return c.json({ error: "Object storage unavailable" }, 503);
  const db = c.get("db");
  const baseUrl = c.env.APP_URL.replace(/\/+$/, "");
  const packId = `${baseUrl}/stamp-packs/${input.slug}`;
  if (
    await db
      .select({ id: stampPacks.id })
      .from(stampPacks)
      .where(eq(stampPacks.id, packId))
      .get()
  ) {
    return c.json({ error: "Stamp pack slug already exists" }, 409);
  }

  const sourceKeys = [
    ...new Set(input.stamps.map((stamp) => stamp.sourceR2Key)),
  ];
  const uploadRows = await db
    .select({
      r2Key: mediaUploads.r2Key,
      contentType: mediaUploads.contentType,
      size: mediaUploads.size,
    })
    .from(mediaUploads)
    .where(
      and(
        eq(mediaUploads.uploaderApId, actor.ap_id),
        inArray(mediaUploads.r2Key, sourceKeys),
      ),
    );
  const uploads = new Map(uploadRows.map((upload) => [upload.r2Key, upload]));
  if (uploads.size !== sourceKeys.length) {
    return c.json(
      { error: "Every Stamp asset must be owned by the actor" },
      400,
    );
  }

  const prepared: Array<{
    key: string;
    alt: Record<string, string>;
    tags: string[];
    asset: Awaited<ReturnType<typeof prepareStampAsset>>;
    stampId: string;
    revisionId: string;
    revisionDigest: string;
  }> = [];
  try {
    for (const stamp of input.stamps) {
      const upload = uploads.get(stamp.sourceR2Key)!;
      const mediaType = upload.contentType as StampAssetMediaType;
      const extensionMatches =
        (mediaType === "image/png" && stamp.sourceR2Key.endsWith(".png")) ||
        (mediaType === "image/webp" && stamp.sourceR2Key.endsWith(".webp"));
      if (
        !extensionMatches ||
        upload.size < 1 ||
        upload.size > MAX_STAMP_ASSET_BYTES
      ) {
        return c.json(
          { error: "Stamp assets must be PNG or WebP up to 2 MiB" },
          400,
        );
      }

      const asset = await prepareStampAsset(
        media,
        stamp.sourceR2Key,
        mediaType,
      );
      const stampId = `${packId}/stamps/${stamp.key}`;
      const revisionHash = await sha256Text(
        JSON.stringify({
          asset: {
            sha256: asset.sha256,
            mediaType: asset.mediaType,
            width: asset.width,
            height: asset.height,
          },
          alt: stamp.alt,
          tags: stamp.tags,
        }),
      );
      prepared.push({
        ...stamp,
        asset,
        stampId,
        revisionId: `${stampId}/revisions/${revisionHash}`,
        revisionDigest: `sha256:${revisionHash}`,
      });
    }
  } catch {
    return c.json({ error: "Stamp asset could not be prepared" }, 400);
  }

  const releaseId = `${packId}/releases/1`;
  const manifest = buildStampPackManifest({
    baseUrl,
    id: packId,
    release: 1,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    publisher: actor.ap_id,
    visibility: input.visibility,
    stamps: prepared.map((stamp) => ({
      id: stamp.stampId,
      key: stamp.key,
      revision: stamp.revisionDigest,
      alt: stamp.alt,
      tags: stamp.tags,
      asset: stamp.asset,
    })),
  });
  const manifestSha256 = await sha256Text(JSON.stringify(manifest));
  const now = new Date().toISOString();
  const statements = [
    db.insert(stampPacks).values({
      id: packId,
      publisherActorId: actor.ap_id,
      slug: input.slug,
      nameJson: JSON.stringify(input.name),
      descriptionJson: input.description
        ? JSON.stringify(input.description)
        : null,
      iconUrl: prepared[0]?.asset.url,
      currentReleaseId: releaseId,
      visibility: input.visibility,
      status: "published",
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(stampPackReleases).values({
      id: releaseId,
      packId,
      releaseNumber: 1,
      manifestSha256,
      publishedAt: now,
    }),
    ...insertMany(
      db,
      stampRows,
      prepared.map((stamp, index) => ({
        id: stamp.stampId,
        packId,
        key: stamp.key,
        currentRevisionId: stamp.revisionId,
        sortOrder: index,
        enabled: true,
      })),
    ),
    ...insertMany(
      db,
      stampRevisions,
      prepared.map((stamp) => ({
        id: stamp.revisionId,
        stampId: stamp.stampId,
        revisionDigest: stamp.revisionDigest,
        assetUrl: stamp.asset.url,
        assetR2Key: stamp.asset.r2Key,
        mediaType: stamp.asset.mediaType,
        width: stamp.asset.width,
        height: stamp.asset.height,
        assetSha256: stamp.asset.sha256,
        altJson: JSON.stringify(stamp.alt),
        tagsJson: JSON.stringify(stamp.tags),
        animated: false,
        createdAt: now,
      })),
    ),
    ...insertMany(
      db,
      stampReleaseItems,
      prepared.map((stamp, index) => ({
        releaseId,
        stampId: stamp.stampId,
        revisionId: stamp.revisionId,
        sortOrder: index,
      })),
    ),
    db.insert(stampEntitlements).values({
      actorApId: actor.ap_id,
      packId,
      canInstall: true,
      canSend: true,
      source: "free",
      grantedAt: now,
    }),
    db.insert(stampInstallations).values({
      actorApId: actor.ap_id,
      packId,
      installedReleaseId: releaseId,
      autoUpdate: true,
      sortOrder: Date.now(),
      installedAt: now,
    }),
  ];
  try {
    await runBatch(
      db,
      statements as unknown as [D1Statement, ...D1Statement[]],
    );
  } catch {
    return c.json({ error: "Stamp pack could not be published" }, 500);
  }

  return c.json(
    {
      pack_id: packId,
      release_id: releaseId,
      manifest_sha256: manifestSha256,
      stamps: prepared.map((stamp) => ({
        id: stamp.stampId,
        revision: stamp.revisionDigest,
        asset: {
          url: stamp.asset.url,
          media_type: stamp.asset.mediaType,
          width: stamp.asset.width,
          height: stamp.asset.height,
          sha256: stamp.asset.sha256,
        },
      })),
    },
    201,
  );
});

stamps.get("/packs", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const rows = await c
    .get("db")
    .select({
      packId: stampPacks.id,
      publisherActorId: stampPacks.publisherActorId,
      slug: stampPacks.slug,
      nameJson: stampPacks.nameJson,
      descriptionJson: stampPacks.descriptionJson,
      releaseId: stampPackReleases.id,
      releaseNumber: stampPackReleases.releaseNumber,
      releasePublishedAt: stampPackReleases.publishedAt,
      canInstall: stampEntitlements.canInstall,
      canSend: stampEntitlements.canSend,
      entitlementExpiresAt: stampEntitlements.expiresAt,
      entitlementRevokedAt: stampEntitlements.revokedAt,
      stampId: stampRows.id,
      stampKey: stampRows.key,
      revisionId: stampRevisions.id,
      revisionDigest: stampRevisions.revisionDigest,
      assetUrl: stampRevisions.assetUrl,
      mediaType: stampRevisions.mediaType,
      width: stampRevisions.width,
      height: stampRevisions.height,
      assetSha256: stampRevisions.assetSha256,
      altJson: stampRevisions.altJson,
      tagsJson: stampRevisions.tagsJson,
      favoriteActorApId: stampFavorites.actorApId,
      recentLastUsedAt: stampRecents.lastUsedAt,
      recentUseCount: stampRecents.useCount,
    })
    .from(stampInstallations)
    .innerJoin(stampPacks, eq(stampPacks.id, stampInstallations.packId))
    .innerJoin(
      stampPackReleases,
      eq(stampPackReleases.id, stampInstallations.installedReleaseId),
    )
    .innerJoin(
      stampReleaseItems,
      eq(stampReleaseItems.releaseId, stampPackReleases.id),
    )
    .innerJoin(
      stampRows,
      and(
        eq(stampRows.id, stampReleaseItems.stampId),
        eq(stampRows.enabled, true),
      ),
    )
    .innerJoin(
      stampRevisions,
      eq(stampRevisions.id, stampReleaseItems.revisionId),
    )
    .leftJoin(
      stampEntitlements,
      and(
        eq(stampEntitlements.actorApId, actor.ap_id),
        eq(stampEntitlements.packId, stampPacks.id),
      ),
    )
    .leftJoin(
      stampFavorites,
      and(
        eq(stampFavorites.actorApId, actor.ap_id),
        eq(stampFavorites.stampId, stampRows.id),
      ),
    )
    .leftJoin(
      stampRecents,
      and(
        eq(stampRecents.actorApId, actor.ap_id),
        eq(stampRecents.stampId, stampRows.id),
      ),
    )
    .where(
      and(
        eq(stampInstallations.actorApId, actor.ap_id),
        eq(stampPacks.status, "published"),
      ),
    )
    .orderBy(stampInstallations.sortOrder, stampReleaseItems.sortOrder);

  type PackResponse = {
    id: string;
    share_url: string;
    publisher_actor_id: string;
    slug: string;
    name: Record<string, string>;
    description: Record<string, string> | null;
    release: { id: string; number: number; published_at: string };
    rights: Array<"install" | "send">;
    stamps: Array<{
      id: string;
      key: string;
      favorite: boolean;
      recent: { last_used_at: string; use_count: number } | null;
      revision: {
        id: string;
        digest: string;
        asset: {
          url: string;
          media_type: string;
          width: number;
          height: number;
          sha256: string;
        };
        alt: Record<string, string>;
        tags: string[];
      };
    }>;
  };

  const now = new Date().toISOString();
  const packs = new Map<string, PackResponse>();
  for (const row of rows) {
    let pack = packs.get(row.packId);
    if (!pack) {
      const entitlementActive =
        row.entitlementRevokedAt === null &&
        (row.entitlementExpiresAt === null || row.entitlementExpiresAt > now);
      const rights: PackResponse["rights"] = [];
      if (entitlementActive && row.canInstall) rights.push("install");
      if (entitlementActive && row.canSend) rights.push("send");
      pack = {
        id: row.packId,
        share_url: row.packId,
        publisher_actor_id: row.publisherActorId,
        slug: row.slug,
        name: safeJsonParse<Record<string, string>>(row.nameJson, {}),
        description: row.descriptionJson
          ? safeJsonParse<Record<string, string>>(row.descriptionJson, {})
          : null,
        release: {
          id: row.releaseId,
          number: row.releaseNumber,
          published_at: row.releasePublishedAt,
        },
        rights,
        stamps: [],
      };
      packs.set(row.packId, pack);
    }
    pack.stamps.push({
      id: row.stampId,
      key: row.stampKey,
      favorite: row.favoriteActorApId !== null,
      recent: row.recentLastUsedAt
        ? {
            last_used_at: row.recentLastUsedAt,
            use_count: row.recentUseCount ?? 0,
          }
        : null,
      revision: {
        id: row.revisionId,
        digest: row.revisionDigest,
        asset: {
          url: row.assetUrl,
          media_type: row.mediaType,
          width: row.width,
          height: row.height,
          sha256: row.assetSha256,
        },
        alt: safeJsonParse<Record<string, string>>(row.altJson, {}),
        tags: safeJsonParse<string[]>(row.tagsJson, []),
      },
    });
  }

  return c.json({ packs: [...packs.values()] });
});

stamps.post("/install", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    const parsed = await c.req.json<unknown>();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return c.json({ error: "Invalid request body" }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const packId = normalizeStampUri(body.pack_id);
  if (!packId) return c.json({ error: "pack_id must be an absolute URL" }, 400);

  const db = c.get("db");
  const packOrigin = new URL(packId).origin;
  const localOrigin = new URL(c.env.APP_URL || c.req.url).origin;
  if (packOrigin !== localOrigin) {
    if (!c.env.MEDIA) {
      return c.json({ error: "Object storage unavailable" }, 503);
    }
    try {
      await refreshRemoteStampPack(db, c.env.MEDIA, packId);
    } catch (error) {
      if (error instanceof RemoteStampPackError) {
        return c.json({ error: error.message }, error.status);
      }
      return c.json({ error: "Remote Stamp pack is unavailable" }, 502);
    }
  }
  const candidate = await db
    .select({
      packId: stampPacks.id,
      currentReleaseId: stampPacks.currentReleaseId,
      visibility: stampPacks.visibility,
      status: stampPacks.status,
      entitlementSource: stampEntitlements.source,
      canInstall: stampEntitlements.canInstall,
      expiresAt: stampEntitlements.expiresAt,
      revokedAt: stampEntitlements.revokedAt,
    })
    .from(stampPacks)
    .leftJoin(
      stampEntitlements,
      and(
        eq(stampEntitlements.actorApId, actor.ap_id),
        eq(stampEntitlements.packId, stampPacks.id),
      ),
    )
    .where(eq(stampPacks.id, packId))
    .get();

  if (!candidate || candidate.status !== "published") {
    return c.json({ error: "Stamp pack not found" }, 404);
  }
  if (!candidate.currentReleaseId) {
    return c.json({ error: "Stamp pack has no published release" }, 409);
  }

  const now = new Date().toISOString();
  const hasActiveInstallRight =
    candidate.canInstall === true &&
    candidate.revokedAt === null &&
    (candidate.expiresAt === null || candidate.expiresAt > now);
  const isPublicFree =
    candidate.visibility === "public" || candidate.visibility === "unlisted";

  // A first install of a public/unlisted v1 pack creates the local free grant.
  // An existing entitlement row remains authoritative: a revoked/restricted
  // grant cannot be silently replaced merely because the pack is public.
  const shouldGrantFree = isPublicFree && candidate.entitlementSource === null;
  if (!hasActiveInstallRight && !shouldGrantFree) {
    return c.json({ error: "Stamp pack install is not allowed" }, 403);
  }

  const installStatement = db
    .insert(stampInstallations)
    .values({
      actorApId: actor.ap_id,
      packId,
      installedReleaseId: candidate.currentReleaseId,
      autoUpdate: true,
      sortOrder: Date.now(),
      installedAt: now,
    })
    .onConflictDoUpdate({
      target: [stampInstallations.actorApId, stampInstallations.packId],
      set: {
        installedReleaseId: candidate.currentReleaseId,
        updatedAt: now,
      },
    });

  if (shouldGrantFree) {
    await runBatch(db, [
      db
        .insert(stampEntitlements)
        .values({
          actorApId: actor.ap_id,
          packId,
          canInstall: true,
          canSend: true,
          source: "free",
          grantedAt: now,
        })
        .onConflictDoNothing(),
      installStatement,
    ]);
  } else {
    await runBatch(db, [installStatement]);
  }

  return c.json({
    success: true,
    pack_id: packId,
    release_id: candidate.currentReleaseId,
  });
});

stamps.delete("/install", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  let raw: unknown;
  try {
    raw = await c.req.json<unknown>();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const packId = normalizeStampUri((raw as Record<string, unknown>).pack_id);
  if (!packId) return c.json({ error: "pack_id must be an absolute URL" }, 400);

  await c
    .get("db")
    .delete(stampInstallations)
    .where(
      and(
        eq(stampInstallations.actorApId, actor.ap_id),
        eq(stampInstallations.packId, packId),
      ),
    );
  return c.json({ success: true, pack_id: packId });
});

stamps.post("/favorite", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  let raw: unknown;
  try {
    raw = await c.req.json<unknown>();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const body = raw as Record<string, unknown>;
  const stampId = normalizeStampUri(body.stamp_id);
  if (!stampId || typeof body.favorite !== "boolean") {
    return c.json({ error: "stamp_id and favorite are required" }, 400);
  }

  const db = c.get("db");
  if (!body.favorite) {
    await db
      .delete(stampFavorites)
      .where(
        and(
          eq(stampFavorites.actorApId, actor.ap_id),
          eq(stampFavorites.stampId, stampId),
        ),
      );
    return c.json({ success: true, stamp_id: stampId, favorite: false });
  }

  const installed = await db
    .select({ id: stampRows.id })
    .from(stampInstallations)
    .innerJoin(
      stampReleaseItems,
      eq(stampReleaseItems.releaseId, stampInstallations.installedReleaseId),
    )
    .innerJoin(stampRows, eq(stampRows.id, stampReleaseItems.stampId))
    .where(
      and(
        eq(stampInstallations.actorApId, actor.ap_id),
        eq(stampRows.id, stampId),
      ),
    )
    .get();
  if (!installed) {
    return c.json({ error: "Stamp is not installed" }, 403);
  }
  await db
    .insert(stampFavorites)
    .values({ actorApId: actor.ap_id, stampId })
    .onConflictDoNothing();
  return c.json({ success: true, stamp_id: stampId, favorite: true });
});

export default stamps;
