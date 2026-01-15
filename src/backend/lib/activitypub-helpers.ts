// ActivityPub helper functions for Yurucommu
// Provides utilities for delivering activities to followers

import type { Env, Actor } from '../types';
import { generateId, activityApId, isLocal, signRequest } from '../utils';

// Story data from database after transformation
interface StoryData {
  ap_id: string;
  attributed_to: string;
  attachment: {
    type: string;
    mediaType: string;
    url: string;
    r2_key: string;
  };
  displayDuration: string;
  overlays?: any[];
  end_time: string;
  published: string;
}

/**
 * Convert a Story to ActivityPub format
 */
export function storyToActivityPub(story: StoryData, actor: Actor, baseUrl: string): object {
  // Build full attachment URL
  const attachmentUrl = story.attachment.url.startsWith('http')
    ? story.attachment.url
    : `${baseUrl}${story.attachment.url}`;

  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      {
        'story': 'https://yurucommu.com/ns/story#',
        'Story': 'story:Story',
        'displayDuration': 'story:displayDuration',
        'overlays': { '@id': 'story:overlays', '@container': '@list' },
        'position': 'story:position'
      }
    ],
    'id': story.ap_id,
    'type': ['Story', 'Note'],
    'attributedTo': actor.ap_id,
    'published': story.published,
    'endTime': story.end_time,
    'to': [`${actor.ap_id}/followers`],
    'attachment': [{
      'type': story.attachment.type,
      'mediaType': story.attachment.mediaType,
      'url': attachmentUrl,
    }],
    'displayDuration': story.displayDuration,
    ...(story.overlays && story.overlays.length > 0 ? { 'overlays': story.overlays } : {}),
  };
}

/**
 * Deliver an activity to all followers of an actor
 */
export async function deliverToFollowers(
  activity: object,
  actor: Actor,
  env: Env
): Promise<void> {
  const baseUrl = env.APP_URL;

  // Get all accepted followers
  const followers = await env.DB.prepare(`
    SELECT DISTINCT f.follower_ap_id
    FROM follows f
    WHERE f.following_ap_id = ? AND f.status = 'accepted'
  `).bind(actor.ap_id).all();

  // Filter to remote followers only
  const remoteFollowers = (followers.results || []).filter(
    (f: any) => !isLocal(f.follower_ap_id, baseUrl)
  );

  // Deliver to each remote follower's inbox
  for (const follower of remoteFollowers) {
    try {
      const cachedActor = await env.DB.prepare(
        'SELECT inbox FROM actor_cache WHERE ap_id = ?'
      ).bind(follower.follower_ap_id).first<{ inbox: string }>();

      if (cachedActor?.inbox) {
        const keyId = `${actor.ap_id}#main-key`;
        const body = JSON.stringify(activity);
        const headers = await signRequest(actor.private_key_pem, keyId, 'POST', cachedActor.inbox, body);

        await fetch(cachedActor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body,
        });
      }
    } catch (e) {
      console.error(`Failed to deliver to ${follower.follower_ap_id}:`, e);
    }
  }
}

/**
 * Send Create(Story) activity to followers
 */
export async function sendCreateStoryActivity(
  story: StoryData,
  actor: Actor,
  env: Env
): Promise<void> {
  const baseUrl = env.APP_URL;
  const storyObject = storyToActivityPub(story, actor, baseUrl);

  const activityId = activityApId(baseUrl, generateId());
  const activity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    'id': activityId,
    'type': 'Create',
    'actor': actor.ap_id,
    'published': story.published,
    'to': [`${actor.ap_id}/followers`],
    'object': storyObject,
  };

  // Deliver to followers
  await deliverToFollowers(activity, actor, env);

  // Store outbound activity
  await env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
    VALUES (?, 'Create', ?, ?, ?, 'outbound')
  `).bind(activityId, actor.ap_id, story.ap_id, JSON.stringify(activity)).run();
}

/**
 * Send Delete(Story) activity to followers
 */
export async function sendDeleteStoryActivity(
  storyApId: string,
  actor: Actor,
  env: Env
): Promise<void> {
  const baseUrl = env.APP_URL;
  const activityId = activityApId(baseUrl, generateId());

  const activity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    'id': activityId,
    'type': 'Delete',
    'actor': actor.ap_id,
    'to': ['https://www.w3.org/ns/activitystreams#Public'],
    'object': storyApId,
  };

  // Deliver to followers
  await deliverToFollowers(activity, actor, env);

  // Store outbound activity
  await env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
    VALUES (?, 'Delete', ?, ?, ?, 'outbound')
  `).bind(activityId, actor.ap_id, storyApId, JSON.stringify(activity)).run();
}
