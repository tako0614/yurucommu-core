import { Hono } from 'hono';
import type { Env, Variables, Actor, ActorCache, APObject } from '../types';
import { generateId, actorApId, objectApId, activityApId, getDomain, isLocal, signRequest, generateKeyPair } from '../utils';

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();
const INSTANCE_ACTOR_USERNAME = 'community';

function roomApId(baseUrl: string, roomId: string): string {
  return `${baseUrl}/ap/rooms/${roomId}`;
}

async function getInstanceActor(c: { env: Env }) {
  const baseUrl = c.env.APP_URL;
  const apId = `${baseUrl}/ap/actor`;
  let actor = await c.env.DB.prepare(
    `SELECT ap_id, preferred_username, name, summary, public_key_pem, private_key_pem, join_policy, posting_policy, visibility
     FROM instance_actor WHERE ap_id = ?`
  ).bind(apId).first<any>();

  if (!actor) {
    const { publicKeyPem, privateKeyPem } = await generateKeyPair();
    const now = new Date().toISOString();
    await c.env.DB.prepare(`
      INSERT INTO instance_actor (ap_id, preferred_username, name, summary, public_key_pem, private_key_pem, join_policy, posting_policy, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', 'members', 'public', ?, ?)
    `).bind(
      apId,
      INSTANCE_ACTOR_USERNAME,
      'Yurucommu',
      'Yurucommu Community',
      publicKeyPem,
      privateKeyPem,
      now,
      now
    ).run();

    actor = {
      ap_id: apId,
      preferred_username: INSTANCE_ACTOR_USERNAME,
      name: 'Yurucommu',
      summary: 'Yurucommu Community',
      public_key_pem: publicKeyPem,
      private_key_pem: privateKeyPem,
      join_policy: 'open',
      posting_policy: 'members',
      visibility: 'public',
    };
  }

  return actor;
}

// ============================================================
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
  ).bind(username).first<any>();

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
  const actorResponse = {
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
    if ((actorResponse as any)[key] === undefined) {
      delete (actorResponse as any)[key];
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

ap.post('/ap/actor/inbox', async (c) => {
  const instanceActor = await getInstanceActor(c);
  const baseUrl = c.env.APP_URL;

  let activity: any;
  try {
    activity = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const activityId = activity.id || activityApId(baseUrl, generateId());
  const actor = activity.actor;
  const activityType = activity.type;

  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
    VALUES (?, ?, ?, ?, ?, 'inbound')
  `).bind(activityId, activityType, actor, activity.object?.id || activity.object, JSON.stringify(activity)).run();

  switch (activityType) {
    case 'Follow':
      await handleGroupFollow(c, activity, instanceActor, actor, baseUrl, activityId);
      break;
    case 'Undo':
      await handleGroupUndo(c, activity, instanceActor);
      break;
    case 'Create':
      await handleGroupCreate(c, activity, instanceActor, actor, baseUrl);
      break;
    default:
      // Unhandled activity types are silently ignored
  }

  return c.json({ success: true });
});

ap.get('/ap/actor/outbox', async (c) => {
  const instanceActor = await getInstanceActor(c);
  const page = c.req.query('page');
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 20;
  const offset = (pageNum - 1) * limit;

  const activities = await c.env.DB.prepare(`
    SELECT raw_json
    FROM activities
    WHERE actor_ap_id = ? AND direction = 'outbound'
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(instanceActor.ap_id, limit, offset).all();

  const totalCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM activities WHERE actor_ap_id = ? AND direction = "outbound"'
  ).bind(instanceActor.ap_id).first<any>();

  const outboxUrl = `${instanceActor.ap_id}/outbox`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${outboxUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: outboxUrl,
      orderedItems: (activities.results || []).map((a: any) => JSON.parse(a.raw_json)),
    });
  }

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: outboxUrl,
    type: 'OrderedCollection',
    totalItems: totalCount?.count || 0,
    first: `${outboxUrl}?page=1`,
  });
});

ap.get('/ap/actor/followers', async (c) => {
  const instanceActor = await getInstanceActor(c);
  const page = c.req.query('page');
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 50;
  const offset = (pageNum - 1) * limit;

  const followers = await c.env.DB.prepare(`
    SELECT follower_ap_id
    FROM follows
    WHERE following_ap_id = ? AND status = 'accepted'
    ORDER BY accepted_at DESC
    LIMIT ? OFFSET ?
  `).bind(instanceActor.ap_id, limit, offset).all();

  const totalCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM follows WHERE following_ap_id = ? AND status = "accepted"'
  ).bind(instanceActor.ap_id).first<any>();

  const followersUrl = `${instanceActor.ap_id}/followers`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${followersUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: followersUrl,
      orderedItems: (followers.results || []).map((f: any) => f.follower_ap_id),
    });
  }

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: followersUrl,
    type: 'OrderedCollection',
    totalItems: totalCount?.count || 0,
    first: `${followersUrl}?page=1`,
  });
});

