import type { Story, StoryOverlay, ActorStories } from '../../types';
import { normalizeActorStories, normalizeStory } from './normalize';

export async function fetchStories(): Promise<ActorStories[]> {
  const res = await fetch('/api/stories');
  if (!res.ok) throw new Error('Failed to fetch stories');
  const data = await res.json();
  return (data.actor_stories || []).map(normalizeActorStories);
}

export async function fetchActorStories(actorId: string): Promise<Story[]> {
  const res = await fetch(`/api/stories/${encodeURIComponent(actorId)}`);
  if (!res.ok) throw new Error('Failed to fetch actor stories');
  const data = await res.json();
  return (data.stories || []).map(normalizeStory);
}

export async function createStory(story: {
  attachment: { r2_key: string; content_type: string };
  displayDuration: string;
  overlays?: StoryOverlay[];
}): Promise<Story> {
  const res = await fetch('/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(story),
  });
  if (!res.ok) throw new Error('Failed to create story');
  const data = await res.json();
  return normalizeStory(data.story);
}

export async function deleteStory(apId: string): Promise<void> {
  const res = await fetch('/api/stories/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ap_id: apId }),
  });
  if (!res.ok) throw new Error('Failed to delete story');
}

export async function markStoryViewed(apId: string): Promise<void> {
  const res = await fetch('/api/stories/view', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ap_id: apId }),
  });
  if (!res.ok) throw new Error('Failed to mark story as viewed');
}

export async function voteOnStory(
  apId: string,
  optionIndex: number
): Promise<{ votes: Record<number, number>; total: number; user_vote: number }> {
  const res = await fetch('/api/stories/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ap_id: apId, option_index: optionIndex }),
  });
  if (!res.ok) throw new Error('Failed to vote on story');
  return res.json();
}

export async function likeStory(apId: string): Promise<{ liked: boolean; like_count: number }> {
  const res = await fetch(`/api/stories/${encodeURIComponent(apId)}/like`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to like story');
  return res.json();
}

export async function unlikeStory(apId: string): Promise<{ liked: boolean; like_count: number }> {
  const res = await fetch(`/api/stories/${encodeURIComponent(apId)}/like`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to unlike story');
  return res.json();
}

export async function shareStory(apId: string): Promise<{ shared: boolean; share_count: number }> {
  const res = await fetch(`/api/stories/${encodeURIComponent(apId)}/share`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to share story');
  return res.json();
}
