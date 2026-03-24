import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../types';
import { eq, and, desc, count } from 'drizzle-orm';
import { activities, follows, actors, objects } from '../../../db';
import { actorApId, objectApId, parseLimit, safeJsonParse } from '../../utils';
import { getInstanceActor } from './utils';

type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseOrderedItems(rows: Array<{ rawJson: string }>): unknown[] {
  return rows
    .map((row) => safeJsonParse<unknown | null>(row.rawJson, null))
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
  const db = c.get('prisma');
  const instActor = await getInstanceActor(c);
  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = 20;

  const whereClause = and(
    eq(activities.actorApId, instActor.apId),
    eq(activities.direction, 'outbound')
  );

  const [rows, totalCount] = await Promise.all([
    db.query.activities.findMany({
      where: whereClause,
      columns: { rawJson: true },
      orderBy: desc(activities.createdAt),
      limit,
      offset: (pageNum - 1) * limit,
    }),
    db.select({ count: count() }).from(activities).where(whereClause).get(),
  ]);

  return orderedCollectionResponse(
    c,
    `${instActor.apId}/outbox`,
    page,
    pageNum,
    totalCount?.count ?? 0,
    parseOrderedItems(rows)
  );
});

ap.get('/ap/actor/followers', async (c) => {
  const db = c.get('prisma');
  const instActor = await getInstanceActor(c);
  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = 50;

  const whereClause = and(
    eq(follows.followingApId, instActor.apId),
    eq(follows.status, 'accepted')
  );

  const [rows, totalCount] = await Promise.all([
    db.query.follows.findMany({
      where: whereClause,
      columns: { followerApId: true },
      orderBy: desc(follows.acceptedAt),
      limit,
      offset: (pageNum - 1) * limit,
    }),
    db.select({ count: count() }).from(follows).where(whereClause).get(),
  ]);

  return orderedCollectionResponse(
    c,
    `${instActor.apId}/followers`,
    page,
    pageNum,
    totalCount?.count ?? 0,
    rows.map((f) => f.followerApId)
  );
});

ap.get('/ap/actor/following', async (c) => {
  const instActor = await getInstanceActor(c);
  const followingUrl = `${instActor.apId}/following`;

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
  const db = c.get('prisma');
  const username = c.req.param('username');
  const apId = actorApId(c.env.APP_URL, username);

  const actor = await db.query.actors.findFirst({
    where: eq(actors.apId, apId),
    columns: { apId: true },
  });
  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = 20;

  const whereClause = and(
    eq(activities.actorApId, apId),
    eq(activities.direction, 'outbound')
  );

  const [rows, totalCount] = await Promise.all([
    db.query.activities.findMany({
      where: whereClause,
      columns: { rawJson: true },
      orderBy: desc(activities.createdAt),
      limit,
      offset: (pageNum - 1) * limit,
    }),
    db.select({ count: count() }).from(activities).where(whereClause).get(),
  ]);

  return orderedCollectionResponse(
    c,
    `${apId}/outbox`,
    page,
    pageNum,
    totalCount?.count ?? 0,
    parseOrderedItems(rows)
  );
});

ap.get('/ap/users/:username/followers', async (c) => {
  const db = c.get('prisma');
  const username = c.req.param('username');
  const apId = actorApId(c.env.APP_URL, username);

  const actor = await db.query.actors.findFirst({
    where: eq(actors.apId, apId),
    columns: { apId: true, isPrivate: true },
  });
  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = 50;

  const whereClause = and(
    eq(follows.followingApId, apId),
    eq(follows.status, 'accepted')
  );

  const [rows, totalCount] = await Promise.all([
    db.query.follows.findMany({
      where: whereClause,
      columns: { followerApId: true },
      orderBy: desc(follows.acceptedAt),
      limit,
      offset: (pageNum - 1) * limit,
    }),
    db.select({ count: count() }).from(follows).where(whereClause).get(),
  ]);

  return orderedCollectionResponse(
    c,
    `${apId}/followers`,
    page,
    pageNum,
    totalCount?.count ?? 0,
    actor.isPrivate ? [] : rows.map((f) => f.followerApId)
  );
});

ap.get('/ap/users/:username/following', async (c) => {
  const db = c.get('prisma');
  const username = c.req.param('username');
  const apId = actorApId(c.env.APP_URL, username);

  const actor = await db.query.actors.findFirst({
    where: eq(actors.apId, apId),
    columns: { apId: true },
  });
  if (!actor) return c.json({ error: 'Actor not found' }, 404);

  const page = c.req.query('page');
  const pageNum = parseLimit(page, 1, 100000);
  const limit = 50;

  const whereClause = and(
    eq(follows.followerApId, apId),
    eq(follows.status, 'accepted')
  );

  const [rows, totalCount] = await Promise.all([
    db.query.follows.findMany({
      where: whereClause,
      columns: { followingApId: true },
      orderBy: desc(follows.acceptedAt),
      limit,
      offset: (pageNum - 1) * limit,
    }),
    db.select({ count: count() }).from(follows).where(whereClause).get(),
  ]);

  return orderedCollectionResponse(
    c,
    `${apId}/following`,
    page,
    pageNum,
    totalCount?.count ?? 0,
    rows.map((f) => f.followingApId)
  );
});

// ---------------------------------------------------------------------------
// Object endpoint
// ---------------------------------------------------------------------------

ap.get('/ap/objects/:id', async (c) => {
  const db = c.get('prisma');
  const id = c.req.param('id');
  const objApId = objectApId(c.env.APP_URL, id);

  const obj = await db.query.objects.findFirst({
    where: eq(objects.apId, objApId),
    columns: {
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