ap.get('/ap/actor/following', async (c) => {
  const instanceActor = await getInstanceActor(c);
  const followingUrl = `${instanceActor.ap_id}/following`;
  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: followingUrl,
    type: 'OrderedCollection',
    totalItems: 0,
    first: `${followingUrl}?page=1`,
  });
});

// ============================================================
// Rooms (Communities)
// ============================================================

ap.get('/ap/rooms', async (c) => {
  const baseUrl = c.env.APP_URL;
  const rooms = await c.env.DB.prepare(`
    SELECT preferred_username, name, summary
    FROM communities
    ORDER BY created_at ASC
  `).all();

  const items = (rooms.results || []).map((room: any) => ({
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
  `).bind(roomId, roomId).first<any>();

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
  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');

  const community = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username
    FROM communities
    WHERE preferred_username = ? OR ap_id = ?
  `).bind(roomId, roomId).first<any>();

  if (!community) return c.json({ error: 'Room not found' }, 404);

  let query = `
    SELECT o.ap_id, o.attributed_to, o.content, o.published
    FROM objects o
    WHERE o.type = 'Note' AND o.community_ap_id = ?
  `;
  const params: any[] = [community.ap_id];

  if (before) {
    query += ' AND o.published < ?';
    params.push(before);
  }

  query += ' ORDER BY o.published DESC LIMIT ?';
  params.push(limit);

  const objects = await c.env.DB.prepare(query).bind(...params).all();
  const items = (objects.results || []).map((o: any) => ({
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
// Inbox - Receive Activities
// ============================================================

ap.post('/ap/users/:username/inbox', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  // Get the recipient actor
  const recipient = await c.env.DB.prepare(
    'SELECT ap_id, private_key_pem FROM actors WHERE ap_id = ?'
  ).bind(apId).first<Actor>();

  if (!recipient) return c.json({ error: 'Actor not found' }, 404);

  let activity: any;
  try {
    activity = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const activityId = activity.id || activityApId(baseUrl, generateId());
  const actor = activity.actor;
  const activityType = activity.type;

  // Store activity
  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
    VALUES (?, ?, ?, ?, ?, 'inbound')
  `).bind(activityId, activityType, actor, activity.object?.id || activity.object, JSON.stringify(activity)).run();

  // Cache remote actor if not already cached
  if (!isLocal(actor, baseUrl)) {
    const cached = await c.env.DB.prepare('SELECT ap_id FROM actor_cache WHERE ap_id = ?').bind(actor).first();
    if (!cached) {
      try {
        const res = await fetch(actor, {
          headers: { 'Accept': 'application/activity+json, application/ld+json' }
        });
        if (res.ok) {
          const actorData = await res.json() as any;
          await c.env.DB.prepare(`
            INSERT INTO actor_cache (ap_id, type, preferred_username, name, summary, icon_url, inbox, public_key_pem, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            actorData.id,
            actorData.type,
            actorData.preferredUsername,
            actorData.name,
            actorData.summary,
            actorData.icon?.url,
            actorData.inbox,
            actorData.publicKey?.publicKeyPem,
            JSON.stringify(actorData)
          ).run();
        }
      } catch (e) {
        console.error('Failed to cache remote actor:', e);
      }
    }
  }

  // Handle different activity types
  switch (activityType) {
    case 'Follow':
      await handleFollow(c, activity, recipient, actor, baseUrl);
      break;
    case 'Accept':
      await handleAccept(c, activity);
      break;
    case 'Undo':
      await handleUndo(c, activity, recipient, actor, baseUrl);
      break;
    case 'Like':
      await handleLike(c, activity, recipient, actor, baseUrl);
      break;
    case 'Create':
      await handleCreate(c, activity, recipient, actor, baseUrl);
      break;
    case 'Delete':
      await handleDelete(c, activity);
      break;
    case 'Announce':
      await handleAnnounce(c, activity, recipient, actor, baseUrl);
      break;
    case 'Update':
      await handleUpdate(c, activity, actor);
      break;
    case 'Reject':
      await handleReject(c, activity);
      break;
    default:
      // Unhandled activity types are silently ignored
  }

  return c.json({ success: true });
});

// Handle Follow activity
async function handleFollow(c: any, activity: any, recipient: Actor, actor: string, baseUrl: string) {
  // Check if follow already exists
  const existing = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?'
  ).bind(actor, recipient.ap_id).first();

  if (existing) return;

  const activityId = activity.id || activityApId(baseUrl, generateId());

  // Determine if we need to approve
  const status = recipient.is_private ? 'pending' : 'accepted';

  // Create follow record
  await c.env.DB.prepare(`
    INSERT INTO follows (follower_ap_id, following_ap_id, status, activity_ap_id, accepted_at)
    VALUES (?, ?, ?, ?, ${status === 'accepted' ? "datetime('now')" : 'NULL'})
  `).bind(actor, recipient.ap_id, status, activityId).run();

  // Update counts if accepted
  if (status === 'accepted') {
    await c.env.DB.prepare('UPDATE actors SET follower_count = follower_count + 1 WHERE ap_id = ?')
      .bind(recipient.ap_id).run();
  }

  // Store activity and add to inbox (AP Native notification)
  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, published, local)
    VALUES (?, 'Follow', ?, ?, ?, 0)
  `).bind(activityId, actor, recipient.ap_id, now).run();

  await c.env.DB.prepare(`
    INSERT INTO inbox (actor_ap_id, activity_ap_id, read, created_at)
    VALUES (?, ?, 0, ?)
  `).bind(recipient.ap_id, activityId, now).run();

  // Send Accept response
  if (!isLocal(actor, baseUrl)) {
    const cachedActor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(actor).first();
    if (cachedActor?.inbox) {
      const acceptId = activityApId(baseUrl, generateId());
      const acceptActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: acceptId,
        type: 'Accept',
        actor: recipient.ap_id,
        object: activityId,
      };

      const keyId = `${recipient.ap_id}#main-key`;
      const headers = await signRequest(recipient.private_key_pem, keyId, 'POST', cachedActor.inbox, JSON.stringify(acceptActivity));

      try {
        await fetch(cachedActor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body: JSON.stringify(acceptActivity),
        });
      } catch (e) {
        console.error('Failed to send Accept:', e);
      }

      // Store accept activity
      await c.env.DB.prepare(`
        INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
        VALUES (?, 'Accept', ?, ?, ?, 'outbound')
      `).bind(acceptId, recipient.ap_id, activityId, JSON.stringify(acceptActivity)).run();
    }
  }
}

