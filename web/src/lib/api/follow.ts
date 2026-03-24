import type { Actor } from '../../types';
import { normalizeActor } from './normalize';
import { apiFetch, apiPost, apiDelete } from './fetch';

export async function follow(targetApId: string): Promise<{ status: string }> {
  const res = await apiPost('/api/follow', { target_ap_id: targetApId });
  if (!res.ok) throw new Error('Failed to follow');
  return (await res.json()) as { status: string };
}

export async function unfollow(targetApId: string): Promise<void> {
  const res = await apiDelete('/api/follow', { target_ap_id: targetApId });
  if (!res.ok) throw new Error('Failed to unfollow');
}

export async function fetchFollowRequests(): Promise<Actor[]> {
  const res = await apiFetch('/api/follow/requests');
  const data = (await res.json()) as { requests?: Actor[] };
  return (data.requests || []).map(normalizeActor);
}

export async function acceptFollowRequest(requesterApId: string): Promise<void> {
  const res = await apiPost('/api/follow/accept', { requester_ap_id: requesterApId });
  if (!res.ok) throw new Error('Failed to accept');
}

export async function acceptFollowRequestsBatch(
  requesterApIds: string[]
): Promise<{ results: { ap_id: string; success: boolean; error?: string }[]; accepted_count: number }> {
  const res = await apiPost('/api/follow/accept/batch', { requester_ap_ids: requesterApIds });
  if (!res.ok) throw new Error('Failed to accept follow requests');
  return (await res.json()) as { results: { ap_id: string; success: boolean; error?: string }[]; accepted_count: number };
}

export async function rejectFollowRequest(requesterApId: string): Promise<void> {
  const res = await apiPost('/api/follow/reject', { requester_ap_id: requesterApId });
  if (!res.ok) throw new Error('Failed to reject');
}
