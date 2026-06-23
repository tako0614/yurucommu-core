import type { Actor, Post } from "../../types/index.ts";
import { normalizeActor, normalizePost } from "./normalize.ts";
import { apiDelete, apiFetch, apiPost, apiPut, assertOk } from "./fetch.ts";

export async function fetchActors(): Promise<Actor[]> {
  const res = await apiFetch("/api/actors");
  const data = (await res.json()) as { actors?: Actor[] };
  return (data.actors || []).map(normalizeActor);
}

export async function fetchActor(identifier: string): Promise<Actor> {
  const res = await apiFetch(`/api/actors/${encodeURIComponent(identifier)}`);
  await assertOk(res, "Actor not found");
  const data = (await res.json()) as { actor: Actor };
  return normalizeActor(data.actor);
}

export async function updateProfile(data: {
  name?: string;
  summary?: string;
  icon_url?: string;
  header_url?: string;
  is_private?: boolean;
  // Structured PropertyValue profile fields. PUT /me replaces the stored set
  // with this array (backend caps it at 4 and sanitizes name/value).
  fields?: { name: string; value: string }[];
}): Promise<void> {
  const res = await apiPut("/api/actors/me", data);
  await assertOk(res, "Failed to update profile");
}

export interface ActorPostsPage {
  posts: Post[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function fetchActorPosts(
  identifier: string,
  options?: { limit?: number; before?: string },
): Promise<ActorPostsPage> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(
    `/api/actors/${encodeURIComponent(identifier)}/posts${query}`,
  );
  await assertOk(res, "Failed to fetch actor posts");
  const data = (await res.json()) as {
    posts?: Post[];
    next_cursor?: string | null;
    has_more?: boolean;
  };
  return {
    posts: (data.posts || []).map(normalizePost),
    nextCursor: data.next_cursor ?? null,
    hasMore: data.has_more ?? false,
  };
}

export interface FollowListPage {
  actors: Actor[];
  hasMore: boolean;
  total: number;
}

function followListQuery(options?: {
  limit?: number;
  offset?: number;
}): string {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  return params.toString() ? `?${params}` : "";
}

export async function fetchFollowers(
  identifier: string,
  options?: { limit?: number; offset?: number },
): Promise<FollowListPage> {
  const res = await apiFetch(
    `/api/actors/${encodeURIComponent(identifier)}/followers${followListQuery(options)}`,
  );
  await assertOk(res, "Failed to fetch followers");
  const data = (await res.json()) as {
    followers?: Actor[];
    has_more?: boolean;
    total?: number;
  };
  return {
    actors: (data.followers || []).map(normalizeActor),
    hasMore: data.has_more ?? false,
    total: data.total ?? 0,
  };
}

export async function fetchFollowing(
  identifier: string,
  options?: { limit?: number; offset?: number },
): Promise<FollowListPage> {
  const res = await apiFetch(
    `/api/actors/${encodeURIComponent(identifier)}/following${followListQuery(options)}`,
  );
  await assertOk(res, "Failed to fetch following");
  const data = (await res.json()) as {
    following?: Actor[];
    has_more?: boolean;
    total?: number;
  };
  return {
    actors: (data.following || []).map(normalizeActor),
    hasMore: data.has_more ?? false,
    total: data.total ?? 0,
  };
}

export async function fetchBlockedUsers(): Promise<Actor[]> {
  const res = await apiFetch("/api/actors/me/blocked");
  await assertOk(res, "Failed to fetch blocked users");
  const data = (await res.json()) as { blocked?: Actor[] };
  return (data.blocked || []).map(normalizeActor);
}

export async function blockUser(apId: string): Promise<void> {
  const res = await apiPost("/api/actors/me/blocked", { ap_id: apId });
  await assertOk(res, "Failed to block user");
}

export async function unblockUser(apId: string): Promise<void> {
  const res = await apiDelete("/api/actors/me/blocked", { ap_id: apId });
  await assertOk(res, "Failed to unblock user");
}

export async function fetchMutedUsers(): Promise<Actor[]> {
  const res = await apiFetch("/api/actors/me/muted");
  await assertOk(res, "Failed to fetch muted users");
  const data = (await res.json()) as { muted?: Actor[] };
  return (data.muted || []).map(normalizeActor);
}

export async function muteUser(apId: string): Promise<void> {
  const res = await apiPost("/api/actors/me/muted", { ap_id: apId });
  await assertOk(res, "Failed to mute user");
}

export async function unmuteUser(apId: string): Promise<void> {
  const res = await apiDelete("/api/actors/me/muted", { ap_id: apId });
  await assertOk(res, "Failed to unmute user");
}

export async function deleteAccount(): Promise<void> {
  const res = await apiPost("/api/actors/me/delete");
  await assertOk(res, "Failed to delete account");
}
