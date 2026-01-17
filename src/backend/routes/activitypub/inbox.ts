import { Hono } from 'hono';
import type { Env, Variables, Actor } from '../../types';
import { generateId, actorApId, objectApId, activityApId, isLocal, signRequest, isSafeRemoteUrl } from '../../utils';
import { getInstanceActor } from './utils';

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

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
        if (!isSafeRemoteUrl(actor)) {
          console.warn(`[ActivityPub] Blocked unsafe actor fetch: ${actor}`);
        } else {
          const res = await fetch(actor, {
            headers: { 'Accept': 'application/activity+json, application/ld+json' }
          });
          if (res.ok) {
            const actorData = await res.json() as any;
            if (
              actorData?.id &&
              actorData?.inbox &&
              isSafeRemoteUrl(actorData.id) &&
              isSafeRemoteUrl(actorData.inbox)
            ) {
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
          }
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
    case 'Add':
    case 'Remove':
    case 'Block':
    case 'Flag':
    case 'Move':
      // Known but unsupported activity types - silently acknowledge
      break;
    default:
      // Log unknown activity types for debugging (production: remove or use proper logging)
      if (activityType) {
        console.warn(`[ActivityPub] Unhandled activity type: ${activityType} from ${actor}`);
      }
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
      if (!isSafeRemoteUrl(cachedActor.inbox)) {
        console.warn(`[ActivityPub] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
        return;
      }
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
  const objectId = typeof activity.object === 'string' ? activity.object : activity.object?.id;

  // If object is just a string (activity ID), try to find the original activity
  if (!objectType && objectId) {
    const originalActivity = await c.env.DB.prepare(
      'SELECT type, object_ap_id FROM activities WHERE ap_id = ?'
    ).bind(objectId).first<any>();

    if (originalActivity) {
      // Handle based on original activity type
      if (originalActivity.type === 'Follow') {
        await c.env.DB.prepare('DELETE FROM follows WHERE activity_ap_id = ?').bind(objectId).run();
        await c.env.DB.prepare('UPDATE actors SET follower_count = follower_count - 1 WHERE ap_id = ? AND follower_count > 0')
          .bind(recipient.ap_id).run();
      } else if (originalActivity.type === 'Like' && originalActivity.object_ap_id) {
        await c.env.DB.prepare('DELETE FROM likes WHERE activity_ap_id = ?').bind(objectId).run();
        await c.env.DB.prepare('UPDATE objects SET like_count = like_count - 1 WHERE ap_id = ? AND like_count > 0')
          .bind(originalActivity.object_ap_id).run();
      } else if (originalActivity.type === 'Announce' && originalActivity.object_ap_id) {
        await c.env.DB.prepare('DELETE FROM announces WHERE activity_ap_id = ?').bind(objectId).run();
        await c.env.DB.prepare('UPDATE objects SET announce_count = announce_count - 1 WHERE ap_id = ? AND announce_count > 0')
          .bind(originalActivity.object_ap_id).run();
      }
      return;
    }
  }

  if (objectType === 'Follow') {
    // Undo follow
    if (objectId) {
      // Try to find by activity_ap_id first
      const deleted = await c.env.DB.prepare('DELETE FROM follows WHERE activity_ap_id = ? RETURNING *')
        .bind(objectId).first();
      if (!deleted) {
        // Fallback: delete by actor pair
        await c.env.DB.prepare('DELETE FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?')
          .bind(actor, recipient.ap_id).run();
      }
    } else {
      await c.env.DB.prepare('DELETE FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?')
        .bind(actor, recipient.ap_id).run();
    }

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
      } else {
        // Last resort: try to delete any like from this actor for the recipient's objects
        await c.env.DB.prepare(`
          DELETE FROM likes WHERE actor_ap_id = ? AND object_ap_id IN (
            SELECT ap_id FROM objects WHERE attributed_to = ?
          )
        `).bind(actor, recipient.ap_id).run();
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
  if (cached?.inbox) {
    if (!isSafeRemoteUrl(cached.inbox)) {
      console.warn(`[ActivityPub] Blocked unsafe inbox URL: ${cached.inbox}`);
      return null;
    }
    return cached.inbox;
  }

  try {
    if (!isSafeRemoteUrl(actorApId)) {
      console.warn(`[ActivityPub] Blocked unsafe actor fetch: ${actorApId}`);
      return null;
    }
    const res = await fetch(actorApId, {
      headers: { 'Accept': 'application/activity+json, application/ld+json' }
    });
    if (!res.ok) return null;
    const actorData = await res.json() as any;
    if (!actorData?.inbox || !isSafeRemoteUrl(actorData.inbox)) return null;

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
    if (!isSafeRemoteUrl(inboxUrl)) {
      console.warn(`[ActivityPub] Blocked unsafe inbox URL: ${inboxUrl}`);
      return;
    }

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

export default ap;
