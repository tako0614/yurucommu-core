import { Hono } from 'hono';
import type { Env, Variables, Actor, ActorCache, APObject } from '../types';
import { generateId, actorApId, objectApId, activityApId, getDomain, isLocal, signRequest } from '../utils';

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

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
      await handleLike(c, activity, recipient, actor);
      break;
    case 'Create':
      await handleCreate(c, activity, recipient, actor, baseUrl);
      break;
    case 'Delete':
      await handleDelete(c, activity);
      break;
    default:
      console.log(`Unhandled activity type: ${activityType}`);
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

  // Create notification
  const notifId = generateId();
  await c.env.DB.prepare(`
    INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type)
    VALUES (?, ?, ?, ?)
  `).bind(notifId, recipient.ap_id, actor, status === 'pending' ? 'follow_request' : 'follow').run();

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
    // Undo like
    await c.env.DB.prepare('DELETE FROM likes WHERE actor_ap_id = ? AND object_ap_id = ?')
      .bind(actor, objectId).run();

    // Update like count
    await c.env.DB.prepare('UPDATE objects SET like_count = like_count - 1 WHERE ap_id = ? AND like_count > 0')
      .bind(objectId).run();

    // Create notification for undo
    const notifId = generateId();
    const obj = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?').bind(objectId).first() as any;
    if (obj) {
      await c.env.DB.prepare(`
        INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type, object_ap_id)
        VALUES (?, ?, ?, 'unlike', ?)
      `).bind(notifId, obj.attributed_to, actor, objectId).run();
    }
  }
}

// Handle Like activity
async function handleLike(c: any, activity: any, recipient: Actor, actor: string) {
  const objectId = activity.object;
  if (!objectId) return;

  // Check if already liked
  const existing = await c.env.DB.prepare(
    'SELECT * FROM likes WHERE actor_ap_id = ? AND object_ap_id = ?'
  ).bind(actor, objectId).first();

  if (existing) return;

  // Create like record
  const likeId = generateId();
  await c.env.DB.prepare(`
    INSERT INTO likes (id, actor_ap_id, object_ap_id)
    VALUES (?, ?, ?)
  `).bind(likeId, actor, objectId).run();

  // Update like count on object
  await c.env.DB.prepare('UPDATE objects SET like_count = like_count + 1 WHERE ap_id = ?')
    .bind(objectId).run();

  // Create notification
  const likedObj = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?').bind(objectId).first() as any;
  if (likedObj) {
    const notifId = generateId();
    await c.env.DB.prepare(`
      INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type, object_ap_id)
      VALUES (?, ?, ?, 'like', ?)
    `).bind(notifId, likedObj.attributed_to, actor, objectId).run();
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

  // If it's a reply, update reply count
  if (object.inReplyTo) {
    await c.env.DB.prepare('UPDATE objects SET reply_count = reply_count + 1 WHERE ap_id = ?')
      .bind(object.inReplyTo).run();

    // Create notification for reply
    const parentObj = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?')
      .bind(object.inReplyTo).first() as any;
    if (parentObj) {
      const notifId = generateId();
      await c.env.DB.prepare(`
        INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type, object_ap_id)
        VALUES (?, ?, ?, 'reply', ?)
      `).bind(notifId, parentObj.attributed_to, actor, objectId).run();
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

  console.log('Stored remote story:', objectId);

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
