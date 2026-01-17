import type { Context } from 'hono';
import type { Env, Variables } from '../../types';
import { communityApId } from '../../utils';

export type CommunityRow = {
  ap_id: string;
  preferred_username: string | null;
  join_policy: string;
  member_count: number;
};

export type CommunityIdRow = {
  ap_id: string;
};

export type CommunityMemberRow = {
  role: 'owner' | 'moderator' | 'member';
};

export type CountRow = {
  count: number;
};

export type JoinRequestRow = {
  actor_ap_id: string;
  preferred_username: string | null;
  name: string | null;
  icon_url: string | null;
  created_at: string;
};

export type InviteRow = {
  id: string;
  invited_ap_id: string | null;
  invited_by_ap_id: string;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
  used_by_ap_id: string | null;
  invited_by_username: string | null;
  invited_by_name: string | null;
};

export type InviteCheckRow = {
  invited_ap_id: string | null;
};

export type MemberListRow = {
  actor_ap_id: string;
  preferred_username: string | null;
  name: string | null;
  icon_url: string | null;
  role: 'owner' | 'moderator' | 'member';
  joined_at: string;
};

export type MembershipContext = Context<{ Bindings: Env; Variables: Variables }>;

export function resolveCommunityApId(baseUrl: string, identifier: string): string {
  return identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
}

export async function fetchCommunityDetails(c: MembershipContext, identifier: string) {
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await c.env.DB.prepare(
    'SELECT * FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<CommunityRow>();
  return { apId, community };
}

export async function fetchCommunityId(c: MembershipContext, identifier: string) {
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<CommunityIdRow>();
  return { apId, community };
}
