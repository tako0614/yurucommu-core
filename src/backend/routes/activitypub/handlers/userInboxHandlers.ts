import type { Actor } from '../../../types';
import {
  activityApId,
  generateId,
  isLocal,
  isSafeRemoteUrl,
  objectApId,
  signRequest,
} from '../../../utils';
import {
  Activity,
  ActivityContext,
  ActivityRow,
  ActorCacheInboxRow,
  AttributedToRow,
  FollowRow,
  ObjectApIdRow,
  ObjectDeleteRow,
  ObjectOwnerRow,
  StoryOverlay,
  getActivityObject,
  getActivityObjectId,
} from '../inbox-types';

// Handle Follow activity
export async function handleFollow(
  c: ActivityContext,
  activity: Activity,
  recipient: Actor,
  actor: string,
  baseUrl: string
) {
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
    const cachedActor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(actor).first<ActorCacheInboxRow>();
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
      const headers = await signRequest(
        recipient.private_key_pem,
        keyId,
        'POST',
        cachedActor.inbox,
        JSON.stringify(acceptActivity)
      );

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
export async function handleAccept(c: ActivityContext, activity: Activity) {
  const followId = getActivityObjectId(activity);
  if (!followId) return;

  // Find the follow by activity_ap_id
  const follow = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE activity_ap_id = ?'
  ).bind(followId).first<FollowRow>();

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
export async function handleUndo(
  c: ActivityContext,
  activity: Activity,
  recipient: Actor,
  actor: string,
  baseUrl: string
) {
  const activityObject = getActivityObject(activity);
  const objectType = activityObject?.type;
  const objectId = getActivityObjectId(activity);

  // If object is just a string (activity ID), try to find the original activity
  if (!objectType && objectId) {
    const originalActivity = await c.env.DB.prepare(
      'SELECT type, object_ap_id FROM activities WHERE ap_id = ?'
    ).bind(objectId).first<ActivityRow>();

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
    const likedObjectId = activityObject?.object;
    if (likedObjectId) {
      await c.env.DB.prepare('DELETE FROM likes WHERE actor_ap_id = ? AND object_ap_id = ?')
        .bind(actor, likedObjectId).run();

      // Update like count
      await c.env.DB.prepare('UPDATE objects SET like_count = like_count - 1 WHERE ap_id = ? AND like_count > 0')
        .bind(likedObjectId).run();
    } else if (objectId) {
      // Fallback: try to find by activity_ap_id
      const like = await c.env.DB.prepare('SELECT object_ap_id FROM likes WHERE activity_ap_id = ?')
        .bind(objectId).first<ObjectApIdRow>();
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
    const announcedObjectId = activityObject?.object;
    if (announcedObjectId) {
      await c.env.DB.prepare('DELETE FROM announces WHERE actor_ap_id = ? AND object_ap_id = ?')
        .bind(actor, announcedObjectId).run();

      // Update announce count
      await c.env.DB.prepare('UPDATE objects SET announce_count = announce_count - 1 WHERE ap_id = ? AND announce_count > 0')
        .bind(announcedObjectId).run();
    } else if (objectId) {
      // Fallback: try to find by activity_ap_id
      const announce = await c.env.DB.prepare('SELECT object_ap_id FROM announces WHERE activity_ap_id = ?')
        .bind(objectId).first<ObjectApIdRow>();
      if (announce) {
        await c.env.DB.prepare('DELETE FROM announces WHERE activity_ap_id = ?').bind(objectId).run();
        await c.env.DB.prepare('UPDATE objects SET announce_count = announce_count - 1 WHERE ap_id = ? AND announce_count > 0')
          .bind(announce.object_ap_id).run();
      }
    }
  }
}

// Handle Like activity
export async function handleLike(
  c: ActivityContext,
  activity: Activity,
  recipient: Actor,
  actor: string,
  baseUrl: string
) {
  const objectId = getActivityObjectId(activity);
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
  const likedObj = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?')
    .bind(objectId).first<AttributedToRow>();
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

function isStoryType(type: string | string[] | undefined): boolean {
  if (!type) return false;
  if (Array.isArray(type)) {
    return type.includes('Story');
  }
  return type === 'Story';
}

// Handle Create activity
export async function handleCreate(
  c: ActivityContext,
  activity: Activity,
  recipient: Actor,
  actor: string,
  baseUrl: string
) {
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
      .bind(object.inReplyTo).first<AttributedToRow>();
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
export async function handleCreateStory(
  c: ActivityContext,
  activity: Activity,
  actor: string,
  baseUrl: string
) {
  const object = getActivityObject(activity);
  if (!object) return;
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
  let overlays: StoryOverlay[] | undefined = undefined;
  if (object.overlays) {
    if (!Array.isArray(object.overlays)) {
      overlays = undefined; // Ignore invalid format
    } else {
      // Simple validation: position is required
      const filtered = (object.overlays as StoryOverlay[]).filter((o: StoryOverlay) =>
        o && o.position &&
        typeof o.position.x === 'number' &&
        typeof o.position.y === 'number'
      );
      overlays = filtered.length > 0 ? filtered : undefined;
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
export async function handleDelete(c: ActivityContext, activity: Activity) {
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  // Get object before deletion
  const delObj = await c.env.DB.prepare('SELECT attributed_to, type, reply_count FROM objects WHERE ap_id = ?')
    .bind(objectId).first<ObjectDeleteRow>();

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
export async function handleAnnounce(
  c: ActivityContext,
  activity: Activity,
  recipient: Actor,
  actor: string,
  baseUrl: string
) {
  const objectId = getActivityObjectId(activity);
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
  const announcedObj = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?')
    .bind(objectId).first<AttributedToRow>();
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
export async function handleUpdate(c: ActivityContext, activity: Activity, actor: string) {
  const object = getActivityObject(activity);
  if (!object) return;

  const objectId = object.id;
  if (!objectId) return;

  // Verify the actor owns this object
  const existing = await c.env.DB.prepare(
    'SELECT ap_id, attributed_to FROM objects WHERE ap_id = ?'
  ).bind(objectId).first<ObjectOwnerRow>();

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
export async function handleReject(c: ActivityContext, activity: Activity) {
  const followId = getActivityObjectId(activity);
  if (!followId) return;

  // Find the follow by activity_ap_id and update status
  const follow = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE activity_ap_id = ?'
  ).bind(followId).first<FollowRow>();

  if (!follow) return;

  // Delete the follow record since it was rejected
  await c.env.DB.prepare('DELETE FROM follows WHERE activity_ap_id = ?').bind(followId).run();
}

