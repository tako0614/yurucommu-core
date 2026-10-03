import {
  readResponseJson,
  requiredArray,
  optionalBoolean,
  optionalString,
  requiredCount,
  validateActor,
  validatePost,
} from "./response.ts";
import type { ApiReadOptions } from "./fetch.ts";
import type { Actor, Post } from "../../types/index.ts";
import { normalizeActor, normalizePost } from "./normalize.ts";
import { apiDelete, apiFetch, apiPost, apiPut, assertOk } from "./fetch.ts";

export async function fetchActor(
  identifier: string,
  options?: ApiReadOptions,
): Promise<Actor> {
  const res = await apiFetch(
    `/api/actors/${encodeURIComponent(identifier)}`,
    options,
  );
  await assertOk(res, "Actor not found");
  const data = await readResponseJson(res);
  validateActor(data.actor);
  return normalizeActor(data.actor as Actor);
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
  options?: ApiReadOptions & { limit?: number; before?: string },
): Promise<ActorPostsPage> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(
    `/api/actors/${encodeURIComponent(identifier)}/posts${query}`,
    options,
  );
  await assertOk(res, "Failed to fetch actor posts");
  const data = await readResponseJson(res);
  return {
    posts: requiredArray<Post>(data, "posts", validatePost).map(normalizePost),
    nextCursor: optionalString(data, "next_cursor"),
    hasMore: optionalBoolean(data, "has_more"),
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
  options?: ApiReadOptions & { limit?: number; offset?: number },
): Promise<FollowListPage> {
  const res = await apiFetch(
    `/api/actors/${encodeURIComponent(identifier)}/followers${followListQuery(options)}`,
    options,
  );
  await assertOk(res, "Failed to fetch followers");
  const data = await readResponseJson(res);
  return {
    actors: requiredArray<Actor>(data, "followers", validateActor).map(
      normalizeActor,
    ),
    hasMore: optionalBoolean(data, "has_more"),
    total: requiredCount(data.total, "total"),
  };
}

export async function fetchFollowing(
  identifier: string,
  options?: ApiReadOptions & { limit?: number; offset?: number },
): Promise<FollowListPage> {
  const res = await apiFetch(
    `/api/actors/${encodeURIComponent(identifier)}/following${followListQuery(options)}`,
    options,
  );
  await assertOk(res, "Failed to fetch following");
  const data = await readResponseJson(res);
  return {
    actors: requiredArray<Actor>(data, "following", validateActor).map(
      normalizeActor,
    ),
    hasMore: optionalBoolean(data, "has_more"),
    total: requiredCount(data.total, "total"),
  };
}

export function fetchBlockedUsers(): Promise<Actor[]>;
export function fetchBlockedUsers(options: ApiReadOptions): Promise<Actor[]>;
export async function fetchBlockedUsers(
  options?: ApiReadOptions,
): Promise<Actor[]> {
  const res = await apiFetch("/api/actors/me/blocked", options);
  await assertOk(res, "Failed to fetch blocked users");
  const data = await readResponseJson(res);
  return requiredArray<Actor>(data, "blocked", validateActor).map(
    normalizeActor,
  );
}

export async function blockUser(apId: string): Promise<void> {
  const res = await apiPost("/api/actors/me/blocked", { ap_id: apId });
  await assertOk(res, "Failed to block user");
}

export async function unblockUser(apId: string): Promise<void> {
  const res = await apiDelete("/api/actors/me/blocked", { ap_id: apId });
  await assertOk(res, "Failed to unblock user");
}

export function fetchMutedUsers(): Promise<Actor[]>;
export function fetchMutedUsers(options: ApiReadOptions): Promise<Actor[]>;
export async function fetchMutedUsers(
  options?: ApiReadOptions,
): Promise<Actor[]> {
  const res = await apiFetch("/api/actors/me/muted", options);
  await assertOk(res, "Failed to fetch muted users");
  const data = await readResponseJson(res);
  return requiredArray<Actor>(data, "muted", validateActor).map(normalizeActor);
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
