import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { communityApId, generateKeyPair } from '../../utils';
import { managerRoles } from './utils';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/communities - List all communities
communities.get('/', async (c) => {
  const actor = c.get('actor');
  const prisma = c.get('prisma');

  const actorApIdVal = actor?.ap_id || '';

  // Get all communities
  const communitiesList = await prisma.community.findMany({
    orderBy: [
      { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'asc' },
    ],
  });

  // Batch load membership and join request status for current actor to avoid N+1
  const communityApIds = communitiesList.map((c) => c.apId);
  const membershipSet = new Set<string>();
  const pendingRequestSet = new Set<string>();

  if (actorApIdVal && communityApIds.length > 0) {
    const [memberships, joinRequests] = await Promise.all([
      prisma.communityMember.findMany({
        where: { actorApId: actorApIdVal, communityApId: { in: communityApIds } },
        select: { communityApId: true },
      }),
      prisma.communityJoinRequest.findMany({
        where: { actorApId: actorApIdVal, communityApId: { in: communityApIds }, status: 'pending' },
        select: { communityApId: true },
      }),
    ]);

    memberships.forEach((m) => membershipSet.add(m.communityApId));
    joinRequests.forEach((r) => pendingRequestSet.add(r.communityApId));
  }

  // Map communities to result format
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
communities.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');

  const body = await c.req.json<{
    name: string;
    display_name?: string;
    summary?: string;
  }>();

  const name = body.name?.trim();
  if (!name || name.length < 2) {
    return c.json({ error: 'Name must be at least 2 characters' }, 400);
  }

  // Maximum length
  if (name.length > 32) {
    return c.json({ error: 'Name must be at most 32 characters' }, 400);
  }

  // Validate name format (alphanumeric and underscores only)
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return c.json({ error: 'Name can only contain letters, numbers, and underscores' }, 400);
  }

  // Reserved names that cannot be used for communities
  const reservedNames = [
    'admin', 'administrator', 'system', 'root', 'moderator', 'mod',
    'community', 'communities', 'group', 'groups', 'user', 'users',
    'api', 'ap', 'activitypub', 'webfinger', 'well_known',
    'settings', 'config', 'configuration', 'help', 'support',
    'about', 'terms', 'privacy', 'legal', 'dmca', 'copyright',
    'login', 'logout', 'register', 'signup', 'signin', 'auth',
    'null', 'undefined', 'true', 'false', 'test', 'demo',
  ];
  if (reservedNames.includes(name.toLowerCase())) {
    return c.json({ error: 'This name is reserved' }, 400);
  }

  // Prevent confusing names (all numbers, leading/trailing underscores)
  if (/^\d+$/.test(name)) {
    return c.json({ error: 'Name cannot be all numbers' }, 400);
  }
  if (name.startsWith('_') || name.endsWith('_')) {
    return c.json({ error: 'Name cannot start or end with underscore' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const apId = communityApId(baseUrl, name);
  const now = new Date().toISOString();

  // Generate AP endpoints
  const inbox = `${apId}/inbox`;
  const outbox = `${apId}/outbox`;
  const followersUrl = `${apId}/followers`;

  // Generate key pair for ActivityPub
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();

  // Create community using insert-or-fail pattern to avoid race condition
  // Database unique constraint on preferredUsername will reject duplicates
  try {
    await prisma.community.create({
      data: {
        apId,
        preferredUsername: name,
        name: body.display_name || name,
        summary: body.summary || '',
        inbox,
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
      },
    });
  } catch (error) {
    // Handle unique constraint violation (P2002 is Prisma's unique constraint error code)
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return c.json({ error: 'Community name already taken' }, 409);
    }
    // Re-throw unexpected errors
    throw error;
  }

  // Add creator as member (owner role)
  await prisma.communityMember.create({
    data: {
      communityApId: apId,
      actorApId: actor.ap_id,
      role: 'owner',
      joinedAt: now,
    },
  });

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
communities.get('/:identifier', async (c) => {
  const identifier = c.req.param('identifier');
  const actor = c.get('actor');
  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;

  // Check if identifier is a full AP ID or just a name/username
  let apId: string;
  if (identifier.startsWith('http')) {
    apId = identifier;
  } else {
    apId = communityApId(baseUrl, identifier);
  }

  // Try to fetch the community by apId or preferredUsername
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier },
      ],
    },
  });

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check membership and join status
  let isMember = false;
  let memberRole: string | null = null;
  let joinStatus: string | null = null;

  if (actor) {
    const membership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
        },
      },
    });
    if (membership) {
      isMember = true;
      memberRole = membership.role;
    } else {
      const joinRequest = await prisma.communityJoinRequest.findUnique({
        where: {
          communityApId_actorApId: {
            communityApId: community.apId,
            actorApId: actor.ap_id,
          },
        },
      });
      if (joinRequest?.status === 'pending') {
        joinStatus = 'pending';
      }
    }
  }

  // Get member count (for verification)
  const memberCountResult = await prisma.communityMember.count({
    where: { communityApId: community.apId },
  });

  // Get posts in this community
  const postsCount = await prisma.object.count({
    where: { communityApId: community.apId },
  });

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
      member_count: memberCountResult || community.memberCount || 0,
      post_count: postsCount || 0,
      created_by: community.createdBy,
      created_at: community.createdAt,
      is_member: isMember,
      member_role: memberRole,
      join_status: joinStatus,
    }
  });
});

// PATCH /api/communities/:identifier/settings - Update community settings
communities.patch('/:identifier/settings', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier },
      ],
    },
    select: { apId: true },
  });

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const member = await prisma.communityMember.findUnique({
    where: {
      communityApId_actorApId: {
        communityApId: community.apId,
        actorApId: actor.ap_id,
      },
    },
  });

  if (!member || !managerRoles.has(member.role)) {
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
    updates.iconUrl = body.icon_url;
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

  await prisma.community.update({
    where: { apId: community.apId },
    data: updates,
  });

  return c.json({ success: true });
});


export default communities;
