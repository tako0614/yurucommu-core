import { normalizeActor } from './normalize';

export interface CommunityDetail {
  ap_id: string;
  name: string;
  display_name: string;
  summary: string | null;
  icon_url: string | null;
  visibility: 'public' | 'private';
  join_policy: 'open' | 'invite' | 'approval';
  post_policy: 'anyone' | 'members' | 'mods' | 'owners';
  member_count: number;
  post_count?: number;
  created_by: string;
  created_at: string;
  is_member: boolean;
  member_role: 'owner' | 'moderator' | 'member' | null;
  join_status?: 'pending' | null;
  last_message_at?: string | null;
}

export interface CommunityMember {
  ap_id: string;
  username: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
  role: 'owner' | 'moderator' | 'member';
  joined_at: string;
}

export interface CommunityMessage {
  id: string;
  sender: {
    ap_id: string;
    username: string;
    preferred_username: string;
    name: string | null;
    icon_url: string | null;
  };
  content: string;
  created_at: string;
}

export interface JoinCommunityResult {
  status: 'joined' | 'pending' | 'invite_required';
}

export interface CommunityJoinRequest {
  ap_id: string;
  username: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
  created_at: string;
}

export interface CommunityInviteResult {
  invite_id: string;
}

export interface CommunityInvite {
  id: string;
  invited_ap_id: string | null;
  invited_by: {
    ap_id: string;
    username: string;
    preferred_username: string;
    name: string;
  };
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  used_by_ap_id: string | null;
  is_valid: boolean;
}

export interface CommunitySettings {
  display_name?: string;
  summary?: string;
  icon_url?: string;
  visibility?: 'public' | 'private';
  join_policy?: 'open' | 'approval' | 'invite';
  post_policy?: 'anyone' | 'members' | 'mods' | 'owners';
}

const normalizeCommunityMessage = (message: CommunityMessage): CommunityMessage => ({
  ...message,
  sender: normalizeActor(message.sender),
});

export async function fetchCommunities(): Promise<CommunityDetail[]> {
  const res = await fetch('/api/communities');
  const data = await res.json();
  return data.communities || [];
}

export async function fetchCommunity(identifier: string): Promise<CommunityDetail> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}`);
  if (!res.ok) throw new Error('Community not found');
  const data = await res.json();
  return data.community;
}

export async function createCommunity(data: {
  name: string;
  display_name?: string;
  summary?: string;
}): Promise<CommunityDetail> {
  const res = await fetch('/api/communities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to create community');
  }
  const result = await res.json();
  return result.community;
}

export async function joinCommunity(
  identifier: string,
  options?: { inviteId?: string }
): Promise<JoinCommunityResult> {
  const body = options?.inviteId ? JSON.stringify({ invite_id: options.inviteId }) : undefined;
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/join`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = data.error || 'Failed to join community';
    const err = new Error(error) as Error & { status?: string };
    err.status = data.status;
    throw err;
  }
  return { status: data.status || 'joined' };
}

export async function leaveCommunity(identifier: string): Promise<void> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/leave`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to leave community');
  }
}

export async function fetchCommunityMessages(
  identifier: string,
  options?: { limit?: number; before?: string }
): Promise<CommunityMessage[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', options.before);
  const query = params.toString() ? `?${params}` : '';
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/messages${query}`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  const data = await res.json();
  return (data.messages || []).map(normalizeCommunityMessage);
}

export async function sendCommunityMessage(identifier: string, content: string): Promise<CommunityMessage> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to send message');
  const data = await res.json();
  return normalizeCommunityMessage(data.message);
}

export async function fetchCommunityMembers(identifier: string): Promise<CommunityMember[]> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/members`);
  if (!res.ok) throw new Error('Failed to fetch members');
  const data = await res.json();
  return (data.members || []).map(normalizeActor);
}

export async function fetchCommunityJoinRequests(identifier: string): Promise<CommunityJoinRequest[]> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/requests`);
  if (!res.ok) throw new Error('Failed to fetch join requests');
  const data = await res.json();
  return (data.requests || []).map(normalizeActor);
}

export async function acceptCommunityJoinRequest(identifier: string, actorApId: string): Promise<void> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/requests/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_ap_id: actorApId }),
  });
  if (!res.ok) throw new Error('Failed to accept join request');
}

export async function rejectCommunityJoinRequest(identifier: string, actorApId: string): Promise<void> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/requests/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor_ap_id: actorApId }),
  });
  if (!res.ok) throw new Error('Failed to reject join request');
}

export async function fetchCommunityInvites(identifier: string): Promise<CommunityInvite[]> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/invites`);
  if (!res.ok) throw new Error('Failed to fetch invites');
  const data = await res.json();
  return (data.invites || []).map((invite: CommunityInvite) => ({
    ...invite,
    invited_by: normalizeActor(invite.invited_by),
  }));
}

export async function createCommunityInvite(
  identifier: string,
  options?: { invited_ap_id?: string; expires_in_hours?: number }
): Promise<CommunityInviteResult & { expires_at?: string }> {
  const body = options ? JSON.stringify(options) : undefined;
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/invites`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body,
  });
  if (!res.ok) throw new Error('Failed to create invite');
  return res.json();
}

export async function revokeCommunityInvite(identifier: string, inviteId: string): Promise<void> {
  const res = await fetch(
    `/api/communities/${encodeURIComponent(identifier)}/invites/${encodeURIComponent(inviteId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error('Failed to revoke invite');
}

export async function updateCommunitySettings(
  identifier: string,
  settings: CommunitySettings
): Promise<void> {
  const res = await fetch(`/api/communities/${encodeURIComponent(identifier)}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to update community settings');
}

export async function removeCommunityMember(
  identifier: string,
  actorApId: string
): Promise<void> {
  const res = await fetch(
    `/api/communities/${encodeURIComponent(identifier)}/members/${encodeURIComponent(actorApId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error('Failed to remove member');
}

export async function updateCommunityMemberRole(
  identifier: string,
  actorApId: string,
  role: 'owner' | 'moderator' | 'member'
): Promise<void> {
  const res = await fetch(
    `/api/communities/${encodeURIComponent(identifier)}/members/${encodeURIComponent(actorApId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }
  );
  if (!res.ok) throw new Error('Failed to update member role');
}

export async function editCommunityMessage(
  identifier: string,
  messageId: string,
  content: string
): Promise<void> {
  const res = await fetch(
    `/api/communities/${encodeURIComponent(identifier)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }
  );
  if (!res.ok) throw new Error('Failed to edit message');
}

export async function deleteCommunityMessage(
  identifier: string,
  messageId: string
): Promise<void> {
  const res = await fetch(
    `/api/communities/${encodeURIComponent(identifier)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error('Failed to delete message');
}
