import { Hono } from 'hono';
import type { Env, Variables, ActorCache } from '../types';
import { generateId, activityApId, isLocal, formatUsername, signRequest } from '../utils';

const follow = new Hono<{ Bindings: Env; Variables: Variables }>();

// Follow an actor (handles local and remote)
follow.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ target_ap_id: string }>();
  if (!body.target_ap_id) return c.json({ error: 'target_ap_id required' }, 400);
  if (body.target_ap_id === actor.ap_id) return c.json({ error: 'Cannot follow yourself' }, 400);

  const baseUrl = c.env.APP_URL;
  const targetApId = body.target_ap_id;

  // Check if already following
  const existing = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?'
  ).bind(actor.ap_id, targetApId).first();

  if (existing) return c.json({ error: 'Already following or pending' }, 400);

  // Check if target is local or remote
  const isLocalTarget = isLocal(targetApId, baseUrl);

  if (isLocalTarget) {
    // Local target - check if they require approval
    const target = await c.env.DB.prepare('SELECT is_private FROM actors WHERE ap_id = ?').bind(targetApId).first<any>();
    if (!target) return c.json({ error: 'Target actor not found' }, 404);

    const status = target.is_private ? 'pending' : 'accepted';
    const activityId = activityApId(baseUrl, generateId());

    await c.env.DB.prepare(`
      INSERT INTO follows (follower_ap_id, following_ap_id, status, activity_ap_id, accepted_at)
      VALUES (?, ?, ?, ?, ${status === 'accepted' ? "datetime('now')" : 'NULL'})
    `).bind(actor.ap_id, targetApId, status, activityId).run();

    // Update counts if accepted
    if (status === 'accepted') {
      await c.env.DB.prepare('UPDATE actors SET following_count = following_count + 1 WHERE ap_id = ?').bind(actor.ap_id).run();
      await c.env.DB.prepare('UPDATE actors SET follower_count = follower_count + 1 WHERE ap_id = ?').bind(targetApId).run();

      // Add to dm_contacts (follower can now message the followed user)
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO dm_contacts (owner_ap_id, contact_ap_id, added_reason)
        VALUES (?, ?, 'follow')
      `).bind(actor.ap_id, targetApId).run();
    }

    // Create notification
    const notifId = generateId();
    await c.env.DB.prepare(`
      INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type)
      VALUES (?, ?, ?, ?)
    `).bind(notifId, targetApId, actor.ap_id, status === 'pending' ? 'follow_request' : 'follow').run();

    return c.json({ success: true, status });
  } else {
    // Remote target - send Follow activity
    // First, ensure we have cached the remote actor
    let cachedActor = await c.env.DB.prepare('SELECT * FROM actor_cache WHERE ap_id = ?').bind(targetApId).first<ActorCache>();

    if (!cachedActor) {
      // Fetch remote actor
      try {
        const res = await fetch(targetApId, {
          headers: { 'Accept': 'application/activity+json, application/ld+json' }
        });
        if (!res.ok) return c.json({ error: 'Could not fetch remote actor' }, 400);

        const actorData = await res.json() as any;
        await c.env.DB.prepare(`
          INSERT INTO actor_cache (ap_id, type, preferred_username, name, summary, icon_url, inbox, outbox, public_key_id, public_key_pem, raw_json)
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

        cachedActor = await c.env.DB.prepare('SELECT * FROM actor_cache WHERE ap_id = ?').bind(targetApId).first<ActorCache>();
      } catch (e) {
        return c.json({ error: 'Failed to fetch remote actor' }, 400);
      }
    }

    // Create pending follow
    const activityId = activityApId(baseUrl, generateId());
    await c.env.DB.prepare(`
      INSERT INTO follows (follower_ap_id, following_ap_id, status, activity_ap_id)
      VALUES (?, ?, 'pending', ?)
    `).bind(actor.ap_id, targetApId, activityId).run();

    // Send Follow activity
    const followActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityId,
      type: 'Follow',
      actor: actor.ap_id,
      object: targetApId,
    };

    const keyId = `${actor.ap_id}#main-key`;
    const headers = await signRequest(actor.private_key_pem, keyId, 'POST', cachedActor!.inbox, JSON.stringify(followActivity));

    try {
      await fetch(cachedActor!.inbox, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/activity+json',
        },
        body: JSON.stringify(followActivity),
      });
    } catch (e) {
      console.error('Failed to send Follow activity:', e);
    }

    // Store activity
    await c.env.DB.prepare(`
      INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
      VALUES (?, 'Follow', ?, ?, ?, 'outbound')
    `).bind(activityId, actor.ap_id, targetApId, JSON.stringify(followActivity)).run();

    return c.json({ success: true, status: 'pending' });
  }
});