// Handle Accept activity
async function handleAccept(c: any, activity: any) {
  const followId = activity.object?.id || activity.object;
  if (!followId) return;

  // Find the follow by activity_ap_id
  const follow = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE activity_ap_id = ?'
  ).bind(followId).first() as any;

  if (!follow) return;

  // Update follow status to accepted
  await c.env.DB.prepare(`
    UPDATE follows SET status = 'accepted', accepted_at = datetime('now')
    WHERE activity_ap_id = ?
  `).bind(followId).run();

  // Update counts
  await c.env.DB.prepare('UPDATE actors SET following_count = following_count + 1 WHERE ap_id = ?')
    .bind(follow.follower_ap_id).run();
  await c.env.DB.prepare('UPDATE actors SET follower_count = follower_count + 1 WHERE ap_id = ?')
    .bind(follow.following_ap_id).run();
}

// Handle Undo activity
async function handleUndo(c: any, activity: any, recipient: Actor, actor: string, baseUrl: string) {
  const objectType = activity.object?.type;
  const objectId = activity.object?.id;

  if (objectType === 'Follow') {
    // Undo follow
    await c.env.DB.prepare('DELETE FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?')
      .bind(actor, recipient.ap_id).run();

    // Update counts
    await c.env.DB.prepare('UPDATE actors SET follower_count = follower_count - 1 WHERE ap_id = ? AND follower_count > 0')
      .bind(recipient.ap_id).run();
  } else if (objectType === 'Like') {
    // Undo like - find the original liked object from the Like activity
    const likedObjectId = activity.object?.object;
    if (likedObjectId) {
      await c.env.DB.prepare('DELETE FROM likes WHERE actor_ap_id = ? AND object_ap_id = ?')
        .bind(actor, likedObjectId).run();

      // Update like count
      await c.env.DB.prepare('UPDATE objects SET like_count = like_count - 1 WHERE ap_id = ? AND like_count > 0')
        .bind(likedObjectId).run();
    } else if (objectId) {
      // Fallback: try to find by activity_ap_id
      const like = await c.env.DB.prepare('SELECT object_ap_id FROM likes WHERE activity_ap_id = ?')
        .bind(objectId).first<any>();
      if (like) {
        await c.env.DB.prepare('DELETE FROM likes WHERE activity_ap_id = ?').bind(objectId).run();
        await c.env.DB.prepare('UPDATE objects SET like_count = like_count - 1 WHERE ap_id = ? AND like_count > 0')
          .bind(like.object_ap_id).run();
      }
    }
  } else if (objectType === 'Announce') {
    // Undo announce (repost)
    const announcedObjectId = activity.object?.object;
    if (announcedObjectId) {
      await c.env.DB.prepare('DELETE FROM announces WHERE actor_ap_id = ? AND object_ap_id = ?')
        .bind(actor, announcedObjectId).run();

      // Update announce count
      await c.env.DB.prepare('UPDATE objects SET announce_count = announce_count - 1 WHERE ap_id = ? AND announce_count > 0')
        .bind(announcedObjectId).run();
    } else if (objectId) {
      // Fallback: try to find by activity_ap_id
      const announce = await c.env.DB.prepare('SELECT object_ap_id FROM announces WHERE activity_ap_id = ?')
        .bind(objectId).first<any>();
      if (announce) {
        await c.env.DB.prepare('DELETE FROM announces WHERE activity_ap_id = ?').bind(objectId).run();
        await c.env.DB.prepare('UPDATE objects SET announce_count = announce_count - 1 WHERE ap_id = ? AND announce_count > 0')
          .bind(announce.object_ap_id).run();
      }
    }
  }
}

