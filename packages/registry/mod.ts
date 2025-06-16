import { TakoUnpackResult, unpackTakoPack } from "@takopack/unpack";

export interface RegistryPackage {
  identifier: string;
  name: string;
  version: string;
  description?: string;
  /** Data URL for icon image if available */
  icon?: string;
  downloadUrl: string;
  sha256?: string;
}

export interface RegistryIndex {
  packages: RegistryPackage[];
}

export interface FetchIndexOptions {
  /** ETag from previous fetch. */
  etag?: string;
  /** Last-Modified value from previous fetch. */
  lastModified?: string;
}

export interface FetchIndexResult {
  /** null if not modified. */
  index: RegistryIndex | null;
  etag?: string;
  lastModified?: string;
}

export interface SearchOptions {
  q?: string;
  limit?: number;
}

export interface FetchPackageResult {
  pkg: RegistryPackage | null;
  etag?: string;
  lastModified?: string;
}

/** Fetch registry index JSON from given URL. */
export async function fetchRegistryIndex(
  url: string,
  options: FetchIndexOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<FetchIndexResult> {
  const headers: Record<string, string> = {};
  if (options.etag) headers["If-None-Match"] = options.etag;
  if (options.lastModified) headers["If-Modified-Since"] = options.lastModified;
  const res = await fetchImpl(url, { headers });
  const etag = res.headers.get("ETag") ?? undefined;
  const lastModified = res.headers.get("Last-Modified") ?? undefined;
  if (res.status === 304) {
    return { index: null, etag, lastModified };
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch registry index: ${res.status}`);
  }
  return { index: await res.json(), etag, lastModified };
}

/** Search registry with query parameters. */
export async function searchRegistry(
  url: string,
  options: SearchOptions & FetchIndexOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<FetchIndexResult> {
  const u = new URL(url);
  if (options.q) u.searchParams.set("q", options.q);
  if (options.limit) u.searchParams.set("limit", String(options.limit));
  const headers: Record<string, string> = {};
  if (options.etag) headers["If-None-Match"] = options.etag;
  if (options.lastModified) headers["If-Modified-Since"] = options.lastModified;
  const res = await fetchImpl(u.toString(), { headers });
  const etag = res.headers.get("ETag") ?? undefined;
  const lastModified = res.headers.get("Last-Modified") ?? undefined;
  if (res.status === 304) {
    return { index: null, etag, lastModified };
  }
  if (!res.ok) {
    throw new Error(`Failed to search registry: ${res.status}`);
  }
  return { index: await res.json(), etag, lastModified };
}

/** Fetch info about a specific package by identifier. */
export async function fetchPackageInfo(
  url: string,
  id: string,
  options: FetchIndexOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<FetchPackageResult> {
  const u = url.endsWith("/")
    ? `${url}packages/${id}`
    : `${url}/packages/${id}`;
  const headers: Record<string, string> = {};
  if (options.etag) headers["If-None-Match"] = options.etag;
  if (options.lastModified) headers["If-Modified-Since"] = options.lastModified;
  const res = await fetchImpl(u, { headers });
  const etag = res.headers.get("ETag") ?? undefined;
  const lastModified = res.headers.get("Last-Modified") ?? undefined;
  if (res.status === 304) {
    return { pkg: null, etag, lastModified };
  }
  if (res.status === 404) {
    throw new Error(`Package ${id} not found`);
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch package info: ${res.status}`);
  }
  return { pkg: await res.json(), etag, lastModified };
}

/**
 * Download a Takopack archive described by `pkg` and unpack it.
 * The optional `sha256` field is used to verify file integrity.
 */
export async function downloadAndUnpack(
  pkg: RegistryPackage,
  fetchImpl: typeof fetch = fetch,
): Promise<TakoUnpackResult> {
  const res = await fetchImpl(pkg.downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to download package ${pkg.identifier}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (pkg.sha256) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (hex !== pkg.sha256) {
      throw new Error("Package integrity check failed");
    }
  }
  return unpackTakoPack(bytes);
}
