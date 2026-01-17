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
  ActorCacheInboxRow,
  CommunityRow,
  InstanceActor,
  RemoteActor,
  getActivityObject,
  getActivityObjectId,
} from '../inbox-types';

async function fetchRemoteInbox(c: ActivityContext, actorApId: string): Promise<string | null> {
  const cached = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?')
    .bind(actorApId).first<ActorCacheInboxRow>();
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
    const actorData = await res.json() as RemoteActor;
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

export async function handleGroupFollow(
  c: ActivityContext,
  activity: Activity,
  instanceActor: InstanceActor,
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
    const headers = await signRequest(
      instanceActor.private_key_pem,
      keyId,
      'POST',
      inboxUrl,
      JSON.stringify(responseActivity)
    );

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

export async function handleGroupUndo(
  c: ActivityContext,
  activity: Activity,
  instanceActor: InstanceActor
) {
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  const follow = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE activity_ap_id = ? AND following_ap_id = ?'
  ).bind(objectId, instanceActor.ap_id).first();

  if (follow) {
    await c.env.DB.prepare('DELETE FROM follows WHERE activity_ap_id = ? AND following_ap_id = ?')
      .bind(objectId, instanceActor.ap_id).run();
    return;
  }

  if (getActivityObject(activity)?.type === 'Follow') {
    await c.env.DB.prepare('DELETE FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?')
      .bind(activity.actor, instanceActor.ap_id).run();
  }
}

export async function handleGroupCreate(
  c: ActivityContext,
  activity: Activity,
  instanceActor: InstanceActor,
  actorApId: string,
  baseUrl: string
) {
  const object = getActivityObject(activity);
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
  `).bind(roomId, roomId).first<CommunityRow>();
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