// Handle Like activity
async function handleLike(c: any, activity: any, recipient: Actor, actor: string, baseUrl: string) {
  const objectId = activity.object;
  if (!objectId) return;

  const activityId = activity.id || activityApId(baseUrl, generateId());

  // Check if already liked
  const existing = await c.env.DB.prepare(
    'SELECT * FROM likes WHERE actor_ap_id = ? AND object_ap_id = ?'
  ).bind(actor, objectId).first();

  if (existing) return;

  // Create like record
  await c.env.DB.prepare(`
    INSERT INTO likes (actor_ap_id, object_ap_id, activity_ap_id)
    VALUES (?, ?, ?)
  `).bind(actor, objectId, activityId).run();

  // Update like count on object
  await c.env.DB.prepare('UPDATE objects SET like_count = like_count + 1 WHERE ap_id = ?')
    .bind(objectId).run();

  // Store activity and add to inbox (AP Native notification)
  const likedObj = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?').bind(objectId).first() as any;
  if (likedObj && isLocal(likedObj.attributed_to, baseUrl)) {
    const now = new Date().toISOString();
    await c.env.DB.prepare(`
      INSERT OR IGNORE INTO activities (ap_id, type, actor_ap_id, object_ap_id, published, local)
      VALUES (?, 'Like', ?, ?, ?, 0)
    `).bind(activityId, actor, objectId, now).run();

    await c.env.DB.prepare(`
      INSERT INTO inbox (actor_ap_id, activity_ap_id, read, created_at)
      VALUES (?, ?, 0, ?)
    `).bind(likedObj.attributed_to, activityId, now).run();
  }
}

// Check if object type includes Story
function isStoryType(type: string | string[]): boolean {
  if (Array.isArray(type)) {
    return type.includes('Story');
  }
  return type === 'Story';
}

// Handle Create activity
async function handleCreate(c: any, activity: any, recipient: Actor, actor: string, baseUrl: string) {
  const object = activity.object;
  if (!object) return;

  // Handle Story type
  if (isStoryType(object.type)) {
    await handleCreateStory(c, activity, actor, baseUrl);
    return;
  }

  // Handle Note type
  if (object.type !== 'Note') return;

  const objectId = object.id || objectApId(baseUrl, generateId());

  // Check if object already exists
  const existing = await c.env.DB.prepare('SELECT ap_id FROM objects WHERE ap_id = ?').bind(objectId).first();
  if (existing) return;

  // Insert object
  const attachments = object.attachment ? JSON.stringify(object.attachment) : '[]';
  await c.env.DB.prepare(`
    INSERT INTO objects (ap_id, type, attributed_to, content, summary, attachments_json,
                         in_reply_to, visibility, community_ap_id, published, is_local)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).bind(
    objectId,
    'Note',
    actor,
    object.content,
    object.summary,
    attachments,
    object.inReplyTo,
    object.to?.includes('https://www.w3.org/ns/activitystreams#Public') ? 'public' : 'unlisted',
    null,
    object.published
  ).run();

  // Increment post count for actor
  await c.env.DB.prepare('UPDATE actors SET post_count = post_count + 1 WHERE ap_id = ?').bind(actor).run();

  // If it's a reply, update reply count and add to inbox
  if (object.inReplyTo) {
    await c.env.DB.prepare('UPDATE objects SET reply_count = reply_count + 1 WHERE ap_id = ?')
      .bind(object.inReplyTo).run();

    // Add to inbox for reply notification (AP Native)
    const parentObj = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?')
      .bind(object.inReplyTo).first() as any;
    if (parentObj && isLocal(parentObj.attributed_to, baseUrl)) {
      const activityId = activity.id || activityApId(baseUrl, generateId());
      const now = new Date().toISOString();

      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO activities (ap_id, type, actor_ap_id, object_ap_id, published, local)
        VALUES (?, 'Create', ?, ?, ?, 0)
      `).bind(activityId, actor, objectId, now).run();

      await c.env.DB.prepare(`
        INSERT INTO inbox (actor_ap_id, activity_ap_id, read, created_at)
        VALUES (?, ?, 0, ?)
      `).bind(parentObj.attributed_to, activityId, now).run();
    }
  }
}

