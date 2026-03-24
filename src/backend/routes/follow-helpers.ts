import type { Context } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import type { Database } from '../../db';
import { actors, actorCache, follows, activities, inbox } from '../../db';
import { generateId, activityApId, isLocal, isSafeRemoteUrl, fetchWithTimeout } from '../utils';
import { enqueueDeliveryToActor } from '../lib/delivery/queue';

const REMOTE_FETCH_TIMEOUT_MS = 10000;

export type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

export type RemoteActor = {
  id: string;
  type?: string;
  preferredUsername?: string;
  name?: string;
  summary?: string;
  icon?: { url?: string };
  inbox?: string;
  outbox?: string;
  followers?: string;
  following?: string;
  endpoints?: { sharedInbox?: string };
  publicKey?: { id?: string; publicKeyPem?: string };
};

export type RequestContext = {
  actor: { ap_id: string };
  body: Record<string, unknown>;
  baseUrl: string;
  db: Database;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export async function parseJsonObject(
  c: { req: { json: () => Promise<unknown> } },
): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value
    .map((v) => parseNonEmptyString(v))
    .filter((v): v is string => v !== null);
  if (parsed.length !== value.length) return null;
  return parsed;
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: string }).message).includes('UNIQUE constraint failed');
  }
  return false;
}

export function buildApActivity(
  type: string,
  actorId: string,
  object: unknown,
  id: string,
): Record<string, unknown> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id,
    type,
    actor: actorId,
    object,
    published: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the authenticated actor and parsed JSON body from a request.
 * Returns a Response on auth or parse failure, or the extracted context on success.
 */
export async function requireActorAndBody(c: HonoContext): Promise<RequestContext | Response> {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const body = await parseJsonObject(c);
  if (!body) return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400);
  return { actor, body, baseUrl: c.env.APP_URL, db: c.get('prisma') };
}

export function isResponse(value: RequestContext | Response): value is Response {
  return value instanceof Response;
}

// ---------------------------------------------------------------------------
// Activity helpers
// ---------------------------------------------------------------------------

/**
 * Creates an outbound AP activity record and enqueues it for delivery.
 */
export async function createAndDeliverActivity(
  env: Env,
  db: Database,
  baseUrl: string,
  type: string,
  actorId: string,
  object: unknown,
  recipientApId: string,
  objectApId?: string | null,
): Promise<void> {
  const id = activityApId(baseUrl, generateId());
  const activity = buildApActivity(type, actorId, object, id);

  await db.insert(activities).values({
    apId: id,
    type,
    actorApId: actorId,
    objectApId: objectApId || undefined,
    rawJson: JSON.stringify(activity),
    direction: 'outbound',
  });

  await enqueueDeliveryToActor(env, id, recipientApId);
}

/**
 * Delivers an Accept or Reject activity to a remote requester.
 * No-op if the requester is local.
 */
export async function deliverResponseIfRemote(
  env: Env,
  db: Database,
  baseUrl: string,
  type: 'Accept' | 'Reject',
  actorId: string,
  requesterApId: string,
  originalActivityApId: string | null,
): Promise<void> {
  if (isLocal(requesterApId, baseUrl)) return;
  await createAndDeliverActivity(
    env, db, baseUrl, type, actorId,
    originalActivityApId, requesterApId, originalActivityApId,
  );
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/**
 * Finds a pending follow request where `requesterApId` is trying to follow `targetApId`.
 */
export async function findPendingFollow(
  db: Database,
  requesterApId: string,
  targetApId: string,
) {
  return db.select().from(follows).where(
    and(
      eq(follows.followerApId, requesterApId),
      eq(follows.followingApId, targetApId),
      eq(follows.status, 'pending'),
    ),
  ).get();
}

// ---------------------------------------------------------------------------
// Follow flow handlers
// ---------------------------------------------------------------------------

export async function handleLocalFollow(
  c: HonoContext,
  db: Database,
  baseUrl: string,
  actor: { ap_id: string },
  targetApId: string,
) {
  const target = await db.select({ isPrivate: actors.isPrivate }).from(actors).where(
    eq(actors.apId, targetApId),
  ).get();
  if (!target) return c.json({ error: 'Target actor not found' }, 404);

  const status = target.isPrivate ? 'pending' : 'accepted';
  const id = activityApId(baseUrl, generateId());
  const now = new Date().toISOString();
  const followActivity = buildApActivity('Follow', actor.ap_id, targetApId, id);

  try {
    await db.insert(follows).values({
      followerApId: actor.ap_id,
      followingApId: targetApId,
      status,
      activityApId: id,
      acceptedAt: status === 'accepted' ? now : null,
    });

    if (status === 'accepted') {
      await db.update(actors).set({
        followingCount: sql`${actors.followingCount} + 1`,
      }).where(eq(actors.apId, actor.ap_id));
      await db.update(actors).set({
        followerCount: sql`${actors.followerCount} + 1`,
      }).where(eq(actors.apId, targetApId));
    }

    await db.insert(activities).values({
      apId: id,
      type: 'Follow',
      actorApId: actor.ap_id,
      objectApId: targetApId,
      rawJson: JSON.stringify(followActivity),
      direction: 'local',
    });

    await db.insert(inbox).values({
      actorApId: targetApId,
      activityApId: id,
      read: 0,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'Already following or pending' }, 400);
    }
    throw error;
  }

  return c.json({ success: true, status });
}

