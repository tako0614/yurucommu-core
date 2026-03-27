import { Hono } from 'hono';
import { eq, and, or, count, asc, desc, sql, inArray, isNull } from 'drizzle-orm';
import { communities, communityMembers, communityJoinRequests, objects } from '../../../db';
import type { Env, Variables } from '../../types';
import { communityApId, generateKeyPair, parseLimit, parseOffset } from '../../federation-helpers';
import { fetchCommunityId, memberWhere, requireManager } from './membership-shared';
import { isUniqueConstraintError } from '../../lib/parse-helpers';

const communitiesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

function isValidCommunityIconUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('/media/')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const RESERVED_NAMES = new Set([
  'admin', 'administrator', 'system', 'root', 'moderator', 'mod',
  'community', 'communities', 'group', 'groups', 'user', 'users',
  'api', 'ap', 'activitypub', 'webfinger', 'well_known',
  'settings', 'config', 'configuration', 'help', 'support',
  'about', 'terms', 'privacy', 'legal', 'dmca', 'copyright',
  'login', 'logout', 'register', 'signup', 'signin', 'auth',
  'null', 'undefined', 'true', 'false', 'test', 'demo',
]);

function validateCommunityName(name: string | undefined): string | null {
  if (!name || name.trim().length < 2) return 'Name must be at least 2 characters';
  const trimmed = name.trim();
  if (trimmed.length > 32) return 'Name must be at most 32 characters';
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) return 'Name can only contain letters, numbers, and underscores';
  if (RESERVED_NAMES.has(trimmed.toLowerCase())) return 'This name is reserved';
  if (/^\d+$/.test(trimmed)) return 'Name cannot be all numbers';
  if (trimmed.startsWith('_') || trimmed.endsWith('_')) return 'Name cannot start or end with underscore';
  return null;
}

// GET /api/communities - List all communities
communitiesRouter.get('/', async (c) => {
  const actor = c.get('actor');
  const db = c.get('db');
  const limit = parseLimit(c.req.query('limit'), 100, 500);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);

  const actorApIdVal = actor?.ap_id || '';

  const communitiesList = await db.select().from(communities)
    .orderBy(
      sql`CASE WHEN ${communities.lastMessageAt} IS NULL THEN 1 ELSE 0 END`,
      desc(communities.lastMessageAt),
      asc(communities.createdAt),
    )
    .limit(limit)
    .offset(offset);

  // Batch load membership and join request status for current actor to avoid N+1
  const communityApIds = communitiesList.map((c) => c.apId);
  const membershipSet = new Set<string>();
  const pendingRequestSet = new Set<string>();

  if (actorApIdVal && communityApIds.length > 0) {
    const [memberships, joinRequests] = await Promise.all([
      db.select({ communityApId: communityMembers.communityApId })
        .from(communityMembers)
        .where(and(
          eq(communityMembers.actorApId, actorApIdVal),
          inArray(communityMembers.communityApId, communityApIds),
        )),
      db.select({ communityApId: communityJoinRequests.communityApId })
        .from(communityJoinRequests)
        .where(and(
          eq(communityJoinRequests.actorApId, actorApIdVal),
          inArray(communityJoinRequests.communityApId, communityApIds),
          eq(communityJoinRequests.status, 'pending'),
        )),
    ]);

    for (const m of memberships) membershipSet.add(m.communityApId);
    for (const r of joinRequests) pendingRequestSet.add(r.communityApId);
  }

  const result = communitiesList.map((community) => {
    const isMember = membershipSet.has(community.apId);
    const joinStatus = !isMember && pendingRequestSet.has(community.apId) ? 'pending' : null;

    return {
      ap_id: community.apId,
      name: community.preferredUsername,
      display_name: community.name,
      summary: community.summary,
      icon_url: community.iconUrl,
      visibility: community.visibility,
      join_policy: community.joinPolicy,
      post_policy: community.postPolicy,
      member_count: community.memberCount,
      created_at: community.createdAt,
      last_message_at: community.lastMessageAt,
      is_member: isMember,
      join_status: joinStatus,
    };
  });

  return c.json({ communities: result });
});

// POST /api/communities - Create a new community
communitiesRouter.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const db = c.get('db');

  const body = await c.req.json<{
    name: string;
    display_name?: string;
    summary?: string;
  }>();

  const name = body.name?.trim();
  const nameError = validateCommunityName(name);
  if (nameError) return c.json({ error: nameError }, 400);

  // name is guaranteed non-null after validateCommunityName passes
  const validName = name!;
  const baseUrl = c.env.APP_URL;
  const apId = communityApId(baseUrl, validName);
  const now = new Date().toISOString();

  const inboxUrl = `${apId}/inbox`;
  const outbox = `${apId}/outbox`;
  const followersUrl = `${apId}/followers`;

  const { publicKeyPem, privateKeyPem } = await generateKeyPair();

  // Create community and member (D1 doesn't support interactive transactions, so sequential ops)
  try {
    await db.insert(communities).values({
      apId,
      preferredUsername: validName,
      name: body.display_name || validName,
      summary: body.summary || '',
      inbox: inboxUrl,
      outbox,
      followersUrl,
      publicKeyPem,
      privateKeyPem,
      visibility: 'public',
      joinPolicy: 'open',
      postPolicy: 'members',
      memberCount: 1,
      createdBy: actor.ap_id,
      createdAt: now,
    });

    await db.insert(communityMembers).values({
      communityApId: apId,
      actorApId: actor.ap_id,
      role: 'owner',
      joinedAt: now,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'Community name already taken' }, 409);
    }
    throw error;
  }

  return c.json({
    community: {
      ap_id: apId,
      name: body.name,
      display_name: body.display_name || body.name,
      summary: body.summary || '',
      icon_url: null,
      visibility: 'public',
      join_policy: 'open',
      post_policy: 'members',
      member_count: 1,
      created_at: now,
      is_member: true,
    }
  }, 201);
});

