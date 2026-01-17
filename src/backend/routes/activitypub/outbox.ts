import { Hono } from 'hono';
import type { Env, Variables, APObject } from '../../types';
import { actorApId, objectApId } from '../../utils';
import { getInstanceActor } from './utils';

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

type CountRow = {
  count: number;
};

type ActivityRow = {
  raw_json: string;
};

type FollowerRow = {
  follower_ap_id: string;
};

type FollowingRow = {
  following_ap_id: string;
};

type ActorIdRow = {
  ap_id: string;
};

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
  ).bind(instanceActor.ap_id).first<CountRow>();

  const outboxUrl = `${instanceActor.ap_id}/outbox`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${outboxUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: outboxUrl,
      orderedItems: (activities.results || []).map((a: ActivityRow) => JSON.parse(a.raw_json)),
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
  ).bind(instanceActor.ap_id).first<CountRow>();

  const followersUrl = `${instanceActor.ap_id}/followers`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${followersUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: followersUrl,
      orderedItems: (followers.results || []).map((f: FollowerRow) => f.follower_ap_id),
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

// Outbox - Outgoing Activities Collection
// ============================================================

ap.get('/ap/users/:username/outbox', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await c.env.DB.prepare(
    'SELECT ap_id FROM actors WHERE ap_id = ?'
  ).bind(apId).first<ActorIdRow>();

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
  ).bind(apId).first<CountRow>();

  const outboxUrl = `${apId}/outbox`;

  if (page) {
    // Return items for specific page
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${outboxUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: outboxUrl,
      orderedItems: (activities.results || []).map((a: ActivityRow) => JSON.parse(a.raw_json)),
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
  ).bind(apId).first<ActorIdRow>();

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
  ).bind(apId).first<CountRow>();

  const followersUrl = `${apId}/followers`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${followersUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: followersUrl,
      orderedItems: (followers.results || []).map((f: FollowerRow) => f.follower_ap_id),
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
  ).bind(apId).first<ActorIdRow>();

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
  ).bind(apId).first<CountRow>();

  const followingUrl = `${apId}/following`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${followingUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: followingUrl,
      orderedItems: (following.results || []).map((f: FollowingRow) => f.following_ap_id),
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
  let attachments: unknown[] = [];
  try {
    attachments = JSON.parse(obj.attachments_json);
  } catch {
    attachments = [];
  }

  const objectResponse: Record<string, unknown> = {
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
    if (objectResponse[key] === undefined) {
      delete objectResponse[key];
    }
  });

  c.header('Content-Type', 'application/activity+json');
  return c.json(objectResponse);
});

export default ap;
