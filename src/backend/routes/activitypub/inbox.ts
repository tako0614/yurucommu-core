import { Hono } from 'hono';
import type { Env, Variables, Actor } from '../../types';
import { activityApId, actorApId, generateId, isLocal, isSafeRemoteUrl } from '../../utils';
import { getInstanceActor } from './utils';
import type { Activity, RemoteActor } from './inbox-types';
import { getActivityObjectId } from './inbox-types';
import { handleGroupCreate, handleGroupFollow, handleGroupUndo } from './handlers/actorInboxHandlers';
import {
  handleAccept,
  handleAnnounce,
  handleCreate,
  handleDelete,
  handleFollow,
  handleLike,
  handleReject,
  handleUndo,
  handleUpdate,
} from './handlers/userInboxHandlers';

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

ap.post('/ap/actor/inbox', async (c) => {
  const instanceActor = await getInstanceActor(c);
  const baseUrl = c.env.APP_URL;

  let activity: Activity;
  try {
    activity = await c.req.json<Activity>();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const activityId = typeof activity.id === 'string' ? activity.id : activityApId(baseUrl, generateId());
  const actor = typeof activity.actor === 'string' ? activity.actor : null;
  const activityType = typeof activity.type === 'string' ? activity.type : null;
  const activityObjectId = getActivityObjectId(activity);

  if (!actor || !activityType) {
    return c.json({ error: 'Invalid activity' }, 400);
  }

  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
    VALUES (?, ?, ?, ?, ?, 'inbound')
  `).bind(activityId, activityType, actor, activityObjectId, JSON.stringify(activity)).run();

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

  let activity: Activity;
  try {
    activity = await c.req.json<Activity>();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const activityId = typeof activity.id === 'string' ? activity.id : activityApId(baseUrl, generateId());
  const actor = typeof activity.actor === 'string' ? activity.actor : null;
  const activityType = typeof activity.type === 'string' ? activity.type : null;
  const activityObjectId = getActivityObjectId(activity);

  if (!actor || !activityType) {
    return c.json({ error: 'Invalid activity' }, 400);
  }

  // Store activity
  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
    VALUES (?, ?, ?, ?, ?, 'inbound')
  `).bind(activityId, activityType, actor, activityObjectId, JSON.stringify(activity)).run();

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
            const actorData = await res.json() as RemoteActor;
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

export default ap;
