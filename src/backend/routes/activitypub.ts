import { Hono } from 'hono';
import type { Context } from 'hono';
import { eq, and, asc, desc, lt } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { actors, communities, objects as objectsTable } from '../../db';
import { notDeleted } from '../../db';
import { actorApId, getDomain, parseLimit } from '../federation-helpers';
import { INSTANCE_ACTOR_USERNAME, MAX_ROOM_STREAM_LIMIT, getInstanceActor, roomApId } from './activitypub/utils';
import inboxRoutes from './activitypub/inbox';
import outboxRoutes from './activitypub/outbox';
import { withCache, CacheTTL, CacheTags } from '../middleware/cache';
import { communityWhere, resolveCommunityApId } from './communities/membership-shared';

type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Shared constants and helpers
// ---------------------------------------------------------------------------

const AP_CONTENT_TYPE = 'application/activity+json';

const AP_CONTEXT = [
  'https://www.w3.org/ns/activitystreams',
  'https://w3id.org/security/v1',
] as const;

const APC_ROOM_CONTEXT = {
  apc: 'https://yurucommu.com/ns/apc#',
  Room: 'apc:Room',
} as const;

/** Build a standard WebFinger JRD response. */
function buildWebFingerResponse(
  username: string,
  domain: string,
  apId: string,
  profileHref: string,
): Record<string, unknown> {
  return {
    subject: `acct:${username}@${domain}`,
    aliases: [apId],
    links: [
      { rel: 'self', type: AP_CONTENT_TYPE, href: apId },
      { rel: 'http://webfinger.net/rel/profile-page', type: 'text/html', href: profileHref },
    ],
  };
}

/** Build an ActivityPub public-key block for an actor. */
function buildPublicKey(actorApId: string, publicKeyPem: string): Record<string, string> {
  return {
    id: `${actorApId}#main-key`,
    owner: actorApId,
    publicKeyPem,
  };
}

/** Return an activity+json Response via Hono context. */
function activityJson(c: HonoContext, body: Record<string, unknown>): Response {
  c.header('Content-Type', AP_CONTENT_TYPE);
  return c.json(body);
}

// ---------------------------------------------------------------------------
// WebFinger - Actor Discovery (cached 1 hour)
// ---------------------------------------------------------------------------

ap.get('/.well-known/webfinger', withCache({
  ttl: CacheTTL.WEBFINGER,
  cacheTag: CacheTags.WEBFINGER,
  queryParamsToInclude: ['resource'],
}), async (c) => {
  const prisma = c.get('db');
  const resource = c.req.query('resource');
  if (!resource) return c.json({ error: 'resource parameter required' }, 400);

  // Parse resource format: acct:username@domain or https://domain/ap/users/username
  let username: string | null = null;
  let domain: string | null = null;

  if (resource.startsWith('acct:')) {
    const acctPart = resource.slice(5);
    const [user, host] = acctPart.split('@');
    username = user;
    domain = host;
  } else if (resource.startsWith('http')) {
    try {
      const url = new URL(resource);
      domain = url.host;
      const match = resource.match(/\/users\/([^\/]+)$/);
      if (match) {
        username = match[1];
      }
    } catch {
      return c.json({ error: 'Invalid resource format' }, 400);
    }
  } else {
    return c.json({ error: 'Invalid resource format' }, 400);
  }

  if (!username || !domain) return c.json({ error: 'Invalid resource format' }, 400);

  const baseUrl = c.env.APP_URL;
  const currentDomain = getDomain(baseUrl);

  if (domain !== currentDomain) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  if (username === INSTANCE_ACTOR_USERNAME) {
    const instanceActor = await getInstanceActor(c);
    return c.json(buildWebFingerResponse(
      INSTANCE_ACTOR_USERNAME,
      domain,
      instanceActor.apId,
      `${baseUrl}/groups`,
    ));
  }

  const actor = await prisma.query.actors.findFirst({
    where: and(eq(actors.preferredUsername, username), notDeleted(actors)),
    columns: { apId: true, preferredUsername: true },
  });

  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  return c.json(buildWebFingerResponse(
    username,
    domain,
    actor.apId,
    `${baseUrl}/users/${username}`,
  ));
});

// ---------------------------------------------------------------------------
// Actor Profile Endpoint (cached 10 minutes)
// ---------------------------------------------------------------------------

ap.get('/ap/users/:username', withCache({
  ttl: CacheTTL.ACTIVITYPUB_ACTOR,
  cacheTag: CacheTags.ACTOR,
}), async (c) => {
  const prisma = c.get('db');
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await prisma.query.actors.findFirst({
    where: and(eq(actors.apId, apId), notDeleted(actors)),
    columns: {
      apId: true,
      type: true,
      preferredUsername: true,
      name: true,
      summary: true,
      iconUrl: true,
      headerUrl: true,
      inbox: true,
      outbox: true,
      followersUrl: true,
      followingUrl: true,
      publicKeyPem: true,
      followerCount: true,
      followingCount: true,
      postCount: true,
      isPrivate: true,
      createdAt: true,
    },
  });

  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  const actorResponse: Record<string, unknown> = {
    '@context': AP_CONTEXT,
    id: actor.apId,
    type: actor.type,
    preferredUsername: actor.preferredUsername,
    name: actor.name,
    summary: actor.summary,
    url: `${baseUrl}/users/${username}`,
    icon: actor.iconUrl ? { type: 'Image', url: actor.iconUrl } : undefined,
    image: actor.headerUrl ? { type: 'Image', url: actor.headerUrl } : undefined,
    inbox: actor.inbox,
    outbox: actor.outbox,
    followers: actor.followersUrl,
    following: actor.followingUrl,
    publicKey: buildPublicKey(actor.apId, actor.publicKeyPem),
    discoverable: !actor.isPrivate,
    published: actor.createdAt,
  };

  // Remove undefined fields
  for (const key of Object.keys(actorResponse)) {
    if (actorResponse[key] === undefined) {
      delete actorResponse[key];
    }
  }

  return activityJson(c, actorResponse);
});

