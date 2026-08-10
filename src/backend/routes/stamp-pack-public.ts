import { Hono } from "hono";
import { and, eq } from "drizzle-orm";

import {
  stampPackReleases,
  stampPacks,
  stampReleaseItems,
  stampRevisions,
  stamps,
} from "../../db/index.ts";
import { safeJsonParse } from "../federation-helpers.ts";
import { buildStampPackManifest } from "../lib/stamp-manifest.ts";
import type { Env, Variables } from "../types.ts";

const publicStampPacks = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

publicStampPacks.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const packId = `${c.env.APP_URL.replace(/\/+$/, "")}/stamp-packs/${slug}`;
  const rows = await c
    .get("db")
    .select({
      packId: stampPacks.id,
      publisherActorId: stampPacks.publisherActorId,
      nameJson: stampPacks.nameJson,
      descriptionJson: stampPacks.descriptionJson,
      visibility: stampPacks.visibility,
      releaseNumber: stampPackReleases.releaseNumber,
      manifestSha256: stampPackReleases.manifestSha256,
      stampId: stamps.id,
      stampKey: stamps.key,
      revisionDigest: stampRevisions.revisionDigest,
      assetUrl: stampRevisions.assetUrl,
      mediaType: stampRevisions.mediaType,
      width: stampRevisions.width,
      height: stampRevisions.height,
      assetSha256: stampRevisions.assetSha256,
      altJson: stampRevisions.altJson,
      tagsJson: stampRevisions.tagsJson,
    })
    .from(stampPacks)
    .innerJoin(
      stampPackReleases,
      eq(stampPackReleases.id, stampPacks.currentReleaseId),
    )
    .innerJoin(
      stampReleaseItems,
      eq(stampReleaseItems.releaseId, stampPackReleases.id),
    )
    .innerJoin(stamps, eq(stamps.id, stampReleaseItems.stampId))
    .innerJoin(
      stampRevisions,
      eq(stampRevisions.id, stampReleaseItems.revisionId),
    )
    .where(and(eq(stampPacks.id, packId), eq(stampPacks.status, "published")))
    .orderBy(stampReleaseItems.sortOrder);

  const first = rows[0];
  if (
    !first ||
    (first.visibility !== "public" && first.visibility !== "unlisted")
  ) {
    return c.json({ error: "Stamp pack not found" }, 404);
  }
  const etag = `"sha256-${first.manifestSha256}"`;
  c.header("ETag", etag);
  c.header("Cache-Control", "public, max-age=300, must-revalidate");
  c.header("Vary", "Accept");
  if (c.req.header("If-None-Match") === etag) return c.body(null, 304);

  const manifest = buildStampPackManifest({
    baseUrl: c.env.APP_URL,
    id: first.packId,
    release: first.releaseNumber,
    name: safeJsonParse<Record<string, string>>(first.nameJson, {}),
    ...(first.descriptionJson
      ? {
          description: safeJsonParse<Record<string, string>>(
            first.descriptionJson,
            {},
          ),
        }
      : {}),
    publisher: first.publisherActorId,
    visibility: first.visibility,
    stamps: rows.flatMap((row) => {
      if (row.mediaType !== "image/webp" && row.mediaType !== "image/png") {
        return [];
      }
      return [
        {
          id: row.stampId,
          key: row.stampKey,
          revision: row.revisionDigest,
          alt: safeJsonParse<Record<string, string>>(row.altJson, {}),
          tags: safeJsonParse<string[]>(row.tagsJson, []),
          asset: {
            url: row.assetUrl,
            mediaType: row.mediaType,
            width: row.width,
            height: row.height,
            sha256: row.assetSha256,
          },
        },
      ];
    }),
  });

  return c.body(JSON.stringify(manifest), 200, {
    "Content-Type": "application/json; charset=utf-8",
  });
});

export default publicStampPacks;
