import { and, eq, gt, isNull, or, sql } from "drizzle-orm";

import type { Database } from "../../db/index.ts";
import {
  stampEntitlements,
  stampInstallations,
  stampPacks,
  stampRecents,
  stampReleaseItems,
  stampRevisions,
  stamps,
} from "../../db/index.ts";
import { isSafeRemoteUrl, safeJsonParse } from "../federation-helpers.ts";

export const MAX_STAMP_URI_LENGTH = 2048;
export const MAX_STAMP_ALT_LENGTH = 200;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const REVISION_DIGEST = /^sha256:[a-f0-9]{64}$/;

export type StampSelection = { stamp_id: string };

export type MessageStampSnapshot = {
  id: string;
  pack_id: string;
  revision: string;
  asset: {
    url: string;
    media_type: "image/webp" | "image/png";
    width: number;
    height: number;
    sha256: string;
  };
  alt: string;
};

export type StoredStampAttachment = {
  type: "Image";
  url: string;
  r2_key: string;
  content_type: "image/webp" | "image/png";
  name: string;
  stamp: string;
  stamp_pack: string;
  stamp_revision: string;
  stamp_sha256: string;
  width: number;
  height: number;
};

type ResolvedSendableStamp = {
  snapshot: MessageStampSnapshot;
  attachment: StoredStampAttachment;
  revisionId: string;
  localAssetR2Key: string;
};

export type ResolveSendableStampResult =
  | { ok: true; stamp: ResolvedSendableStamp }
  | { ok: false; status: 400 | 403 | 409; error: string };

export type MessageStampRefProjection = {
  stampUri: string | null;
  packUri: string | null;
  revisionDigest: string | null;
  remoteAssetUrl: string | null;
  localAssetR2Key: string | null;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  assetSha256: string | null;
  altText: string | null;
};

export type InboundMessageStampRef = {
  stampUri: string;
  packUri: string;
  revisionDigest: string;
  remoteAssetUrl: string;
  mediaType: "image/webp" | "image/png";
  width: number;
  height: number;
  assetSha256: string;
  altText: string;
};

export function normalizeStampUri(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_STAMP_URI_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseStampSelection(value: unknown): StampSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "stamp_id")) return null;
  const stampId = normalizeStampUri(record.stamp_id);
  return stampId ? { stamp_id: stampId } : null;
}

/**
 * Recognize the optional Yurucommu extension on an already-bounded AP
 * attachment projection. Invalid or partial metadata deliberately degrades to
 * an ordinary Image attachment instead of rejecting the enclosing Note.
 */
export function inboundStampRefFromAttachmentsJson(
  attachmentsJson: string,
): InboundMessageStampRef | null {
  const attachments = safeJsonParse<unknown>(attachmentsJson, []);
  if (!Array.isArray(attachments)) return null;

  for (const candidate of attachments) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const attachment = candidate as Record<string, unknown>;
    const type = attachment.type;
    const isImage = Array.isArray(type)
      ? type.includes("Image")
      : type === "Image";
    const stampUri = normalizeStampUri(attachment["yurucommu:stamp"]);
    const packUri = normalizeStampUri(attachment["yurucommu:pack"]);
    const revisionDigest = attachment["yurucommu:revision"];
    const assetSha256 = attachment["yurucommu:sha256"];
    const remoteAssetUrl = attachment.url;
    const mediaType = attachment.mediaType;
    const width = attachment.width;
    const height = attachment.height;
    const name = attachment.name;

    if (
      !isImage ||
      !stampUri ||
      !isSafeRemoteUrl(stampUri) ||
      !packUri ||
      !isSafeRemoteUrl(packUri) ||
      typeof revisionDigest !== "string" ||
      !REVISION_DIGEST.test(revisionDigest) ||
      typeof assetSha256 !== "string" ||
      !SHA256_HEX.test(assetSha256) ||
      typeof remoteAssetUrl !== "string" ||
      remoteAssetUrl.length > MAX_STAMP_URI_LENGTH ||
      !isSafeRemoteUrl(remoteAssetUrl) ||
      (mediaType !== "image/webp" && mediaType !== "image/png") ||
      typeof width !== "number" ||
      !Number.isInteger(width) ||
      width < 1 ||
      width > 512 ||
      typeof height !== "number" ||
      !Number.isInteger(height) ||
      height < 1 ||
      height > 512 ||
      typeof name !== "string" ||
      name.length > MAX_STAMP_ALT_LENGTH ||
      name.trim().length === 0
    ) {
      continue;
    }

    return {
      stampUri,
      packUri,
      revisionDigest,
      remoteAssetUrl,
      mediaType,
      width,
      height,
      assetSha256,
      altText: name.trim(),
    };
  }

  return null;
}

function localizedText(json: string): Record<string, string> {
  const value = safeJsonParse<unknown>(json, {});
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [locale, text] of Object.entries(value)) {
    if (typeof text !== "string") continue;
    const normalized = text.trim().slice(0, MAX_STAMP_ALT_LENGTH);
    if (normalized) result[locale.toLowerCase()] = normalized;
  }
  return result;
}

function selectAlt(json: string, acceptLanguage?: string): string | null {
  const values = localizedText(json);
  const preferred = (acceptLanguage ?? "")
    .split(",")
    .map((part) => part.split(";", 1)[0]?.trim().toLowerCase())
    .filter((part): part is string => !!part);
  for (const locale of [...preferred, "ja", "en"]) {
    const exact = values[locale];
    if (exact) return exact;
    const base = values[locale.split("-", 1)[0] ?? ""];
    if (base) return base;
  }
  return Object.values(values)[0] ?? null;
}