// Handle Create(Story) activity
async function handleCreateStory(c: any, activity: any, actor: string, baseUrl: string) {
  const object = activity.object;
  const objectId = object.id || objectApId(baseUrl, generateId());

  // Check if story already exists
  const existing = await c.env.DB.prepare('SELECT ap_id FROM objects WHERE ap_id = ?').bind(objectId).first();
  if (existing) return;

  // attachment validation (required)
  if (!object.attachment) {
    console.error('Remote story has no attachment:', objectId);
    return; // Ignore stories without attachment
  }

  // Normalize attachment (handle array or single object)
  const attachment = Array.isArray(object.attachment)
    ? object.attachment[0]
    : object.attachment;

  if (!attachment || !attachment.url) {
    console.error('Remote story attachment has no URL:', objectId);
    return;
  }

  // overlays validation (optional, validate if present)
  let overlays = object.overlays;
  if (overlays) {
    if (!Array.isArray(overlays)) {
      overlays = undefined; // Ignore invalid format
    } else {
      // Simple validation: position is required
      overlays = overlays.filter((o: any) =>
        o && o.position &&
        typeof o.position.x === 'number' &&
        typeof o.position.y === 'number'
      );
      if (overlays.length === 0) overlays = undefined;
    }
  }

  // Build attachments_json
  const attachmentData = {
    attachment: {
      r2_key: '', // Remote stories don't have local R2 key
      content_type: attachment.mediaType || 'image/jpeg',
      url: attachment.url,
      width: attachment.width || 1080,
      height: attachment.height || 1920,
    },
    displayDuration: object.displayDuration || 'PT5S',
    overlays: overlays,
  };

  const now = new Date().toISOString();
  const endTime = object.endTime || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // DB save
  await c.env.DB.prepare(`
    INSERT INTO objects (ap_id, type, attributed_to, content, attachments_json, end_time, published, is_local)
    VALUES (?, 'Story', ?, '', ?, ?, ?, 0)
  `).bind(
    objectId,
    actor,
    JSON.stringify(attachmentData),
    endTime,
    object.published || now
  ).run();

  // Increment post count for actor in cache
  await c.env.DB.prepare('UPDATE actor_cache SET post_count = COALESCE(post_count, 0) + 1 WHERE ap_id = ?').bind(actor).run();
}

// Handle Delete activity
async function handleDelete(c: any, activity: any) {
  const objectId = activity.object?.id || activity.object;
  if (!objectId) return;

  // Get object before deletion
  const delObj = await c.env.DB.prepare('SELECT attributed_to, type, reply_count FROM objects WHERE ap_id = ?')
    .bind(objectId).first() as any;

  if (!delObj) return;

  // If it's a Story, also delete related votes and views
  if (delObj.type === 'Story') {
    await c.env.DB.prepare('DELETE FROM story_votes WHERE story_ap_id = ?').bind(objectId).run();
    await c.env.DB.prepare('DELETE FROM story_views WHERE story_ap_id = ?').bind(objectId).run();
    await c.env.DB.prepare('DELETE FROM likes WHERE object_ap_id = ?').bind(objectId).run();
  }

  // Delete object
  await c.env.DB.prepare('DELETE FROM objects WHERE ap_id = ?').bind(objectId).run();

  // Update post count
  await c.env.DB.prepare('UPDATE actors SET post_count = post_count - 1 WHERE ap_id = ? AND post_count > 0')
    .bind(delObj.attributed_to).run();

  // Delete associated likes and replies (for Notes)
  if (delObj.type !== 'Story') {
    await c.env.DB.prepare('DELETE FROM likes WHERE object_ap_id = ?').bind(objectId).run();
  }
}

