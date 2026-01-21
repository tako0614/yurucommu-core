import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { actorApId, getDomain } from '../utils';
import { INSTANCE_ACTOR_USERNAME, MAX_ROOM_STREAM_LIMIT, getInstanceActor, parseLimit, roomApId } from './activitypub/utils';
import inboxRoutes from './activitypub/inbox';
import outboxRoutes from './activitypub/outbox';
import { withCache, CacheTTL, CacheTags } from '../middleware/cache';

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

// WebFinger - Actor Discovery
// ============================================================
// Cached for 1 hour (rarely changes, important for federation)

ap.get('/.well-known/webfinger', withCache({
  ttl: CacheTTL.WEBFINGER,
  cacheTag: CacheTags.WEBFINGER,
  queryParamsToInclude: ['resource'],
}), async (c) => {
  const prisma = c.get('prisma');
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

  // Only respond for local domain
  if (domain !== currentDomain) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  if (username === INSTANCE_ACTOR_USERNAME) {
    const instanceActor = await getInstanceActor(c);
    return c.json({
      subject: `acct:${INSTANCE_ACTOR_USERNAME}@${domain}`,
      aliases: [instanceActor.apId],
      links: [
        {
          rel: 'self',
          type: 'application/activity+json',
          href: instanceActor.apId,
        },
        {
          rel: 'http://webfinger.net/rel/profile-page',
          type: 'text/html',
          href: `${baseUrl}/groups`,
        },
      ],
    });
  }

  // Look up actor
  const actor = await prisma.actor.findUnique({
    where: { preferredUsername: username },
    select: { apId: true, preferredUsername: true },
  });

  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  return c.json({
    subject: `acct:${username}@${domain}`,
    aliases: [actor.apId],
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: actor.apId,
      },
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: `${baseUrl}/users/${username}`,
      },
    ],
  });
});

// ============================================================

// Actor Profile Endpoint
// ============================================================
// Cached for 10 minutes (ActivityPub actor JSON)

ap.get('/ap/users/:username', withCache({
  ttl: CacheTTL.ACTIVITYPUB_ACTOR,
  cacheTag: CacheTags.ACTOR,
}), async (c) => {
  const prisma = c.get('prisma');
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await prisma.actor.findUnique({
    where: { apId },
    select: {
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

  // Build AP JSON-LD response
  const actorResponse: Record<string, unknown> = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
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
    publicKey: {
      id: `${actor.apId}#main-key`,
      owner: actor.apId,
      publicKeyPem: actor.publicKeyPem,
    },
    discoverable: !actor.isPrivate,
    published: actor.createdAt,
  };

  // Remove undefined fields
  Object.keys(actorResponse).forEach((key) => {
    if (actorResponse[key] === undefined) {
      delete actorResponse[key];
    }
  });

  c.header('Content-Type', 'application/activity+json');
  return c.json(actorResponse);
});

// ============================================================

// Group Actor (Instance Community)
// ============================================================
// Cached for 10 minutes

ap.get('/ap/actor', withCache({
  ttl: CacheTTL.ACTIVITYPUB_ACTOR,
  cacheTag: CacheTags.COMMUNITY,
}), async (c) => {
  const baseUrl = c.env.APP_URL;
  const instanceActor = await getInstanceActor(c);

  const actorResponse = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
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
    publicKey: {
      id: `${instanceActor.apId}#main-key`,
      owner: instanceActor.apId,
      publicKeyPem: instanceActor.publicKeyPem,
    },
    rooms: `${baseUrl}/ap/rooms`,
    joinPolicy: instanceActor.joinPolicy || 'open',
    postingPolicy: instanceActor.postingPolicy || 'members',
    visibility: instanceActor.visibility || 'public',
  };

  c.header('Content-Type', 'application/activity+json');
  return c.json(actorResponse);
});


// Rooms (Communities)
// ============================================================
// Cached for 5 minutes

ap.get('/ap/rooms', withCache({
  ttl: CacheTTL.COMMUNITY,
  cacheTag: CacheTags.COMMUNITY,
}), async (c) => {
  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;

  const rooms = await prisma.community.findMany({
    select: {
      preferredUsername: true,
      name: true,
      summary: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const items = rooms.map((room) => ({
    id: roomApId(baseUrl, room.preferredUsername),
    type: 'Room',
    name: room.name,
    summary: room.summary || '',
  }));

  return c.json({
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      {
        'apc': 'https://yurucommu.com/ns/apc#',
        'Room': 'apc:Room',
      },
    ],
    id: `${baseUrl}/ap/rooms`,
    type: 'OrderedCollection',
    totalItems: items.length,
    orderedItems: items,
  });
});

ap.get('/ap/rooms/:roomId', async (c) => {
  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const roomId = c.req.param('roomId');

  const room = await prisma.community.findFirst({
    where: {
      OR: [
        { preferredUsername: roomId },
        { apId: roomId },
      ],
    },
    select: {
      preferredUsername: true,
      name: true,
      summary: true,
    },
  });

  if (!room) return c.json({ error: 'Room not found' }, 404);

  return c.json({
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      {
        'apc': 'https://yurucommu.com/ns/apc#',
        'Room': 'apc:Room',
        'stream': { '@id': 'apc:stream', '@type': '@id' },
      },
    ],
    id: roomApId(baseUrl, room.preferredUsername),
    type: 'Room',
    name: room.name,
    summary: room.summary || '',
    stream: `${roomApId(baseUrl, room.preferredUsername)}/stream`,
  });
});

ap.get('/ap/rooms/:roomId/stream', async (c) => {
  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const roomId = c.req.param('roomId');
  const limit = parseLimit(c.req.query('limit'), 20, MAX_ROOM_STREAM_LIMIT);
  const before = c.req.query('before');

  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { preferredUsername: roomId },
        { apId: roomId },
      ],
    },
    select: {
      apId: true,
      preferredUsername: true,
    },
  });

  if (!community) return c.json({ error: 'Room not found' }, 404);

  const objects = await prisma.object.findMany({
    where: {
      type: 'Note',
      communityApId: community.apId,
      ...(before ? { published: { lt: before } } : {}),
    },
    select: {
      apId: true,
      attributedTo: true,
      content: true,
      published: true,
    },
    orderBy: { published: 'desc' },
    take: limit,
  });

  const items = objects.map((o) => ({
    id: o.apId,
    type: 'Note',
    attributedTo: o.attributedTo,
    content: o.content,
    published: o.published,
    room: roomApId(baseUrl, community.preferredUsername),
  }));

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${roomApId(baseUrl, community.preferredUsername)}/stream`,
    type: 'OrderedCollection',
    totalItems: items.length,
    orderedItems: items,
  });
});
// ============================================================

ap.route('/', inboxRoutes);
ap.route('/', outboxRoutes);

export default ap;
