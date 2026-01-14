import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { communityApId } from '../utils';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/communities - List all communities
communities.get('/', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, summary, icon_url, visibility, join_policy, post_policy, member_count, created_at
    FROM communities
    ORDER BY created_at ASC
  `).all();

  const communitiesList = (result.results || []).map((community: any) => ({
    ap_id: community.ap_id,
    name: community.preferred_username,
    display_name: community.name,
    summary: community.summary,
    icon_url: community.icon_url,
    visibility: community.visibility,
    join_policy: community.join_policy,
    post_policy: community.post_policy,
    member_count: community.member_count,
    created_at: community.created_at,
  }));

  return c.json({ communities: communitiesList });
});

// GET /api/communities/:name - Get community by name or ap_id
communities.get('/:identifier', async (c) => {
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;

  // Check if identifier is a full AP ID or just a name/username
  let apId: string;
  if (identifier.startsWith('http')) {
    apId = identifier;
  } else {
    apId = communityApId(baseUrl, identifier);
  }

  // Try to fetch the community
  const community = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, summary, icon_url, visibility, join_policy, post_policy, member_count, created_by, created_at
    FROM communities
    WHERE ap_id = ? OR preferred_username = ?
  `).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Get member count (for verification)
  const memberCountResult = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM community_members WHERE community_ap_id = ?
  `).bind(community.ap_id).first<any>();

  // Get posts in this community
  const postsResult = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM objects WHERE community_ap_id = ?
  `).bind(community.ap_id).first<any>();

  return c.json({
    community: {
      ap_id: community.ap_id,
      name: community.preferred_username,
      display_name: community.name,
      summary: community.summary,
      icon_url: community.icon_url,
      visibility: community.visibility,
      join_policy: community.join_policy,
      post_policy: community.post_policy,
      member_count: memberCountResult?.count || community.member_count || 0,
      post_count: postsResult?.count || 0,
      created_by: community.created_by,
      created_at: community.created_at,
    }
  });
});

export default communities;