// Handle Announce activity (repost/boost)
async function handleAnnounce(c: any, activity: any, recipient: Actor, actor: string, baseUrl: string) {
  const objectId = typeof activity.object === 'string' ? activity.object : activity.object?.id;
  if (!objectId) return;

  const activityId = activity.id || activityApId(baseUrl, generateId());

  // Check if already announced
  const existing = await c.env.DB.prepare(
    'SELECT * FROM announces WHERE actor_ap_id = ? AND object_ap_id = ?'
  ).bind(actor, objectId).first();

  if (existing) return;

  // Create announce record
  await c.env.DB.prepare(`
    INSERT INTO announces (actor_ap_id, object_ap_id, activity_ap_id)
    VALUES (?, ?, ?)
  `).bind(actor, objectId, activityId).run();

  // Update announce count on object
  await c.env.DB.prepare('UPDATE objects SET announce_count = announce_count + 1 WHERE ap_id = ?')
    .bind(objectId).run();

  // Store activity and add to inbox (AP Native notification)
  const announcedObj = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?').bind(objectId).first() as any;
  if (announcedObj && isLocal(announcedObj.attributed_to, baseUrl)) {
    const now = new Date().toISOString();
    await c.env.DB.prepare(`
      INSERT OR IGNORE INTO activities (ap_id, type, actor_ap_id, object_ap_id, published, local)
      VALUES (?, 'Announce', ?, ?, ?, 0)
    `).bind(activityId, actor, objectId, now).run();

    await c.env.DB.prepare(`
      INSERT INTO inbox (actor_ap_id, activity_ap_id, read, created_at)
      VALUES (?, ?, 0, ?)
    `).bind(announcedObj.attributed_to, activityId, now).run();
  }
}

// Handle Update activity (edit posts)
async function handleUpdate(c: any, activity: any, actor: string) {
  const object = activity.object;
  if (!object) return;

  const objectId = object.id;
  if (!objectId) return;

  // Verify the actor owns this object
  const existing = await c.env.DB.prepare(
    'SELECT ap_id, attributed_to FROM objects WHERE ap_id = ?'
  ).bind(objectId).first<any>();

  if (!existing || existing.attributed_to !== actor) return;

  // Update object content
  if (object.type === 'Note') {
    const attachments = object.attachment ? JSON.stringify(object.attachment) : undefined;
    await c.env.DB.prepare(`
      UPDATE objects
      SET content = COALESCE(?, content),
          summary = COALESCE(?, summary),
          attachments_json = COALESCE(?, attachments_json),
          updated_at = datetime('now')
      WHERE ap_id = ?
    `).bind(
      object.content,
      object.summary,
      attachments,
      objectId
    ).run();
  }
}

// Handle Reject activity (follow request rejection)
async function handleReject(c: any, activity: any) {
  const followId = activity.object?.id || activity.object;
  if (!followId) return;

  // Find the follow by activity_ap_id and update status
  const follow = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE activity_ap_id = ?'
  ).bind(followId).first() as any;

  if (!follow) return;

  // Delete the follow record since it was rejected
  await c.env.DB.prepare('DELETE FROM follows WHERE activity_ap_id = ?').bind(followId).run();
}

// ============================================================
// Group Actor Inbox Handlers
// ============================================================

async function fetchRemoteInbox(c: any, actorApId: string): Promise<string | null> {
  const cached = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?')
    .bind(actorApId).first<any>();
  if (cached?.inbox) return cached.inbox;

  try {
    const res = await fetch(actorApId, {
      headers: { 'Accept': 'application/activity+json, application/ld+json' }
    });
    if (!res.ok) return null;
    const actorData = await res.json() as any;
    if (!actorData?.inbox) return null;

    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO actor_cache (ap_id, type, preferred_username, name, summary, icon_url, inbox, outbox, public_key_id, public_key_pem, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      actorData.id,
      actorData.type,
      actorData.preferredUsername,
      actorData.name,
      actorData.summary,
      actorData.icon?.url,
      actorData.inbox,
      actorData.outbox,
      actorData.publicKey?.id,
      actorData.publicKey?.publicKeyPem,
      JSON.stringify(actorData)
    ).run();

    return actorData.inbox;
  } catch (e) {
    console.error('Failed to fetch remote actor:', e);
    return null;
  }
}

