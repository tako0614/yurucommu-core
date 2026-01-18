import type { Actor, Post } from '../../types';
import { normalizeActor, normalizePost } from './normalize';
import { apiFetch } from './fetch';

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
