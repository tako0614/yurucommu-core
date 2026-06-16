import type { ActorStories, Story, StoryOverlay } from "../../types/index.ts";
import { normalizeActorStories, normalizeStory } from "./normalize.ts";
import { apiDelete, apiFetch, apiPost, assertOk } from "./fetch.ts";

export async function fetchStories(
  community?: string,
): Promise<ActorStories[]> {
  const qs = community ? `?community=${encodeURIComponent(community)}` : "";
  const res = await apiFetch(`/api/stories${qs}`);
  await assertOk(res, "Failed to fetch stories");
  const data = (await res.json()) as { actor_stories?: ActorStories[] };
  return (data.actor_stories || []).map(normalizeActorStories);
}

export async function fetchActorStories(
  actorId: string,
  community?: string,
): Promise<Story[]> {
  const qs = community ? `?community=${encodeURIComponent(community)}` : "";
  const res = await apiFetch(
    `/api/stories/${encodeURIComponent(actorId)}${qs}`,
  );
  await assertOk(res, "Failed to fetch actor stories");
  const data = (await res.json()) as { stories?: Story[] };
  return (data.stories || []).map(normalizeStory);
}

export async function createStory(story: {
  attachment: { url?: string; r2_key: string; content_type: string };
  displayDuration: string;
  overlays?: StoryOverlay[];
  community_ap_id?: string;
}): Promise<Story> {
  const res = await apiPost("/api/stories", story);
  await assertOk(res, "Failed to create story");
  const data = (await res.json()) as { story: Story };
  return normalizeStory(data.story);
}

export async function deleteStory(apId: string): Promise<void> {
  const res = await apiPost("/api/stories/delete", { ap_id: apId });
  await assertOk(res, "Failed to delete story");
}

export async function markStoryViewed(apId: string): Promise<void> {
  const res = await apiPost("/api/stories/view", { ap_id: apId });
  await assertOk(res, "Failed to mark story as viewed");
}

export async function voteOnStory(
  apId: string,
  optionIndex: number,
): Promise<{
  votes: Record<number, number>;
  total: number;
  user_vote: number;
}> {
  const res = await apiPost("/api/stories/vote", {
    ap_id: apId,
    option_index: optionIndex,
  });
  await assertOk(res, "Failed to vote on story");
  return (await res.json()) as {
    votes: Record<number, number>;
    total: number;
    user_vote: number;
  };
}

export async function likeStory(
  apId: string,
): Promise<{ liked: boolean; like_count: number }> {
  const res = await apiPost(`/api/stories/${encodeURIComponent(apId)}/like`);
  await assertOk(res, "Failed to like story");
  return (await res.json()) as { liked: boolean; like_count: number };
}

export async function unlikeStory(
  apId: string,
): Promise<{ liked: boolean; like_count: number }> {
  const res = await apiDelete(`/api/stories/${encodeURIComponent(apId)}/like`);
  await assertOk(res, "Failed to unlike story");
  return (await res.json()) as { liked: boolean; like_count: number };
}

export async function shareStory(
  apId: string,
): Promise<{ shared: boolean; share_count: number }> {
  const res = await apiPost(`/api/stories/${encodeURIComponent(apId)}/share`);
  await assertOk(res, "Failed to share story");
  return (await res.json()) as { shared: boolean; share_count: number };
}