async function handleGroupFollow(
  c: any,
  activity: any,
  instanceActor: any,
  actorApId: string,
  baseUrl: string,
  activityId: string
) {
  const existing = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?'
  ).bind(actorApId, instanceActor.ap_id).first();
  if (existing) return;

  let status: 'accepted' | 'pending' | 'rejected' = 'accepted';
  if (instanceActor.join_policy === 'approval') {
    status = 'pending';
  } else if (instanceActor.join_policy === 'invite') {
    status = 'rejected';
  }

  await c.env.DB.prepare(`
    INSERT INTO follows (follower_ap_id, following_ap_id, status, activity_ap_id, accepted_at)
    VALUES (?, ?, ?, ?, ${status === 'accepted' ? "datetime('now')" : 'NULL'})
  `).bind(actorApId, instanceActor.ap_id, status, activityId).run();

  if (isLocal(actorApId, baseUrl)) return;

  if (status === 'accepted' || status === 'rejected') {
    const inboxUrl = await fetchRemoteInbox(c, actorApId);
    if (!inboxUrl) return;

    const responseType = status === 'accepted' ? 'Accept' : 'Reject';
    const responseId = activityApId(baseUrl, generateId());
    const responseActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: responseId,
      type: responseType,
      actor: instanceActor.ap_id,
      object: activityId,
    };

    const keyId = `${instanceActor.ap_id}#main-key`;
    const headers = await signRequest(instanceActor.private_key_pem, keyId, 'POST', inboxUrl, JSON.stringify(responseActivity));

    try {
      await fetch(inboxUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/activity+json' },
        body: JSON.stringify(responseActivity),
      });
    } catch (e) {
      console.error(`Failed to send ${responseType}:`, e);
    }

    await c.env.DB.prepare(`
      INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
      VALUES (?, ?, ?, ?, ?, 'outbound')
    `).bind(responseId, responseType, instanceActor.ap_id, activityId, JSON.stringify(responseActivity)).run();
  }
}

async function handleGroupUndo(c: any, activity: any, instanceActor: any) {
  const objectId = activity.object?.id || activity.object;
  if (!objectId) return;

  const follow = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE activity_ap_id = ? AND following_ap_id = ?'
  ).bind(objectId, instanceActor.ap_id).first();

  if (follow) {
    await c.env.DB.prepare('DELETE FROM follows WHERE activity_ap_id = ? AND following_ap_id = ?')
      .bind(objectId, instanceActor.ap_id).run();
    return;
  }

  if (activity.object?.type === 'Follow') {
    await c.env.DB.prepare('DELETE FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?')
      .bind(activity.actor, instanceActor.ap_id).run();
  }
}

async function handleGroupCreate(
  c: any,
  activity: any,
  instanceActor: any,
  actorApId: string,
  baseUrl: string
) {
  const object = activity.object;
  if (!object || object.type !== 'Note') return;

  const roomUrl = object.room || activity.room;
  if (!roomUrl || typeof roomUrl !== 'string') return;
  const match = roomUrl.match(/\/ap\/rooms\/([^\/]+)$/);
  if (!match) return;
  const roomId = match[1];

  const community = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username
    FROM communities
    WHERE preferred_username = ? OR ap_id = ?
  `).bind(roomId, roomId).first<any>();
  if (!community) return;

  const postingPolicy = instanceActor.posting_policy || 'members';
  if (postingPolicy !== 'anyone') {
    const follow = await c.env.DB.prepare(`
      SELECT 1 FROM follows WHERE follower_ap_id = ? AND following_ap_id = ? AND status = 'accepted'
    `).bind(actorApId, instanceActor.ap_id).first();
    if (!follow) return;
    if (postingPolicy === 'mods' || postingPolicy === 'owners') return;
  }

  const objectId = object.id || objectApId(baseUrl, generateId());
  const existing = await c.env.DB.prepare('SELECT ap_id FROM objects WHERE ap_id = ?').bind(objectId).first();
  if (existing) return;

  const attachments = object.attachment ? JSON.stringify(object.attachment) : '[]';
  const now = object.published || new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO objects (ap_id, type, attributed_to, content, summary, attachments_json, visibility, community_ap_id, published, is_local)
    VALUES (?, 'Note', ?, ?, ?, ?, 'group', ?, ?, 0)
  `).bind(
    objectId,
    actorApId,
    object.content || '',
    object.summary || null,
    attachments,
    community.ap_id,
    now
  ).run();

  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (?, ?, 'audience', ?)
  `).bind(objectId, community.ap_id, now).run();
}

// ============================================================
// Outbox - Outgoing Activities Collection
// ============================================================

ap.get('/ap/users/:username/outbox', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await c.env.DB.prepare(
    'SELECT ap_id FROM actors WHERE ap_id = ?'
  ).bind(apId).first<any>();

  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  // Paginate activities
  const page = c.req.query('page');
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 20;
  const offset = (pageNum - 1) * limit;

  const activities = await c.env.DB.prepare(`
    SELECT ap_id, type, object_ap_id, raw_json, created_at
    FROM activities
    WHERE actor_ap_id = ? AND direction = 'outbound'
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(apId, limit, offset).all();

  const totalCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM activities WHERE actor_ap_id = ? AND direction = "outbound"'
  ).bind(apId).first<any>();

  const outboxUrl = `${apId}/outbox`;

  if (page) {
    // Return items for specific page
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${outboxUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: outboxUrl,
      orderedItems: (activities.results || []).map((a: any) => JSON.parse(a.raw_json)),
    });
  } else {
    // Return collection
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: outboxUrl,
      type: 'OrderedCollection',
      totalItems: totalCount?.count || 0,
      first: `${outboxUrl}?page=1`,
    });
  }
});

