import type { Actor, Post } from '../../types';
import { normalizeActor, normalizePost } from './normalize';

export async function fetchActors(): Promise<Actor[]> {
  const res = await fetch('/api/actors');
  const data = await res.json();
  return (data.actors || []).map(normalizeActor);
}

export async function fetchActor(identifier: string): Promise<Actor> {
  const res = await fetch(`/api/actors/${encodeURIComponent(identifier)}`);
  if (!res.ok) throw new Error('Actor not found');
  const data = await res.json();
  return normalizeActor(data.actor);
}

export async function updateProfile(data: {
  name?: string;
  summary?: string;
  icon_url?: string;
  header_url?: string;
  is_private?: boolean;
}): Promise<void> {
  const res = await fetch('/api/actors/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update profile');
}

export async function fetchActorPosts(
  identifier: string,
  options?: { limit?: number; before?: string }
): Promise<Post[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`/api/actors/${encodeURIComponent(identifier)}/posts${query}`);
  if (!res.ok) throw new Error('Failed to fetch actor posts');
  const data = await res.json();
  return (data.posts || []).map(normalizePost);
}

export async function fetchFollowers(identifier: string): Promise<Actor[]> {
  const res = await fetch(`/api/actors/${encodeURIComponent(identifier)}/followers`);
  const data = await res.json();
  return (data.followers || []).map(normalizeActor);
}

export async function fetchFollowing(identifier: string): Promise<Actor[]> {
  const res = await fetch(`/api/actors/${encodeURIComponent(identifier)}/following`);
  const data = await res.json();
  return (data.following || []).map(normalizeActor);
}

export async function fetchBlockedUsers(): Promise<Actor[]> {
  const res = await fetch('/api/actors/me/blocked');
  if (!res.ok) throw new Error('Failed to fetch blocked users');
  const data = await res.json();
  return (data.blocked || []).map(normalizeActor);
}

export async function blockUser(apId: string): Promise<void> {
  const res = await fetch('/api/actors/me/blocked', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ap_id: apId }),
  });
  if (!res.ok) throw new Error('Failed to block user');
}

export async function unblockUser(apId: string): Promise<void> {
  const res = await fetch('/api/actors/me/blocked', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ap_id: apId }),
  });
  if (!res.ok) throw new Error('Failed to unblock user');
}

export async function fetchMutedUsers(): Promise<Actor[]> {
  const res = await fetch('/api/actors/me/muted');
  if (!res.ok) throw new Error('Failed to fetch muted users');
  const data = await res.json();
  return (data.muted || []).map(normalizeActor);
}

export async function muteUser(apId: string): Promise<void> {
  const res = await fetch('/api/actors/me/muted', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ap_id: apId }),
  });
  if (!res.ok) throw new Error('Failed to mute user');
}

export async function unmuteUser(apId: string): Promise<void> {
  const res = await fetch('/api/actors/me/muted', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ap_id: apId }),
  });
  if (!res.ok) throw new Error('Failed to unmute user');
}

export async function deleteAccount(): Promise<void> {
  const res = await fetch('/api/actors/me/delete', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to delete account');
}