export async function handleRemoteFollow(
  c: HonoContext,
  db: Database,
  baseUrl: string,
  actor: { ap_id: string },
  targetApId: string,
) {
  if (!isSafeRemoteUrl(targetApId)) {
    return c.json({ error: 'Invalid target_ap_id' }, 400);
  }

  let cachedActorRow = await db.select().from(actorCache).where(
    eq(actorCache.apId, targetApId),
  ).get();

  if (!cachedActorRow) {
    try {
      const res = await fetchWithTimeout(targetApId, {
        headers: { 'Accept': 'application/activity+json, application/ld+json' },
        timeout: REMOTE_FETCH_TIMEOUT_MS,
      });
      if (!res.ok) return c.json({ error: 'Could not fetch remote actor' }, 400);

      const actorData = await res.json() as RemoteActor;
      if (
        !actorData?.id ||
        !actorData?.inbox ||
        !isSafeRemoteUrl(actorData.id) ||
        !isSafeRemoteUrl(actorData.inbox)
      ) {
        return c.json({ error: 'Invalid remote actor data' }, 400);
      }

      cachedActorRow = await db.insert(actorCache).values({
        apId: actorData.id,
        type: actorData.type || 'Person',
        preferredUsername: actorData.preferredUsername || null,
        name: actorData.name || null,
        summary: actorData.summary || null,
        iconUrl: actorData.icon?.url || null,
        inbox: actorData.inbox,
        outbox: actorData.outbox || null,
        followersUrl: actorData.followers || null,
        followingUrl: actorData.following || null,
        sharedInbox: actorData.endpoints?.sharedInbox || null,
        publicKeyId: actorData.publicKey?.id || null,
        publicKeyPem: actorData.publicKey?.publicKeyPem || null,
        rawJson: JSON.stringify(actorData),
        lastFetchedAt: new Date().toISOString(),
      }).returning().get();
    } catch {
      return c.json({ error: 'Failed to fetch remote actor' }, 400);
    }
  }

  if (!cachedActorRow?.inbox || !isSafeRemoteUrl(cachedActorRow.inbox)) {
    return c.json({ error: 'Invalid inbox URL' }, 400);
  }

  const id = activityApId(baseUrl, generateId());
  const followActivity = buildApActivity('Follow', actor.ap_id, targetApId, id);

  try {
    await db.insert(follows).values({
      followerApId: actor.ap_id,
      followingApId: targetApId,
      status: 'pending',
      activityApId: id,
    });

    await db.insert(activities).values({
      apId: id,
      type: 'Follow',
      actorApId: actor.ap_id,
      objectApId: targetApId,
      rawJson: JSON.stringify(followActivity),
      direction: 'outbound',
    });
  } catch (e) {
    console.error('[Follow] Failed to create remote follow:', e);
    return c.json({ error: 'Failed to follow remote actor' }, 500);
  }

  await enqueueDeliveryToActor(c.env, id, targetApId);
  return c.json({ success: true, status: 'pending' });
}
