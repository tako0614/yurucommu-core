import type { Database } from '../../../../db';
import { eq, and, or, sql, inArray } from 'drizzle-orm';
import { actors, actorCache, objects, follows, likes, storyVotes, storyViews, activities } from '../../../../db';
import { upsertActivityAndNotify } from './inbox-shared-helpers';
import {
  activityApId,
  generateId,
  isLocal,
  isSafeRemoteUrl,
  objectApId,
  fetchWithTimeout,
} from '../../../federation-helpers';
import {
  type ActivityContext,
  type Activity,
  type StoryOverlay,
  getActivityObject,
  getActivityObjectId,
} from '../inbox-types';

type ActorRow = typeof actors.$inferSelect;

// ---------------------------------------------------------------------------
// Inline helpers
// ---------------------------------------------------------------------------

function isStoryType(type: string | string[] | undefined): boolean {
  if (!type) return false;
  return Array.isArray(type) ? type.includes('Story') : type === 'Story';
}

// ---------------------------------------------------------------------------
// Create handler
// ---------------------------------------------------------------------------

export async function handleCreate(
  c: ActivityContext,
  activity: Activity,
  _recipient: ActorRow,
  actor: string,
  baseUrl: string
) {
  const db = c.get('db');
  const object = getActivityObject(activity);
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
  const existing = await db.select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (existing) return;

  const attachments = object.attachment ? JSON.stringify(object.attachment) : '[]';
  const publishedAt = object.published || new Date().toISOString();
  const parentObj = object.inReplyTo
    ? await db.select({ attributedTo: objects.attributedTo })
        .from(objects)
        .where(eq(objects.apId, object.inReplyTo))
        .get()
    : null;
  const shouldNotifyParent = !!(parentObj && isLocal(parentObj.attributedTo, baseUrl));
  const replyActivityId = shouldNotifyParent ? activity.id || activityApId(baseUrl, generateId()) : null;

  // Try to insert object; if duplicate, skip
  const insertResult = await db.insert(objects)
    .values({
      apId: objectId,
      type: 'Note',
      attributedTo: actor,
      content: object.content || '',
      summary: object.summary || null,
      attachmentsJson: attachments,
      inReplyTo: object.inReplyTo || null,
      visibility: object.to?.includes('https://www.w3.org/ns/activitystreams#Public') ? 'public' : 'unlisted',
      communityApId: null,
      published: publishedAt,
      isLocal: 0,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  if (!insertResult) return; // duplicate

  await db.update(actors)
    .set({ postCount: sql`${actors.postCount} + 1` })
    .where(eq(actors.apId, actor));

  if (object.inReplyTo) {
    await db.update(objects)
      .set({ replyCount: sql`${objects.replyCount} + 1` })
      .where(eq(objects.apId, object.inReplyTo));
  }

  if (shouldNotifyParent && parentObj && replyActivityId) {
    await upsertActivityAndNotify(
      db, replyActivityId, 'Create', actor, objectId, activity, parentObj.attributedTo
    );
  }
}

// ---------------------------------------------------------------------------
// Create(Story) handler
// ---------------------------------------------------------------------------

export async function handleCreateStory(
  c: ActivityContext,
  activity: Activity,
  actor: string,
  baseUrl: string
) {
  const db = c.get('db');
  const object = getActivityObject(activity);
  if (!object) return;
  const objectId = object.id || objectApId(baseUrl, generateId());

  // Check if story already exists
  const existing = await db.select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (existing) return;

  // attachment validation (required)
  if (!object.attachment) {
    console.error('Remote story has no attachment:', objectId);
    return;
  }

  // Normalize attachment (handle array or single object)
  const attachmentArray = Array.isArray(object.attachment)
    ? object.attachment
    : [object.attachment];
  const attachment = attachmentArray[0] as { url?: string; mediaType?: string; width?: number; height?: number };

  if (!attachment || !attachment.url) {
    console.error('Remote story attachment has no URL:', objectId);
    return;
  }

  // overlays validation (optional, validate if present)
  let overlays: StoryOverlay[] | undefined;
  if (Array.isArray(object.overlays)) {
    const filtered = (object.overlays as StoryOverlay[]).filter(
      (o: StoryOverlay) =>
        o && o.position &&
        typeof o.position.x === 'number' &&
        typeof o.position.y === 'number'
    );
    if (filtered.length > 0) overlays = filtered;
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
    displayDuration: (object as { displayDuration?: string }).displayDuration || 'PT5S',
    overlays,
  };

  const now = new Date().toISOString();
  const endTime = object.endTime || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.insert(objects)
    .values({
      apId: objectId,
      type: 'Story',
      attributedTo: actor,
      content: '',
      attachmentsJson: JSON.stringify(attachmentData),
      endTime,
      published: object.published || now,
      isLocal: 0,
    });
}

// ---------------------------------------------------------------------------
// Delete handler
// ---------------------------------------------------------------------------

export async function handleDelete(c: ActivityContext, activity: Activity) {
  const db = c.get('db');
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  const actorId = typeof activity.actor === 'string' ? activity.actor : null;
  if (!actorId) {
    console.warn(`[ActivityPub] Delete activity missing actor`);
    return;
  }

  const delObj = await db.select({
    attributedTo: objects.attributedTo,
    type: objects.type,
    replyCount: objects.replyCount,
  })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (!delObj) return;

  // Verify actor owns the object before deleting
  if (delObj.attributedTo !== actorId) {
    console.warn(`[ActivityPub] Delete rejected: actor ${actorId} does not own object ${objectId} (owned by ${delObj.attributedTo})`);
    return;
  }

  // Story-specific cleanup
  if (delObj.type === 'Story') {
    await db.delete(storyVotes).where(eq(storyVotes.storyApId, objectId));
    await db.delete(storyViews).where(eq(storyViews.storyApId, objectId));
  }

  // Common cleanup for all object types
  await db.delete(likes).where(eq(likes.objectApId, objectId));

  await db.delete(objects).where(eq(objects.apId, objectId));

  await db.update(actors)
    .set({ postCount: sql`${actors.postCount} - 1` })
    .where(eq(actors.apId, delObj.attributedTo));
}

// ---------------------------------------------------------------------------
// Update handler
// ---------------------------------------------------------------------------

export async function handleUpdate(c: ActivityContext, activity: Activity, actor: string) {
  const db = c.get('db');
  const object = getActivityObject(activity);
  if (!object) return;

  const objectId = object.id;
  if (!objectId) return;

  const existing = await db.select({ attributedTo: objects.attributedTo })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (!existing || existing.attributedTo !== actor) return;

  // Update object content
  if (object.type === 'Note') {
    const attachments = object.attachment ? JSON.stringify(object.attachment) : undefined;
    await db.update(objects)
      .set({
        content: object.content || undefined,
        summary: object.summary || undefined,
        attachmentsJson: attachments || undefined,
        updated: new Date().toISOString(),
      })
      .where(eq(objects.apId, objectId));
  }
}

// ---------------------------------------------------------------------------
// Move handler (account migration)
// ---------------------------------------------------------------------------

export async function handleMove(c: ActivityContext, activity: Activity, actor: string) {
  const db = c.get('db');
  const oldActorApId = getActivityObjectId(activity);
  const newActorApId = getActivityTargetId(activity);
  if (!oldActorApId || !newActorApId) return;

  // Only accept self-move. Signature verification already ensures the request is signed,
  // but we also require Move.object to match Move.actor (defense-in-depth).
  if (oldActorApId !== actor) return;
  if (oldActorApId === newActorApId) return;

  if (!isSafeRemoteUrl(newActorApId)) {
    console.warn(`[ActivityPub] Blocked unsafe Move target: ${newActorApId}`);
    return;
  }

  // Refresh/cache the new actor document (best-effort).
  await refreshActorCache(db, newActorApId);

  // Rewrite follow graph references from old -> new in batches.
  const followerRows = await db.select({
    followingApId: follows.followingApId,
    status: follows.status,
    activityApId: follows.activityApId,
    createdAt: follows.createdAt,
    acceptedAt: follows.acceptedAt,
  })
    .from(follows)
    .where(eq(follows.followerApId, oldActorApId));

  const followingRows = await db.select({
    followerApId: follows.followerApId,
    status: follows.status,
    activityApId: follows.activityApId,
    createdAt: follows.createdAt,
    acceptedAt: follows.acceptedAt,
  })
    .from(follows)
    .where(eq(follows.followingApId, oldActorApId));

  const followerTargets = followerRows.map((row) => row.followingApId);
  const followingSources = followingRows.map((row) => row.followerApId);

  const existingFollowerPairs = followerTargets.length > 0
    ? await db.select({ followingApId: follows.followingApId })
        .from(follows)
        .where(and(eq(follows.followerApId, newActorApId), inArray(follows.followingApId, followerTargets)))
    : [];
  const existingFollowingPairs = followingSources.length > 0
    ? await db.select({ followerApId: follows.followerApId })
        .from(follows)
        .where(and(inArray(follows.followerApId, followingSources), eq(follows.followingApId, newActorApId)))
    : [];

  const existingFollowerTargetSet = new Set(existingFollowerPairs.map((row) => row.followingApId));
  const existingFollowingSourceSet = new Set(existingFollowingPairs.map((row) => row.followerApId));

  const followerRewrites = followerRows
    .filter((row) => !existingFollowerTargetSet.has(row.followingApId))
    .map((row) => ({
      followerApId: newActorApId,
      followingApId: row.followingApId,
      status: row.status,
      activityApId: row.activityApId,
      createdAt: row.createdAt,
      acceptedAt: row.acceptedAt,
    }));
  const followingRewrites = followingRows
    .filter((row) => !existingFollowingSourceSet.has(row.followerApId))
    .map((row) => ({
      followerApId: row.followerApId,
      followingApId: newActorApId,
      status: row.status,
      activityApId: row.activityApId,
      createdAt: row.createdAt,
      acceptedAt: row.acceptedAt,
    }));

  // Sequential operations (no interactive transactions in D1)
  if (followerRewrites.length > 0) {
    await db.insert(follows).values(followerRewrites);
  }
  if (followerRows.length > 0) {
    await db.delete(follows).where(eq(follows.followerApId, oldActorApId));
  }
  if (followingRewrites.length > 0) {
    await db.insert(follows).values(followingRewrites);
  }
  if (followingRows.length > 0) {
    await db.delete(follows).where(eq(follows.followingApId, oldActorApId));
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getActivityTargetId(activity: Activity): string | null {
  const target = activity.target;
  if (!target) return null;
  if (typeof target === 'string') return target;
  return target.id || null;
}

/** Fetch a remote actor document and cache it locally. Best-effort (errors are logged, not thrown). */
async function refreshActorCache(
  db: Database,
  actorApIdValue: string
): Promise<void> {
  type RemoteActorDoc = {
    id: string;
    type?: string;
    preferredUsername?: string;
    name?: string;
    summary?: string;
    icon?: { url?: string };
    inbox?: string;
    outbox?: string;
    publicKey?: { id?: string; publicKeyPem?: string };
    endpoints?: { sharedInbox?: string };
  };

  try {
    const res = await fetchWithTimeout(actorApIdValue, {
      headers: { 'Accept': 'application/activity+json, application/ld+json' },
      timeout: 15000,
    });
    if (!res.ok) return;

    const data = await res.json() as RemoteActorDoc;
    if (!data?.id || data.id !== actorApIdValue || !data.inbox || !isSafeRemoteUrl(data.inbox)) return;

    const cacheFields = {
      type: data.type || 'Person',
      preferredUsername: data.preferredUsername || null,
      name: data.name || null,
      summary: data.summary || null,
      iconUrl: data.icon?.url || null,
      inbox: data.inbox,
      outbox: data.outbox || null,
      sharedInbox: data.endpoints?.sharedInbox || null,
      publicKeyId: data.publicKey?.id || null,
      publicKeyPem: data.publicKey?.publicKeyPem || null,
      rawJson: JSON.stringify(data),
      lastFetchedAt: new Date().toISOString(),
    };

    await db.insert(actorCache)
      .values({ apId: data.id, ...cacheFields })
      .onConflictDoUpdate({ target: actorCache.apId, set: cacheFields });
  } catch (e) {
    console.warn('[ActivityPub] Failed to refresh Move target actor cache:', e);
  }
}