// GET /api/communities/:name - Get community by name or ap_id
communitiesRouter.get('/:identifier', async (c) => {
  const identifier = c.req.param('identifier');
  const actor = c.get('actor');
  const db = c.get('db');
  const baseUrl = c.env.APP_URL;

  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  const community = await db.select().from(communities)
    .where(or(eq(communities.apId, apId), eq(communities.preferredUsername, identifier)))
    .get();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check membership and join status
  let isMember = false;
  let memberRole: string | null = null;
  let joinStatus: string | null = null;

  if (actor) {
    const membership = await db.select().from(communityMembers)
      .where(memberWhere(community.apId, actor.ap_id))
      .get();
    if (membership) {
      isMember = true;
      memberRole = membership.role;
    } else {
      const joinRequest = await db.select().from(communityJoinRequests)
        .where(and(
          eq(communityJoinRequests.communityApId, community.apId),
          eq(communityJoinRequests.actorApId, actor.ap_id),
        ))
        .get();
      if (joinRequest?.status === 'pending') {
        joinStatus = 'pending';
      }
    }
  }

  const [memberCountResult, postsCountResult] = await Promise.all([
    db.select({ count: count() }).from(communityMembers)
      .where(eq(communityMembers.communityApId, community.apId))
      .get(),
    db.select({ count: count() }).from(objects)
      .where(eq(objects.communityApId, community.apId))
      .get(),
  ]);

  return c.json({
    community: {
      ap_id: community.apId,
      name: community.preferredUsername,
      display_name: community.name,
      summary: community.summary,
      icon_url: community.iconUrl,
      visibility: community.visibility,
      join_policy: community.joinPolicy,
      post_policy: community.postPolicy,
      member_count: memberCountResult?.count || community.memberCount || 0,
      post_count: postsCountResult?.count || 0,
      created_by: community.createdBy,
      created_at: community.createdAt,
      is_member: isMember,
      member_role: memberRole,
      join_status: joinStatus,
    }
  });
});

// PATCH /api/communities/:identifier/settings - Update community settings
communitiesRouter.patch('/:identifier/settings', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const db = c.get('db');

  const { community } = await fetchCommunityId(c, identifier);
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const manager = await requireManager(db, community.apId, actor.ap_id);
  if (!manager) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<{
    display_name?: string;
    summary?: string;
    icon_url?: string;
    visibility?: 'public' | 'private';
    join_policy?: 'open' | 'approval' | 'invite';
    post_policy?: 'anyone' | 'members' | 'mods' | 'owners';
  }>();

  const updates: Record<string, string | null> = {};

  if (body.display_name !== undefined) {
    updates.name = body.display_name;
  }
  if (body.summary !== undefined) {
    updates.summary = body.summary;
  }
  if (body.icon_url !== undefined) {
    if (body.icon_url === null || (typeof body.icon_url === 'string' && body.icon_url.trim().length === 0)) {
      updates.iconUrl = null;
    } else if (typeof body.icon_url !== 'string') {
      return c.json({ error: 'Invalid icon_url' }, 400);
    } else if (!isValidCommunityIconUrl(body.icon_url)) {
      return c.json({ error: 'Invalid icon_url scheme' }, 400);
    } else {
      updates.iconUrl = body.icon_url.trim();
    }
  }
  if (body.visibility !== undefined) {
    if (!['public', 'private'].includes(body.visibility)) {
      return c.json({ error: 'Invalid visibility' }, 400);
    }
    updates.visibility = body.visibility;
  }
  if (body.join_policy !== undefined) {
    if (!['open', 'approval', 'invite'].includes(body.join_policy)) {
      return c.json({ error: 'Invalid join_policy' }, 400);
    }
    updates.joinPolicy = body.join_policy;
  }
  if (body.post_policy !== undefined) {
    if (!['anyone', 'members', 'mods', 'owners'].includes(body.post_policy)) {
      return c.json({ error: 'Invalid post_policy' }, 400);
    }
    updates.postPolicy = body.post_policy;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  await db.update(communities)
    .set(updates)
    .where(eq(communities.apId, community.apId));

  return c.json({ success: true });
});


export default communitiesRouter;
