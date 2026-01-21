import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { actorApId, objectApId } from '../../utils';
import { getInstanceActor } from './utils';

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

ap.get('/ap/actor/outbox', async (c) => {
  const prisma = c.get('prisma');
  const instanceActor = await getInstanceActor(c);
  const page = c.req.query('page');
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 20;
  const offset = (pageNum - 1) * limit;

  const activities = await prisma.activity.findMany({
    where: {
      actorApId: instanceActor.apId,
      direction: 'outbound',
    },
    select: { rawJson: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const totalCount = await prisma.activity.count({
    where: {
      actorApId: instanceActor.apId,
      direction: 'outbound',
    },
  });

  const outboxUrl = `${instanceActor.apId}/outbox`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${outboxUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: outboxUrl,
      orderedItems: activities.map((a) => JSON.parse(a.rawJson)),
    });
  }

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: outboxUrl,
    type: 'OrderedCollection',
    totalItems: totalCount,
    first: `${outboxUrl}?page=1`,
  });
});

ap.get('/ap/actor/followers', async (c) => {
  const prisma = c.get('prisma');
  const instanceActor = await getInstanceActor(c);
  const page = c.req.query('page');
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 50;
  const offset = (pageNum - 1) * limit;

  const followers = await prisma.follow.findMany({
    where: {
      followingApId: instanceActor.apId,
      status: 'accepted',
    },
    select: { followerApId: true },
    orderBy: { acceptedAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const totalCount = await prisma.follow.count({
    where: {
      followingApId: instanceActor.apId,
      status: 'accepted',
    },
  });

  const followersUrl = `${instanceActor.apId}/followers`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${followersUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: followersUrl,
      orderedItems: followers.map((f) => f.followerApId),
    });
  }

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: followersUrl,
    type: 'OrderedCollection',
    totalItems: totalCount,
    first: `${followersUrl}?page=1`,
  });
});

ap.get('/ap/actor/following', async (c) => {
  const instanceActor = await getInstanceActor(c);
  const followingUrl = `${instanceActor.apId}/following`;
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
  const prisma = c.get('prisma');
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true },
  });

  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  // Paginate activities
  const page = c.req.query('page');
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 20;
  const offset = (pageNum - 1) * limit;

  const activities = await prisma.activity.findMany({
    where: {
      actorApId: apId,
      direction: 'outbound',
    },
    select: { rawJson: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const totalCount = await prisma.activity.count({
    where: {
      actorApId: apId,
      direction: 'outbound',
    },
  });

  const outboxUrl = `${apId}/outbox`;

  if (page) {
    // Return items for specific page
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${outboxUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: outboxUrl,
      orderedItems: activities.map((a) => JSON.parse(a.rawJson)),
    });
  } else {
    // Return collection
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: outboxUrl,
      type: 'OrderedCollection',
      totalItems: totalCount,
      first: `${outboxUrl}?page=1`,
    });
  }
});

// ============================================================
// Followers Collection
// ============================================================

ap.get('/ap/users/:username/followers', async (c) => {
  const prisma = c.get('prisma');
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true },
  });

  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  // Paginate followers
  const page = c.req.query('page');
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 50;
  const offset = (pageNum - 1) * limit;

  const followers = await prisma.follow.findMany({
    where: {
      followingApId: apId,
      status: 'accepted',
    },
    select: { followerApId: true },
    orderBy: { acceptedAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const totalCount = await prisma.follow.count({
    where: {
      followingApId: apId,
      status: 'accepted',
    },
  });

  const followersUrl = `${apId}/followers`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${followersUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: followersUrl,
      orderedItems: followers.map((f) => f.followerApId),
    });
  } else {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: followersUrl,
      type: 'OrderedCollection',
      totalItems: totalCount,
      first: `${followersUrl}?page=1`,
    });
  }
});

// ============================================================
// Following Collection
// ============================================================

ap.get('/ap/users/:username/following', async (c) => {
  const prisma = c.get('prisma');
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true },
  });

  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  // Paginate following
  const page = c.req.query('page');
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 50;
  const offset = (pageNum - 1) * limit;

  const following = await prisma.follow.findMany({
    where: {
      followerApId: apId,
      status: 'accepted',
    },
    select: { followingApId: true },
    orderBy: { acceptedAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const totalCount = await prisma.follow.count({
    where: {
      followerApId: apId,
      status: 'accepted',
    },
  });

  const followingUrl = `${apId}/following`;

  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${followingUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: followingUrl,
      orderedItems: following.map((f) => f.followingApId),
    });
  } else {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: followingUrl,
      type: 'OrderedCollection',
      totalItems: totalCount,
      first: `${followingUrl}?page=1`,
    });
  }
});

// ============================================================
// Object Endpoint - Note/Post
// ============================================================

ap.get('/ap/objects/:id', async (c) => {
  const prisma = c.get('prisma');
  const id = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const objApId = objectApId(baseUrl, id);

  const obj = await prisma.object.findUnique({
    where: { apId: objApId },
    select: {
      apId: true,
      type: true,
      attributedTo: true,
      content: true,
      summary: true,
      attachmentsJson: true,
      inReplyTo: true,
      visibility: true,
      published: true,
      likeCount: true,
      replyCount: true,
      announceCount: true,
    },
  });

  if (!obj) return c.json({ error: 'Object not found' }, 404);

  // Parse attachments
  let attachments: unknown[] = [];
  try {
    attachments = JSON.parse(obj.attachmentsJson);
  } catch {
    attachments = [];
  }

  const objectResponse: Record<string, unknown> = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
    id: obj.apId,
    type: obj.type,
    attributedTo: obj.attributedTo,
    content: obj.content,
    summary: obj.summary,
    inReplyTo: obj.inReplyTo,
    published: obj.published,
    to: [
      obj.visibility === 'public' ? 'https://www.w3.org/ns/activitystreams#Public' : undefined,
      `${obj.attributedTo}/followers`,
    ].filter(Boolean),
    attachment: attachments.length > 0 ? attachments : undefined,
    likes: {
      id: `${obj.apId}/likes`,
      type: 'Collection',
      totalItems: obj.likeCount,
    },
    replies: {
      id: `${obj.apId}/replies`,
      type: 'Collection',
      totalItems: obj.replyCount,
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
