import { Hono } from 'hono';
import type { Env, Variables, Actor } from '../types';
import { actorApId, getDomain } from '../utils';
import { INSTANCE_ACTOR_USERNAME, MAX_ROOM_STREAM_LIMIT, getInstanceActor, parseLimit, roomApId } from './activitypub/utils';
import inboxRoutes from './activitypub/inbox';
import outboxRoutes from './activitypub/outbox';

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

type ActorIdRow = {
  ap_id: string;
  preferred_username: string;
};

type RoomRow = {
  preferred_username: string;
  name: string;
  summary: string | null;
};

type CommunityRow = {
  ap_id: string;
  preferred_username: string;
};

type RoomStreamRow = {
  ap_id: string;
  attributed_to: string;
  content: string;
  published: string;
};

// WebFinger - Actor Discovery
// ============================================================

ap.get('/.well-known/webfinger', async (c) => {
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
      aliases: [instanceActor.ap_id],
      links: [
        {
          rel: 'self',
          type: 'application/activity+json',
          href: instanceActor.ap_id,
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
  const actor = await c.env.DB.prepare(
    'SELECT ap_id, preferred_username FROM actors WHERE preferred_username = ?'
  ).bind(username).first<ActorIdRow>();

  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  return c.json({
    subject: `acct:${username}@${domain}`,
    aliases: [actor.ap_id],
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: actor.ap_id,
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

ap.get('/ap/users/:username', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await c.env.DB.prepare(`
    SELECT ap_id, type, preferred_username, name, summary, icon_url, header_url,
           inbox, outbox, followers_url, following_url, public_key_pem,
           follower_count, following_count, post_count, is_private, created_at
    FROM actors WHERE ap_id = ?
  `).bind(apId).first<Actor>();

  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  // Build AP JSON-LD response
  const actorResponse: Record<string, unknown> = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
    id: actor.ap_id,
    type: actor.type,
    preferredUsername: actor.preferred_username,
    name: actor.name,
    summary: actor.summary,
    url: `${baseUrl}/users/${username}`,
    icon: actor.icon_url ? { type: 'Image', url: actor.icon_url } : undefined,
    image: actor.header_url ? { type: 'Image', url: actor.header_url } : undefined,
    inbox: actor.inbox,
    outbox: actor.outbox,
    followers: actor.followers_url,
    following: actor.following_url,
    publicKey: {
      id: `${actor.ap_id}#main-key`,
      owner: actor.ap_id,
      publicKeyPem: actor.public_key_pem,
    },
    discoverable: !actor.is_private,
    published: actor.created_at,
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

ap.get('/ap/actor', async (c) => {
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
    id: instanceActor.ap_id,
    type: 'Group',
    preferredUsername: instanceActor.preferred_username,
    name: instanceActor.name || 'Yurucommu',
    summary: instanceActor.summary || '',
    inbox: `${baseUrl}/ap/actor/inbox`,
    outbox: `${baseUrl}/ap/actor/outbox`,
    followers: `${baseUrl}/ap/actor/followers`,
    following: `${baseUrl}/ap/actor/following`,
    publicKey: {
      id: `${instanceActor.ap_id}#main-key`,
      owner: instanceActor.ap_id,
      publicKeyPem: instanceActor.public_key_pem,
    },
    rooms: `${baseUrl}/ap/rooms`,
    joinPolicy: instanceActor.join_policy || 'open',
    postingPolicy: instanceActor.posting_policy || 'members',
    visibility: instanceActor.visibility || 'public',
  };

  c.header('Content-Type', 'application/activity+json');
  return c.json(actorResponse);
});


// Rooms (Communities)
// ============================================================

ap.get('/ap/rooms', async (c) => {
  const baseUrl = c.env.APP_URL;
  const rooms = await c.env.DB.prepare(`
    SELECT preferred_username, name, summary
    FROM communities
    ORDER BY created_at ASC
  `).all();

  const items = (rooms.results || []).map((room: RoomRow) => ({
    id: roomApId(baseUrl, room.preferred_username),
    type: 'Room',
    name: room.name,
    summary: room.summary || '',
  }));

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${baseUrl}/ap/rooms`,
    type: 'OrderedCollection',
    totalItems: items.length,
    orderedItems: items,
  });
});

ap.get('/ap/rooms/:roomId', async (c) => {
  const baseUrl = c.env.APP_URL;
  const roomId = c.req.param('roomId');

  const room = await c.env.DB.prepare(`
    SELECT preferred_username, name, summary
    FROM communities
    WHERE preferred_username = ? OR ap_id = ?
  `).bind(roomId, roomId).first<RoomRow>();

  if (!room) return c.json({ error: 'Room not found' }, 404);

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: roomApId(baseUrl, room.preferred_username),
    type: 'Room',
    name: room.name,
    summary: room.summary || '',
    stream: `${roomApId(baseUrl, room.preferred_username)}/stream`,
  });
});

ap.get('/ap/rooms/:roomId/stream', async (c) => {
  const baseUrl = c.env.APP_URL;
  const roomId = c.req.param('roomId');
  const limit = parseLimit(c.req.query('limit'), 20, MAX_ROOM_STREAM_LIMIT);
  const before = c.req.query('before');

  const community = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username
    FROM communities
    WHERE preferred_username = ? OR ap_id = ?
  `).bind(roomId, roomId).first<CommunityRow>();

  if (!community) return c.json({ error: 'Room not found' }, 404);

  let query = `
    SELECT o.ap_id, o.attributed_to, o.content, o.published
    FROM objects o
    WHERE o.type = 'Note' AND o.community_ap_id = ?
  `;
  const params: Array<string | number | null> = [community.ap_id];

  if (before) {
    query += ' AND o.published < ?';
    params.push(before);
  }

  query += ' ORDER BY o.published DESC LIMIT ?';
  params.push(limit);

  const objects = await c.env.DB.prepare(query).bind(...params).all();
  const items = (objects.results || []).map((o: RoomStreamRow) => ({
    id: o.ap_id,
    type: 'Note',
    attributedTo: o.attributed_to,
    content: o.content,
    published: o.published,
    room: roomApId(baseUrl, community.preferred_username),
  }));

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${roomApId(baseUrl, community.preferred_username)}/stream`,
    type: 'OrderedCollection',
    totalItems: items.length,
    orderedItems: items,
  });
});
// ============================================================

ap.route('/', inboxRoutes);
ap.route('/', outboxRoutes);

export default ap;
