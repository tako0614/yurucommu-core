import type { Actor } from '../../types';
import { normalizeActor } from './normalize';

export async function follow(targetApId: string): Promise<{ status: string }> {
  const res = await fetch('/api/follow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_ap_id: targetApId }),
  });
  if (!res.ok) throw new Error('Failed to follow');
  return res.json();
}

export async function unfollow(targetApId: string): Promise<void> {
  const res = await fetch('/api/follow', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_ap_id: targetApId }),
  });
  if (!res.ok) throw new Error('Failed to unfollow');
}

export async function fetchFollowRequests(): Promise<Actor[]> {
  const res = await fetch('/api/follow/requests');
  const data = await res.json();
  return (data.requests || []).map(normalizeActor);
}

export async function acceptFollowRequest(requesterApId: string): Promise<void> {
  const res = await fetch('/api/follow/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requester_ap_id: requesterApId }),
  });
  if (!res.ok) throw new Error('Failed to accept');
}

export async function acceptFollowRequestsBatch(
  requesterApIds: string[]
): Promise<{ results: { ap_id: string; success: boolean; error?: string }[]; accepted_count: number }> {
  const res = await fetch('/api/follow/accept/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requester_ap_ids: requesterApIds }),
  });
  if (!res.ok) throw new Error('Failed to accept follow requests');
  return res.json();
}

export async function rejectFollowRequest(requesterApId: string): Promise<void> {
  const res = await fetch('/api/follow/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requester_ap_id: requesterApId }),
  });
  if (!res.ok) throw new Error('Failed to reject');
}
