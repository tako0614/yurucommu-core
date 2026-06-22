import type { Actor, Post } from "../../types/index.ts";
import { normalizeActor, normalizePost } from "./normalize.ts";
import { apiFetch } from "./fetch.ts";

export interface SearchPageOpts {
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
  const res = await apiFetch(`/api/search/actors?${pageParams(query, opts)}`);
  const data = (await res.json()) as { actors?: Actor[]; has_more?: boolean };
  return {
    items: (data.actors || []).map(normalizeActor),
    hasMore: data.has_more ?? false,
  };
}

export async function searchRemote(query: string): Promise<Actor[]> {
  const res = await apiFetch(
    `/api/search/remote?q=${encodeURIComponent(query)}`,
  );
  const data = (await res.json()) as { actors?: Actor[] };
  return (data.actors || []).map(normalizeActor);
}

export async function searchPosts(
  query: string,
  opts?: SearchPageOpts,
): Promise<Paged<Post>> {
  const res = await apiFetch(`/api/search/posts?${pageParams(query, opts)}`);
  const data = (await res.json()) as { posts?: Post[]; has_more?: boolean };
  return {
    items: (data.posts || []).map(normalizePost),
    hasMore: data.has_more ?? false,
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
  );
  const data = (await res.json()) as { posts?: Post[]; has_more?: boolean };
  return {
    items: (data.posts || []).map(normalizePost),
    hasMore: data.has_more ?? false,
  };
}

export async function fetchTrendingHashtags(
  limit = 10,
): Promise<{ tag: string; count: number }[]> {
  const res = await apiFetch(`/api/search/hashtags/trending?limit=${limit}`);
  const data = (await res.json()) as {
    trending?: { tag: string; count: number }[];
  };
  return data.trending || [];
}
