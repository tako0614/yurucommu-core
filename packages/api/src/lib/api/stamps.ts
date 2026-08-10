import { apiDelete, apiFetch, apiPost, assertOk } from "./fetch.ts";

export type LocalizedText = Record<string, string>;

export interface InstalledStampPack {
  id: string;
  share_url: string;
  publisher_actor_id: string;
  slug: string;
  name: LocalizedText;
  description: LocalizedText | null;
  release: {
    id: string;
    number: number;
    published_at: string;
  };
  rights: Array<"install" | "send">;
  stamps: InstalledStamp[];
}

export interface InstalledStamp {
  id: string;
  key: string;
  favorite: boolean;
  recent: { last_used_at: string; use_count: number } | null;
  revision: {
    id: string;
    digest: `sha256:${string}`;
    asset: {
      url: string;
      media_type: "image/webp" | "image/png";
      width: number;
      height: number;
      sha256: string;
    };
    alt: LocalizedText;
    tags: string[];
  };
}

export interface PublishStampPackInput {
  slug: string;
  name: LocalizedText;
  description?: LocalizedText;
  visibility?: "public" | "unlisted" | "private" | "community";
  stamps: Array<{
    key: string;
    source_r2_key: string;
    alt: LocalizedText;
    tags: string[];
  }>;
}

export interface PublishStampPackResult {
  pack_id: string;
  release_id: string;
  manifest_sha256: string;
  stamps: Array<{
    id: string;
    revision: `sha256:${string}`;
    asset: {
      url: string;
      media_type: "image/webp" | "image/png";
      width: number;
      height: number;
      sha256: string;
    };
  }>;
}

export async function fetchStampPacks(): Promise<InstalledStampPack[]> {
  const res = await apiFetch("/api/stamps/packs");
  await assertOk(res, "Failed to load Stamp packs");
  const data = (await res.json()) as { packs?: InstalledStampPack[] };
  return data.packs ?? [];
}

export async function publishStampPack(
  input: PublishStampPackInput,
): Promise<PublishStampPackResult> {
  const res = await apiPost("/api/stamps/packs", input);
  await assertOk(res, "Failed to publish Stamp pack");
  return (await res.json()) as PublishStampPackResult;
}

export async function installStampPack(
  packId: string,
): Promise<{ pack_id: string; release_id: string }> {
  const res = await apiPost("/api/stamps/install", { pack_id: packId });
  await assertOk(res, "Failed to install Stamp pack");
  return (await res.json()) as { pack_id: string; release_id: string };
}

export async function uninstallStampPack(packId: string): Promise<void> {
  const res = await apiDelete("/api/stamps/install", { pack_id: packId });
  await assertOk(res, "Failed to uninstall Stamp pack");
}

export async function setStampFavorite(
  stampId: string,
  favorite: boolean,
): Promise<void> {
  const res = await apiPost("/api/stamps/favorite", {
    stamp_id: stampId,
    favorite,
  });
  await assertOk(res, "Failed to update Stamp favorite");
}