// ============================================================
// Followers Collection
// ============================================================

ap.get('/ap/users/:username/followers', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await c.env.DB.prepare(
    'SELECT ap_id FROM actors WHERE ap_id = ?'
  ).bind(apId).first<any>();

  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  // Paginate followers
  const page = c.req.query('page');
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 50;
  const offset = (pageNum - 1) * limit;

  const followers = await c.env.DB.prepare(`
    SELECT follower_ap_id
    FROM follows
    WHERE following_ap_id = ? AND status = 'accepted'
    ORDER BY accepted_at DESC
    LIMIT ? OFFSET ?
  `).bind(apId, limit, offset).all();

  const totalCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM follows WHERE following_ap_id = ? AND status = "accepted"'
  ).bind(apId).first<any>();

  const followersUrl = `${apId}/followers`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${followersUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: followersUrl,
      orderedItems: (followers.results || []).map((f: any) => f.follower_ap_id),
    });
  } else {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: followersUrl,
      type: 'OrderedCollection',
      totalItems: totalCount?.count || 0,
      first: `${followersUrl}?page=1`,
    });
  }
});

// ============================================================
// Following Collection
// ============================================================

ap.get('/ap/users/:username/following', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await c.env.DB.prepare(
    'SELECT ap_id FROM actors WHERE ap_id = ?'
  ).bind(apId).first<any>();

  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  // Paginate following
  const page = c.req.query('page');
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 50;
  const offset = (pageNum - 1) * limit;

  const following = await c.env.DB.prepare(`
    SELECT following_ap_id
    FROM follows
    WHERE follower_ap_id = ? AND status = 'accepted'
    ORDER BY accepted_at DESC
    LIMIT ? OFFSET ?
  `).bind(apId, limit, offset).all();

  const totalCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM follows WHERE follower_ap_id = ? AND status = "accepted"'
  ).bind(apId).first<any>();

  const followingUrl = `${apId}/following`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${followingUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: followingUrl,
      orderedItems: (following.results || []).map((f: any) => f.following_ap_id),
    });
  } else {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: followingUrl,
      type: 'OrderedCollection',
      totalItems: totalCount?.count || 0,
      first: `${followingUrl}?page=1`,
    });
  }
});

// ============================================================
// Object Endpoint - Note/Post
// ============================================================

ap.get('/ap/objects/:id', async (c) => {
  const id = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const objApId = objectApId(baseUrl, id);

  const obj = await c.env.DB.prepare(`
    SELECT ap_id, type, attributed_to, content, summary, attachments_json,
           in_reply_to, visibility, published, like_count, reply_count, announce_count
    FROM objects WHERE ap_id = ?
  `).bind(objApId).first<APObject>();

  if (!obj) return c.json({ error: 'Object not found' }, 404);

  // Parse attachments
  let attachments: any[] = [];
  try {
    attachments = JSON.parse(obj.attachments_json);
  } catch {
    attachments = [];
  }

  const objectResponse = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
    id: obj.ap_id,
    type: obj.type,
    attributedTo: obj.attributed_to,
    content: obj.content,
    summary: obj.summary,
    inReplyTo: obj.in_reply_to,
    published: obj.published,
    to: [
      obj.visibility === 'public' ? 'https://www.w3.org/ns/activitystreams#Public' : undefined,
      `${obj.attributed_to}/followers`,
    ].filter(Boolean),
    attachment: attachments.length > 0 ? attachments : undefined,
    likes: {
      type: 'Collection',
      count: obj.like_count,
    },
    replies: {
      type: 'Collection',
      count: obj.reply_count,
    },
  };

  // Remove undefined fields
  Object.keys(objectResponse).forEach((key) => {
    if ((objectResponse as any)[key] === undefined) {
      delete (objectResponse as any)[key];
    }
  });

  c.header('Content-Type', 'application/activity+json');
  return c.json(objectResponse);
});

export default ap;
