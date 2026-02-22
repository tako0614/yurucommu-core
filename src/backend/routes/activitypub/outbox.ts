import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../types';
import { actorApId, objectApId, parseLimit, safeJsonParse } from '../../utils';
import { getInstanceActor } from './utils';

type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseOrderedItems(activities: Array<{ rawJson: string }>): unknown[] {
  return activities
    .map((activity) => safeJsonParse<unknown | null>(activity.rawJson, null))
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

/**
 * Respond with an OrderedCollection or OrderedCollectionPage depending on
 * whether a `page` query parameter is present. Avoids duplicating the
 * ActivityStreams JSON-LD envelope across every collection endpoint.
 */
function orderedCollectionResponse(
  c: HonoContext,
  collectionUrl: string,
  page: string | undefined,
  pageNum: number,
  totalItems: number,
  orderedItems: unknown[]
): Response {
  if (page) {
    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${collectionUrl}?page=${pageNum}`,
      type: 'OrderedCollectionPage',
      partOf: collectionUrl,
      orderedItems,
    });
  }

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: collectionUrl,
    type: 'OrderedCollection',
    totalItems,
    first: `${collectionUrl}?page=1`,
  });
}

// ---------------------------------------------------------------------------
// Instance actor collections
// ---------------------------------------------------------------------------

ap.get('/ap/actor/outbox', async (c) => {
  const prisma = c.get('prisma');
  const instanceActor = await getInstanceActor(c);
  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = 20;

  const where = { actorApId: instanceActor.apId, direction: 'outbound' as const };

  const [activities, totalCount] = await Promise.all([
    prisma.activity.findMany({
      where,
      select: { rawJson: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (pageNum - 1) * limit,
    }),
    prisma.activity.count({ where }),
  ]);

  return orderedCollectionResponse(
    c,
    `${instanceActor.apId}/outbox`,
    page,
    pageNum,
    totalCount,
    parseOrderedItems(activities)
  );
});

ap.get('/ap/actor/followers', async (c) => {
  const prisma = c.get('prisma');
  const instanceActor = await getInstanceActor(c);
  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = 50;

  const where = { followingApId: instanceActor.apId, status: 'accepted' as const };

  const [followers, totalCount] = await Promise.all([
    prisma.follow.findMany({
      where,
      select: { followerApId: true },
      orderBy: { acceptedAt: 'desc' },
      take: limit,
      skip: (pageNum - 1) * limit,
    }),
    prisma.follow.count({ where }),
  ]);

  return orderedCollectionResponse(
    c,
    `${instanceActor.apId}/followers`,
    page,
    pageNum,
    totalCount,
    followers.map((f) => f.followerApId)
  );
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

// ---------------------------------------------------------------------------
// User collections
// ---------------------------------------------------------------------------

ap.get('/ap/users/:username/outbox', async (c) => {
  const prisma = c.get('prisma');
  const username = c.req.param('username');
  const apId = actorApId(c.env.APP_URL, username);

  const actor = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true },
  });
  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = 20;

  const where = { actorApId: apId, direction: 'outbound' as const };

  const [activities, totalCount] = await Promise.all([
    prisma.activity.findMany({
      where,
      select: { rawJson: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (pageNum - 1) * limit,
    }),
    prisma.activity.count({ where }),
  ]);

  return orderedCollectionResponse(
    c,
    `${apId}/outbox`,
    page,
    pageNum,
    totalCount,
    parseOrderedItems(activities)
  );
});

ap.get('/ap/users/:username/followers', async (c) => {
  const prisma = c.get('prisma');
  const username = c.req.param('username');
  const apId = actorApId(c.env.APP_URL, username);

  const actor = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true, isPrivate: true },
  });
  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = 50;

  const where = { followingApId: apId, status: 'accepted' as const };

  const [followers, totalCount] = await Promise.all([
    prisma.follow.findMany({
      where,
      select: { followerApId: true },
      orderBy: { acceptedAt: 'desc' },
      take: limit,
      skip: (pageNum - 1) * limit,
    }),
    prisma.follow.count({ where }),
  ]);

  return orderedCollectionResponse(
    c,
    `${apId}/followers`,
    page,
    pageNum,
    totalCount,
    actor.isPrivate ? [] : followers.map((f) => f.followerApId)
  );
});

ap.get('/ap/users/:username/following', async (c) => {
  const prisma = c.get('prisma');
  const username = c.req.param('username');
  const apId = actorApId(c.env.APP_URL, username);

  const actor = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true },
  });
  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = 50;

  const where = { followerApId: apId, status: 'accepted' as const };

  const [following, totalCount] = await Promise.all([
    prisma.follow.findMany({
      where,
      select: { followingApId: true },
      orderBy: { acceptedAt: 'desc' },
      take: limit,
      skip: (pageNum - 1) * limit,
    }),
    prisma.follow.count({ where }),
  ]);

  return orderedCollectionResponse(
    c,
    `${apId}/following`,
    page,
    pageNum,
    totalCount,
    following.map((f) => f.followingApId)
  );
});

// ---------------------------------------------------------------------------
// Object endpoint
// ---------------------------------------------------------------------------

ap.get('/ap/objects/:id', async (c) => {
  const prisma = c.get('prisma');
  const id = c.req.param('id');
  const objApId = objectApId(c.env.APP_URL, id);

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

  const attachments = safeJsonParse<unknown[]>(obj.attachmentsJson, []);

  const to = [
    obj.visibility === 'public' ? 'https://www.w3.org/ns/activitystreams#Public' : undefined,
    `${obj.attributedTo}/followers`,
  ].filter(Boolean);

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
    to,
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

  for (const key of Object.keys(objectResponse)) {
    if (objectResponse[key] === undefined) {
      delete objectResponse[key];
    }
  }

  c.header('Content-Type', 'application/activity+json');
  return c.json(objectResponse);
});

export default ap;
