import type { Actor, Post } from '../../types/index.ts';
import { normalizeActor, normalizePost } from './normalize.ts';
import { apiFetch } from './fetch.ts';

export async function searchActors(query: string): Promise<Actor[]> {
  const res = await apiFetch(`/api/search/actors?q=${encodeURIComponent(query)}`);
  const data = (await res.json()) as { actors?: Actor[] };
  return (data.actors || []).map(normalizeActor);
}

export async function searchRemote(query: string): Promise<Actor[]> {
  const res = await apiFetch(`/api/search/remote?q=${encodeURIComponent(query)}`);
  const data = (await res.json()) as { actors?: Actor[] };
  return (data.actors || []).map(normalizeActor);
}

export async function searchPosts(query: string): Promise<Post[]> {
  const res = await apiFetch(`/api/search/posts?q=${encodeURIComponent(query)}`);
  const data = (await res.json()) as { posts?: Post[] };
  return (data.posts || []).map(normalizePost);
}

export async function fetchTrendingHashtags(limit = 10): Promise<{ tag: string; count: number }[]> {
  const res = await apiFetch(`/api/search/hashtags/trending?limit=${limit}`);
  const data = (await res.json()) as { trending?: { tag: string; count: number }[] };
  return data.trending || [];
}