// ---------------------------------------------------------------------------
// Group Actor / Instance Community (cached 10 minutes)
// ---------------------------------------------------------------------------

ap.get('/ap/actor', withCache({
  ttl: CacheTTL.ACTIVITYPUB_ACTOR,
  cacheTag: CacheTags.COMMUNITY,
}), async (c) => {
  const baseUrl = c.env.APP_URL;
  const instanceActor = await getInstanceActor(c);

  const actorResponse = {
    '@context': [
      ...AP_CONTEXT,
      {
        apc: 'https://yurucommu.com/ns/apc#',
        rooms: { '@id': 'apc:rooms', '@type': '@id' },
        joinPolicy: 'apc:joinPolicy',
        postingPolicy: 'apc:postingPolicy',
        visibility: 'apc:visibility',
      },
    ],
    id: instanceActor.apId,
    type: 'Group',
    preferredUsername: instanceActor.preferredUsername,
    name: instanceActor.name || 'Yurucommu',
    summary: instanceActor.summary || '',
    inbox: `${baseUrl}/ap/actor/inbox`,
    outbox: `${baseUrl}/ap/actor/outbox`,
    followers: `${baseUrl}/ap/actor/followers`,
    following: `${baseUrl}/ap/actor/following`,
    publicKey: buildPublicKey(instanceActor.apId, instanceActor.publicKeyPem),
    rooms: `${baseUrl}/ap/rooms`,
    joinPolicy: instanceActor.joinPolicy || 'open',
    postingPolicy: instanceActor.postingPolicy || 'members',
    visibility: instanceActor.visibility || 'public',
  };

  return activityJson(c, actorResponse);
});

// ---------------------------------------------------------------------------
// Rooms (Communities) (cached 5 minutes)
// ---------------------------------------------------------------------------

ap.get('/ap/rooms', withCache({
  ttl: CacheTTL.COMMUNITY,
  cacheTag: CacheTags.COMMUNITY,
}), async (c) => {
  const prisma = c.get('db');
  const baseUrl = c.env.APP_URL;

  const rooms = await prisma.query.communities.findMany({
    where: notDeleted(communities),
    columns: { preferredUsername: true, name: true, summary: true },
    orderBy: asc(communities.createdAt),
  });

  const items = rooms.map((room) => ({
    id: roomApId(baseUrl, room.preferredUsername),
    type: 'Room',
    name: room.name,
    summary: room.summary || '',
  }));

  return c.json({
    '@context': ['https://www.w3.org/ns/activitystreams', APC_ROOM_CONTEXT],
    id: `${baseUrl}/ap/rooms`,
    type: 'OrderedCollection',
    totalItems: items.length,
    orderedItems: items,
  });
});

ap.get('/ap/rooms/:roomId', async (c) => {
  const prisma = c.get('db');
  const baseUrl = c.env.APP_URL;
  const roomId = c.req.param('roomId');

  const room = await prisma.query.communities.findFirst({
    where: and(communityWhere(resolveCommunityApId(baseUrl, roomId), roomId), notDeleted(communities)),
    columns: { preferredUsername: true, name: true, summary: true },
  });

  if (!room) return c.json({ error: 'Room not found' }, 404);

  const roomUrl = roomApId(baseUrl, room.preferredUsername);

  return c.json({
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      { ...APC_ROOM_CONTEXT, stream: { '@id': 'apc:stream', '@type': '@id' } },
    ],
    id: roomUrl,
    type: 'Room',
    name: room.name,
    summary: room.summary || '',
    stream: `${roomUrl}/stream`,
  });
});

ap.get('/ap/rooms/:roomId/stream', async (c) => {
  const prisma = c.get('db');
  const baseUrl = c.env.APP_URL;
  const roomId = c.req.param('roomId');
  const limit = parseLimit(c.req.query('limit'), 20, MAX_ROOM_STREAM_LIMIT);
  const before = c.req.query('before');

  const community = await prisma.query.communities.findFirst({
    where: and(communityWhere(resolveCommunityApId(baseUrl, roomId), roomId), notDeleted(communities)),
    columns: { apId: true, preferredUsername: true },
  });

  if (!community) return c.json({ error: 'Room not found' }, 404);

  const conditions = [
    eq(objectsTable.type, 'Note'),
    eq(objectsTable.communityApId, community.apId),
    notDeleted(objectsTable),
  ];
  if (before) conditions.push(lt(objectsTable.published, before));

  const objects = await prisma.query.objects.findMany({
    where: and(...conditions),
    columns: { apId: true, attributedTo: true, content: true, published: true },
    orderBy: desc(objectsTable.published),
    limit,
  });

  const communityRoomUrl = roomApId(baseUrl, community.preferredUsername);

  const items = objects.map((o) => ({
    id: o.apId,
    type: 'Note',
    attributedTo: o.attributedTo,
    content: o.content,
    published: o.published,
    room: communityRoomUrl,
  }));

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${communityRoomUrl}/stream`,
    type: 'OrderedCollection',
    totalItems: items.length,
    orderedItems: items,
  });
});

// ---------------------------------------------------------------------------

ap.route('/', inboxRoutes);
ap.route('/', outboxRoutes);

export default ap;