// Unfollow
follow.delete('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ target_ap_id: string }>();
  if (!body.target_ap_id) return c.json({ error: 'target_ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const targetApId = body.target_ap_id;

  const existingFollow = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?'
  ).bind(actor.ap_id, targetApId).first<any>();

  if (!existingFollow) return c.json({ error: 'Not following' }, 400);

  // Delete the follow
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?')
    .bind(actor.ap_id, targetApId).run();

  // Update counts if was accepted
  if (existingFollow.status === 'accepted') {
    await c.env.DB.prepare('UPDATE actors SET following_count = following_count - 1 WHERE ap_id = ? AND following_count > 0')
      .bind(actor.ap_id).run();

    if (isLocal(targetApId, baseUrl)) {
      await c.env.DB.prepare('UPDATE actors SET follower_count = follower_count - 1 WHERE ap_id = ? AND follower_count > 0')
        .bind(targetApId).run();
    }
  }

  // Send Undo Follow to remote
  if (!isLocal(targetApId, baseUrl)) {
    const cachedActor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(targetApId).first<any>();
    if (cachedActor?.inbox) {
      const activityId = activityApId(baseUrl, generateId());
      const undoActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: activityId,
        type: 'Undo',
        actor: actor.ap_id,
        object: {
          type: 'Follow',
          actor: actor.ap_id,
          object: targetApId,
        },
      };

      const keyId = `${actor.ap_id}#main-key`;
      const headers = await signRequest(actor.private_key_pem, keyId, 'POST', cachedActor.inbox, JSON.stringify(undoActivity));

      try {
        await fetch(cachedActor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body: JSON.stringify(undoActivity),
        });
      } catch (e) {
        console.error('Failed to send Undo Follow:', e);
      }

      // Store activity
      await c.env.DB.prepare(`
        INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
        VALUES (?, 'Undo', ?, ?, ?, 'outbound')
      `).bind(activityId, actor.ap_id, targetApId, JSON.stringify(undoActivity)).run();
    }
  }

  return c.json({ success: true });
});

// Accept follow request
follow.post('/accept', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ requester_ap_id: string }>();
  if (!body.requester_ap_id) return c.json({ error: 'requester_ap_id required' }, 400);

  const pendingFollow = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE follower_ap_id = ? AND following_ap_id = ? AND status = ?'
  ).bind(body.requester_ap_id, actor.ap_id, 'pending').first<any>();

  if (!pendingFollow) return c.json({ error: 'No pending follow request' }, 404);

  await c.env.DB.prepare(`
    UPDATE follows SET status = 'accepted', accepted_at = datetime('now')
    WHERE follower_ap_id = ? AND following_ap_id = ?
  `).bind(body.requester_ap_id, actor.ap_id).run();

  // Update counts
  await c.env.DB.prepare('UPDATE actors SET follower_count = follower_count + 1 WHERE ap_id = ?').bind(actor.ap_id).run();
  if (isLocal(body.requester_ap_id, c.env.APP_URL)) {
    await c.env.DB.prepare('UPDATE actors SET following_count = following_count + 1 WHERE ap_id = ?').bind(body.requester_ap_id).run();

    // Add to dm_contacts (the requester can now message this actor)
    await c.env.DB.prepare(`
      INSERT OR IGNORE INTO dm_contacts (owner_ap_id, contact_ap_id, added_reason)
      VALUES (?, ?, 'follow')
    `).bind(body.requester_ap_id, actor.ap_id).run();
  }

  // Update notification
  await c.env.DB.prepare(`
    UPDATE notifications SET type = 'follow' WHERE recipient_ap_id = ? AND actor_ap_id = ? AND type = 'follow_request'
  `).bind(actor.ap_id, body.requester_ap_id).run();

  // Send Accept to remote
  if (!isLocal(body.requester_ap_id, c.env.APP_URL)) {
    const cachedActor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(body.requester_ap_id).first<any>();
    if (cachedActor?.inbox) {
      const baseUrl = c.env.APP_URL;
      const activityId = activityApId(baseUrl, generateId());
      const acceptActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: activityId,
        type: 'Accept',
        actor: actor.ap_id,
        object: pendingFollow.activity_ap_id,
      };

      const keyId = `${actor.ap_id}#main-key`;
      const headers = await signRequest(actor.private_key_pem, keyId, 'POST', cachedActor.inbox, JSON.stringify(acceptActivity));

      try {
        await fetch(cachedActor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body: JSON.stringify(acceptActivity),
        });
      } catch (e) {
        console.error('Failed to send Accept:', e);
      }

      // Store activity
      await c.env.DB.prepare(`
        INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
        VALUES (?, 'Accept', ?, ?, ?, 'outbound')
      `).bind(activityId, actor.ap_id, pendingFollow.activity_ap_id, JSON.stringify(acceptActivity)).run();
    }
  }

  return c.json({ success: true });
});

// Get pending follow requests
follow.get('/requests', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const requests = await c.env.DB.prepare(`
    SELECT f.follower_ap_id, f.created_at,
           COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
           COALESCE(a.name, ac.name) as name,
           COALESCE(a.icon_url, ac.icon_url) as icon_url
    FROM follows f
    LEFT JOIN actors a ON f.follower_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON f.follower_ap_id = ac.ap_id
    WHERE f.following_ap_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).bind(actor.ap_id).all();

  const result = (requests.results || []).map((r: any) => ({
    ap_id: r.follower_ap_id,
    username: formatUsername(r.follower_ap_id),
    preferred_username: r.preferred_username,
    name: r.name,
    icon_url: r.icon_url,
    created_at: r.created_at,
  }));

  return c.json({ requests: result });
});

export default follow;
