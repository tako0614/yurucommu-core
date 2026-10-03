import {
  readResponseJson,
  requiredArray,
  optionalBoolean,
  requiredCount,
  responseObject,
  requiredString,
  validateActor,
  validatePost,
} from "./response.ts";
import type { ApiReadOptions } from "./fetch.ts";
import type { Actor, Post } from "../../types/index.ts";
import { normalizeActor, normalizePost } from "./normalize.ts";
import { apiFetch, assertOk } from "./fetch.ts";

export interface SearchPageOpts extends ApiReadOptions {
  sort?: string;
  offset?: number;
  limit?: number;
}

export interface Paged<T> {
  items: T[];
  hasMore: boolean;
}

function pageParams(query: string, opts?: SearchPageOpts): string {
  const params = new URLSearchParams({ q: query });
  if (opts?.sort) params.set("sort", opts.sort);
  if (opts?.offset) params.set("offset", String(opts.offset));
  if (opts?.limit) params.set("limit", String(opts.limit));
  return params.toString();
}

export async function searchActors(
  query: string,
  opts?: SearchPageOpts,
): Promise<Paged<Actor>> {
  const res = await apiFetch(
    `/api/search/actors?${pageParams(query, opts)}`,
    opts,
  );
  await assertOk(res, "Failed to search actors");
  const data = await readResponseJson(res);
  return {
    items: requiredArray<Actor>(data, "actors", validateActor).map(
      normalizeActor,
    ),
    hasMore: optionalBoolean(data, "has_more"),
  };
}

export async function searchRemote(
  query: string,
  opts?: ApiReadOptions,
): Promise<Actor[]> {
  const res = await apiFetch(
    `/api/search/remote?q=${encodeURIComponent(query)}`,
    opts,
  );
  await assertOk(res, "Failed to search remote actors");
  const data = await readResponseJson(res);
  return requiredArray<Actor>(data, "actors", validateActor).map(
    normalizeActor,
  );
}

export async function searchPosts(
  query: string,
  opts?: SearchPageOpts,
): Promise<Paged<Post>> {
  const res = await apiFetch(
    `/api/search/posts?${pageParams(query, opts)}`,
    opts,
  );
  await assertOk(res, "Failed to search posts");
  const data = await readResponseJson(res);
  return {
    items: requiredArray<Post>(data, "posts", validatePost).map(normalizePost),
    hasMore: optionalBoolean(data, "has_more"),
  };
}

// Exact whole-hashtag search. Unlike searchPosts (a substring/FTS content
// match, where "#deploy" also hits "#deployed"), this hits the dedicated
// /search/hashtag/:tag route which matches the tag as a complete token — the
// behaviour a user expects when they click a #hashtag. Pass the tag WITHOUT the
// leading '#'.
export async function searchHashtag(
  tag: string,
  opts?: SearchPageOpts,
): Promise<Paged<Post>> {
  const params = new URLSearchParams();
  if (opts?.sort) params.set("sort", opts.sort);
  if (opts?.offset) params.set("offset", String(opts.offset));
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await apiFetch(
    `/api/search/hashtag/${encodeURIComponent(tag)}${qs ? `?${qs}` : ""}`,
    opts,
  );
  await assertOk(res, "Failed to search posts");
  const data = await readResponseJson(res);
  return {
    items: requiredArray<Post>(data, "posts", validatePost).map(normalizePost),
    hasMore: optionalBoolean(data, "has_more"),
  };
}

export async function fetchTrendingHashtags(
  limit = 10,
  opts?: ApiReadOptions,
): Promise<{ tag: string; count: number }[]> {
  const res = await apiFetch(
    `/api/search/hashtags/trending?limit=${limit}`,
    opts,
  );
  await assertOk(res, "Failed to load trending hashtags");
  const data = await readResponseJson(res);
  return requiredArray<{ tag: string; count: number }>(
    data,
    "trending",
    (value) => {
      const entry = responseObject(value, "trending entry");
      requiredString(entry.tag, "trending.tag");
      requiredCount(entry.count, "trending.count");
    },
  );
}