/** Format only the immutable Message-owned row; never join back to live Stamp. */
export function messageStampSnapshotFromProjection(
  row: MessageStampRefProjection,
): MessageStampSnapshot | null {
  const mediaType = row.mediaType;
  if (
    !row.stampUri ||
    !row.packUri ||
    !row.revisionDigest ||
    !REVISION_DIGEST.test(row.revisionDigest) ||
    !row.assetSha256 ||
    !SHA256_HEX.test(row.assetSha256) ||
    !row.altText ||
    (mediaType !== "image/webp" && mediaType !== "image/png") ||
    row.width === null ||
    row.width < 1 ||
    row.width > 512 ||
    row.height === null ||
    row.height < 1 ||
    row.height > 512
  ) {
    return null;
  }

  const extension = mediaType === "image/webp" ? "webp" : "png";
  const assetUrl = row.localAssetR2Key
    ? `/media/stamps/${row.assetSha256}.${extension}`
    : row.remoteAssetUrl;
  if (!assetUrl) return null;

  return {
    id: row.stampUri,
    pack_id: row.packUri,
    revision: row.revisionDigest,
    asset: {
      url: assetUrl,
      media_type: mediaType,
      width: row.width,
      height: row.height,
      sha256: row.assetSha256,
    },
    alt: row.altText,
  };
}

/** Resolve one Actor's picker selection to the exact installed revision. */
export async function resolveSendableStamp(
  db: Database,
  actorApId: string,
  rawSelection: unknown,
  options?: { acceptLanguage?: string },
): Promise<ResolveSendableStampResult> {
  const selection = parseStampSelection(rawSelection);
  if (!selection) {
    return { ok: false, status: 400, error: "Invalid Stamp selection" };
  }

  const now = new Date().toISOString();
  const row = await db
    .select({
      stampId: stamps.id,
      packId: stamps.packId,
      revisionId: stampRevisions.id,
      revisionDigest: stampRevisions.revisionDigest,
      assetUrl: stampRevisions.assetUrl,
      assetR2Key: stampRevisions.assetR2Key,
      mediaType: stampRevisions.mediaType,
      width: stampRevisions.width,
      height: stampRevisions.height,
      assetSha256: stampRevisions.assetSha256,
      altJson: stampRevisions.altJson,
    })
    .from(stamps)
    .innerJoin(stampPacks, eq(stampPacks.id, stamps.packId))
    .innerJoin(
      stampInstallations,
      and(
        eq(stampInstallations.actorApId, actorApId),
        eq(stampInstallations.packId, stamps.packId),
      ),
    )
    .innerJoin(
      stampReleaseItems,
      and(
        eq(stampReleaseItems.releaseId, stampInstallations.installedReleaseId),
        eq(stampReleaseItems.stampId, stamps.id),
      ),
    )
    .innerJoin(
      stampRevisions,
      eq(stampRevisions.id, stampReleaseItems.revisionId),
    )
    .innerJoin(
      stampEntitlements,
      and(
        eq(stampEntitlements.actorApId, actorApId),
        eq(stampEntitlements.packId, stamps.packId),
      ),
    )
    .where(
      and(
        eq(stamps.id, selection.stamp_id),
        eq(stamps.enabled, true),
        eq(stampPacks.status, "published"),
        eq(stampEntitlements.canSend, true),
        isNull(stampEntitlements.revokedAt),
        or(
          isNull(stampEntitlements.expiresAt),
          gt(stampEntitlements.expiresAt, now),
        ),
      ),
    )
    .get();

  if (!row) {
    return {
      ok: false,
      status: 403,
      error: "Stamp is not installed or send permission is unavailable",
    };
  }

  const alt = selectAlt(row.altJson, options?.acceptLanguage);
  const mediaType = row.mediaType;
  if (
    !alt ||
    !row.assetR2Key ||
    !REVISION_DIGEST.test(row.revisionDigest) ||
    !SHA256_HEX.test(row.assetSha256) ||
    (mediaType !== "image/webp" && mediaType !== "image/png") ||
    row.width < 1 ||
    row.width > 512 ||
    row.height < 1 ||
    row.height > 512
  ) {
    return {
      ok: false,
      status: 409,
      error: "Installed Stamp revision is invalid",
    };
  }

  const snapshot: MessageStampSnapshot = {
    id: row.stampId,
    pack_id: row.packId,
    revision: row.revisionDigest,
    asset: {
      url: row.assetUrl,
      media_type: mediaType,
      width: row.width,
      height: row.height,
      sha256: row.assetSha256,
    },
    alt,
  };

  return {
    ok: true,
    stamp: {
      snapshot,
      revisionId: row.revisionId,
      localAssetR2Key: row.assetR2Key,
      attachment: {
        type: "Image",
        url: row.assetUrl,
        r2_key: row.assetR2Key,
        content_type: mediaType,
        name: alt,
        stamp: row.stampId,
        stamp_pack: row.packId,
        stamp_revision: row.revisionDigest,
        stamp_sha256: row.assetSha256,
        width: row.width,
        height: row.height,
      },
    },
  };
}

export function recordStampRecent(
  db: Database,
  actorApId: string,
  stampId: string,
  usedAt: string,
) {
  return db
    .insert(stampRecents)
    .values({
      actorApId,
      stampId,
      lastUsedAt: usedAt,
      useCount: 1,
    })
    .onConflictDoUpdate({
      target: [stampRecents.actorApId, stampRecents.stampId],
      set: {
        lastUsedAt: usedAt,
        useCount: sql`${stampRecents.useCount} + 1`,
      },
    });
}
