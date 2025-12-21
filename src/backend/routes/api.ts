import { Hono } from 'hono';
import type { Env, LocalUser, Post } from '../types';
import { generateKeyPair } from '../services/activitypub/http-signatures';
import { queueDelivery, fetchRemoteActor } from '../services/activitypub/activities';
import { getConfig, getTenantConfig, getRules, evaluateRules, isFederationAllowed } from '../services/config';

type Variables = {
  user: LocalUser;
  hostname: string;
};

const api = new Hono<{ Bindings: Env; Variables: Variables }>();

function generateId(): string {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getHostname(c: any): string {
  return c.env?.HOSTNAME || new URL(c.req.url).host;
}

function parseDate(value: string | null | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getDomainFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getRemoteAuthor(actorUrl: string, actor: any | null) {
  const hostname = (() => {
    try {
      return new URL(actorUrl).hostname;
    } catch {
      return '';
    }
  })();
  const preferredUsername = actor?.preferredUsername || 'remote';
  const username = hostname ? `${preferredUsername}@${hostname}` : preferredUsername;
  return {
    username,
    display_name: actor?.name || preferredUsername,
    avatar_url: actor?.icon?.url || null,
    actor_url: actorUrl,
  };
}

// Initialize local user (first-time setup)
api.post('/setup', async (c) => {
  // Check if already initialized
  const existingUser = await c.env.DB.prepare(
    `SELECT * FROM local_users LIMIT 1`
  ).first<LocalUser>();

  if (existingUser) {
    return c.json({ error: 'Already initialized' }, 400);
  }

  const body = await c.req.json<{
    username: string;
    display_name: string;
    summary?: string;
  }>();

  if (!body.username || !body.display_name) {
    return c.json({ error: 'username and display_name required' }, 400);
  }

  // Validate username
  if (!/^[a-zA-Z0-9_]+$/.test(body.username)) {
    return c.json({ error: 'Invalid username format' }, 400);
  }

  const { privateKey, publicKey } = await generateKeyPair();
  const userId = generateId();

  await c.env.DB.prepare(
    `INSERT INTO local_users (id, username, display_name, summary, public_key, private_key)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    userId,
    body.username,
    body.display_name,
    body.summary || '',
    publicKey,
    privateKey
  ).run();

  const user = await c.env.DB.prepare(
    `SELECT id, username, display_name, summary, avatar_url, header_url, created_at FROM local_users WHERE id = ?`
  ).bind(userId).first();

  return c.json(user, 201);
});

// Get current user
api.get('/me', async (c) => {
  const user = c.get('user');
  return c.json({
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    summary: user.summary,
    avatar_url: user.avatar_url,
    header_url: user.header_url,
  });
});

// Get tenant configuration (L1)
api.get('/config', async (c) => {
  const l1 = await getConfig(c.env);
  return c.json(l1);
});

// Update profile
api.patch('/me', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    display_name?: string;
    summary?: string;
  }>();

  const updates: string[] = [];
  const params: any[] = [];

  if (body.display_name !== undefined) {
    updates.push('display_name = ?');
    params.push(body.display_name);
  }
  if (body.summary !== undefined) {
    updates.push('summary = ?');
    params.push(body.summary);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No updates provided' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(user.id);

  await c.env.DB.prepare(
    `UPDATE local_users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  const updatedUser = await c.env.DB.prepare(
    `SELECT id, username, display_name, summary, avatar_url, header_url FROM local_users WHERE id = ?`
  ).bind(user.id).first();

  return c.json(updatedUser);
});

// Create post
api.post('/posts', async (c) => {
  const user = c.get('user');
  const hostname = getHostname(c);
  const body = await c.req.json<{
    content: string;
    content_warning?: string;
    visibility?: 'public' | 'unlisted' | 'followers' | 'direct';
    in_reply_to_id?: string;
  }>();

  if (!body.content) {
    return c.json({ error: 'content required' }, 400);
  }

  const [config, rules] = await Promise.all([
    getTenantConfig(c.env),
    getRules(c.env),
  ]);

  const trimmedContent = body.content.trim();
  if (trimmedContent.length === 0) {
    return c.json({ error: 'content required' }, 400);
  }

  const warningText = typeof body.content_warning === 'string' ? body.content_warning.trim() : '';
  const contentWarning = warningText.length > 0 ? warningText : null;

  if (trimmedContent.length > config.content.maxPostLength) {
    return c.json({ error: `content must be ${config.content.maxPostLength} characters or less` }, 400);
  }

  if (body.in_reply_to_id && !config.features.enableReplies) {
    return c.json({ error: 'Replies are disabled' }, 403);
  }

  const visibility = body.visibility || config.defaultVisibility;
  const validVisibilities = ['public', 'unlisted', 'followers', 'direct'];
  if (!validVisibilities.includes(visibility)) {
    return c.json({ error: 'Invalid visibility' }, 400);
  }

  const ruleResult = evaluateRules(rules, {
    content: trimmedContent,
    actor: `https://${hostname}/users/${user.username}`,
    domain: hostname,
  });

  if (ruleResult.action === 'reject' || ruleResult.action === 'silence') {
    return c.json({
      error: 'content rejected by rules',
      message: ruleResult.message || undefined,
    }, 400);
  }

  const postId = generateId();
  const publishedAt = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO posts (id, user_id, content, content_warning, visibility, in_reply_to_id, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    postId,
    user.id,
    trimmedContent,
    contentWarning,
    visibility,
    body.in_reply_to_id || null,
    publishedAt
  ).run();

  const post = await c.env.DB.prepare(
    `SELECT * FROM posts WHERE id = ?`
  ).bind(postId).first<Post>();

  // Federate to followers if not direct
  if (visibility !== 'direct') {
    const actorUrl = `https://${hostname}/users/${user.username}`;
    const postUrl = `https://${hostname}/posts/${postId}`;
    const followersUrl = `${actorUrl}/followers`;
    const to =
      visibility === 'public'
        ? ['https://www.w3.org/ns/activitystreams#Public']
        : visibility === 'followers'
          ? [followersUrl]
          : [];
    const cc =
      visibility === 'public' || visibility === 'unlisted'
        ? [followersUrl]
        : [];

    // Build Create activity
    const createActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${postUrl}/activity`,
      type: 'Create',
      actor: actorUrl,
      published: publishedAt,
      to,
      cc,
      object: {
        id: postUrl,
        type: 'Note',
        content: trimmedContent,
        summary: contentWarning,
        published: publishedAt,
        attributedTo: actorUrl,
        to,
        cc,
      },
    };

    // Get all followers' inboxes
    const followers = await c.env.DB.prepare(`
      SELECT DISTINCT ra.actor_url, ra.inbox, ra.shared_inbox
      FROM follows f
      JOIN remote_actors ra ON f.follower_actor = ra.actor_url
      WHERE f.following_actor = ? AND f.status = 'accepted'
    `).bind(actorUrl).all<{ actor_url: string; inbox: string; shared_inbox: string | null }>();

    // Use shared inbox when available to reduce requests
    const inboxes = new Set<string>();
    for (const follower of followers.results) {
      const domain = getDomainFromUrl(follower.actor_url);
      if (!domain || !isFederationAllowed(config, domain)) {
        continue;
      }
      inboxes.add(follower.shared_inbox || follower.inbox);
    }

    // Queue delivery to each inbox
    for (const inbox of inboxes) {
      await queueDelivery(c.env, createActivity, inbox, user);
    }
  }

  if (ruleResult.action === 'warn') {
    console.warn('Content matched warning rule:', ruleResult.message || 'warn');
  }

  return c.json(post, 201);
});

// Get posts
api.get('/posts', async (c) => {
  const user = c.get('user');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const beforeId = c.req.query('before');

  let query = `SELECT * FROM posts WHERE user_id = ?`;
  const params: any[] = [user.id];

  if (beforeId) {
    query += ` AND id < ?`;
    params.push(beforeId);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all<Post>();

  return c.json(posts.results);
});

// Get single post
api.get('/posts/:id', async (c) => {
  const postId = c.req.param('id');

  const post = await c.env.DB.prepare(
    `SELECT * FROM posts WHERE id = ?`
  ).bind(postId).first<Post>();

  if (!post) {
    return c.json({ error: 'Post not found' }, 404);
  }

  return c.json(post);
});

// Delete post
api.delete('/posts/:id', async (c) => {
  const user = c.get('user');
  const postId = c.req.param('id');

  const post = await c.env.DB.prepare(
    `SELECT * FROM posts WHERE id = ? AND user_id = ?`
  ).bind(postId, user.id).first<Post>();

  if (!post) {
    return c.json({ error: 'Post not found' }, 404);
  }

  await c.env.DB.prepare(
    `DELETE FROM posts WHERE id = ?`
  ).bind(postId).run();

  return c.json({ success: true });
});

// Timeline (home)
api.get('/timeline/home', async (c) => {
  const user = c.get('user');
  const hostname = getHostname(c);
  const localActorUrl = `https://${hostname}/users/${user.username}`;
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const maxFollowing = 200;

  const [localPosts, following, config, rules] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM posts WHERE user_id = ? ORDER BY published_at DESC LIMIT ?`
    ).bind(user.id, limit).all<Post>(),
    c.env.DB.prepare(
      `SELECT following_actor FROM follows
       WHERE follower_actor = ? AND status = 'accepted'
       ORDER BY created_at DESC
       LIMIT ?`
    ).bind(localActorUrl, maxFollowing).all<{ following_actor: string }>(),
    getTenantConfig(c.env),
    getRules(c.env),
  ]);
  const allowedMediaTypes = new Set(
    config.content.allowedMediaTypes.map((mediaType) => mediaType.toLowerCase())
  );

  const timeline: Array<{
    id: string;
    content: string;
    content_warning: string | null;
    visibility: string;
    published_at: string;
    sort_key: number;
    attachments?: Array<{
      url: string;
      mediaType: string | null;
      name: string | null;
    }>;
    author?: {
      username: string;
      display_name: string;
      avatar_url: string | null;
      actor_url?: string;
    };
  }> = localPosts.results.map((post) => ({
    id: post.id,
    content: post.content,
    content_warning: post.content_warning,
    visibility: post.visibility,
    published_at: post.published_at,
    sort_key: parseDate(post.published_at),
    author: {
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      actor_url: localActorUrl,
    },
  }));

  const followingActors = following.results
    .map(row => row.following_actor)
    .filter((actorUrl) => {
      const domain = getDomainFromUrl(actorUrl);
      return domain ? isFederationAllowed(config, domain) : false;
    });
  if (followingActors.length > 0) {
    const placeholders = followingActors.map(() => '?').join(', ');
    const remoteRows = await c.env.DB.prepare(
      `SELECT id, actor_url, activity_json, received_at
       FROM inbox_queue
       WHERE activity_type = 'Create'
         AND processed_at IS NOT NULL
         AND error IS NULL
         AND actor_url IN (${placeholders})
       ORDER BY received_at DESC
       LIMIT ?`
    ).bind(...followingActors, limit).all<{
      id: string;
      actor_url: string;
      activity_json: string;
      received_at: string;
    }>();

    const remoteActorUrls = Array.from(new Set(remoteRows.results.map(row => row.actor_url)));
    const remoteActors = new Map<string, any>();
    if (remoteActorUrls.length > 0) {
      const actorPlaceholders = remoteActorUrls.map(() => '?').join(', ');
      const actorRows = await c.env.DB.prepare(
        `SELECT actor_url, actor_json FROM remote_actors WHERE actor_url IN (${actorPlaceholders})`
      ).bind(...remoteActorUrls).all<{ actor_url: string; actor_json: string }>();

      for (const row of actorRows.results) {
        try {
          remoteActors.set(row.actor_url, JSON.parse(row.actor_json));
        } catch {
          remoteActors.set(row.actor_url, null);
        }
      }
    }

    for (const row of remoteRows.results) {
      let activity: any;
      try {
        activity = JSON.parse(row.activity_json);
      } catch {
        continue;
      }

      const object = activity?.object || {};
      const content = typeof object.content === 'string' ? object.content : '';
      const actorUrl =
        row.actor_url ||
        (typeof activity.actor === 'string'
          ? activity.actor
          : typeof activity.actor?.id === 'string'
            ? activity.actor.id
            : null);
      const actorDomain = actorUrl ? getDomainFromUrl(actorUrl) : null;
      const attachments = Array.isArray(object.attachment)
        ? object.attachment
        : object.attachment
          ? [object.attachment]
          : [];
      const attachmentMediaTypes = attachments
        .map((item: any) => (typeof item?.mediaType === 'string' ? item.mediaType : null))
        .filter((value): value is string => !!value);
      const ruleResult = evaluateRules(rules, {
        content,
        actor: actorUrl || undefined,
        domain: actorDomain || undefined,
        mediaType:
          typeof object.mediaType === 'string'
            ? object.mediaType
            : attachmentMediaTypes[0],
        language: typeof object.language === 'string' ? object.language : undefined,
      });

      if (ruleResult.action === 'reject' || ruleResult.action === 'silence') {
        continue;
      }
      const normalizedAttachments = attachments.flatMap((item: any) => {
        if (!item) return [];
        let urls: string[] = [];
        if (typeof item === 'string') {
          urls = [item];
        } else if (Array.isArray(item.url)) {
          urls = item.url
            .map((urlItem: any) => {
              if (typeof urlItem === 'string') return urlItem;
              if (typeof urlItem?.href === 'string') return urlItem.href;
              return null;
            })
            .filter((entry): entry is string => !!entry);
        } else if (typeof item.url === 'string') {
          urls = [item.url];
        } else if (typeof item.url?.href === 'string') {
          urls = [item.url.href];
        }

        return urls.flatMap((url) => {
          try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              return [];
            }
          } catch {
            return [];
          }
          return [{
            url,
            mediaType: typeof item.mediaType === 'string' ? item.mediaType : null,
            name: typeof item.name === 'string' ? item.name : null,
          }];
        });
      });
      const seenAttachments = new Set<string>();
      const dedupedAttachments = normalizedAttachments.filter((attachment) => {
        if (seenAttachments.has(attachment.url)) return false;
        seenAttachments.add(attachment.url);
        return true;
      });
      const filteredAttachments = dedupedAttachments.filter((attachment) => {
        if (!attachment.mediaType) return true;
        return allowedMediaTypes.has(attachment.mediaType.toLowerCase());
      });
      if (!content && filteredAttachments.length === 0) continue;
      if (filteredAttachments.length > config.content.maxMediaAttachments) {
        filteredAttachments.splice(config.content.maxMediaAttachments);
      }

      const publishedAt = typeof object.published === 'string'
        ? object.published
        : typeof activity.published === 'string'
          ? activity.published
          : row.received_at;
      const publishedTs = parseDate(publishedAt);
      const sortKey = publishedTs > 0 ? publishedTs : parseDate(row.received_at);

      const contentWarning = typeof object.summary === 'string' ? object.summary : null;
      const actor = actorUrl ? remoteActors.get(actorUrl) || null : null;

      timeline.push({
        id: object.id || row.id,
        content,
        content_warning: contentWarning,
        visibility: 'public',
        published_at: publishedAt,
        sort_key: sortKey,
        attachments: filteredAttachments.length > 0 ? filteredAttachments : undefined,
        author: actorUrl ? getRemoteAuthor(actorUrl, actor) : undefined,
      });
    }
  }

  timeline.sort((a, b) => b.sort_key - a.sort_key);
  return c.json(timeline.slice(0, limit).map(({ sort_key, ...rest }) => rest));
});

// Follow a remote account
api.post('/follow', async (c) => {
  const user = c.get('user');
  const hostname = getHostname(c);
  const body = await c.req.json<{ account: string }>();
  const config = await getTenantConfig(c.env);

  if (!body.account) {
    return c.json({ error: 'account required' }, 400);
  }

  // Parse account (could be @user@domain or URL)
  let targetActorUrl: string;

  if (body.account.startsWith('https://')) {
    targetActorUrl = body.account;
    const urlDomain = getDomainFromUrl(targetActorUrl);
    if (!urlDomain) {
      return c.json({ error: 'Invalid account URL' }, 400);
    }
    if (!isFederationAllowed(config, urlDomain)) {
      return c.json({ error: 'Federation not allowed for this domain' }, 403);
    }
  } else {
    // Parse @user@domain format
    const match = body.account.match(/^@?([^@]+)@(.+)$/);
    if (!match) {
      return c.json({ error: 'Invalid account format' }, 400);
    }
    const [, username, domain] = match;

    if (!isFederationAllowed(config, domain)) {
      return c.json({ error: 'Federation not allowed for this domain' }, 403);
    }

    // Lookup via WebFinger
    try {
      const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=acct:${username}@${domain}`;
      const wfResponse = await fetch(webfingerUrl, {
        headers: { 'Accept': 'application/jrd+json' },
      });

      if (!wfResponse.ok) {
        return c.json({ error: 'Account not found' }, 404);
      }

      const wfData = await wfResponse.json() as any;
      const selfLink = wfData.links?.find((l: any) =>
        l.rel === 'self' && l.type === 'application/activity+json'
      );

      if (!selfLink?.href) {
        return c.json({ error: 'Could not find actor URL' }, 404);
      }

      targetActorUrl = selfLink.href;
    } catch {
      return c.json({ error: 'WebFinger lookup failed' }, 500);
    }
  }

  // Fetch the target actor
  const targetActor = await fetchRemoteActor(c.env, targetActorUrl);
  if (!targetActor) {
    return c.json({ error: 'Could not fetch actor' }, 404);
  }

  const targetDomain = getDomainFromUrl(targetActorUrl);
  if (!targetDomain) {
    return c.json({ error: 'Invalid actor URL' }, 400);
  }
  if (!isFederationAllowed(config, targetDomain)) {
    return c.json({ error: 'Federation not allowed for this domain' }, 403);
  }

  const localActorUrl = `https://${hostname}/users/${user.username}`;

  // Check if already following
  const existing = await c.env.DB.prepare(`
    SELECT * FROM follows WHERE follower_actor = ? AND following_actor = ?
  `).bind(localActorUrl, targetActorUrl).first();

  if (existing) {
    return c.json({ error: 'Already following' }, 400);
  }

  // Create follow record
  const followId = generateId();
  await c.env.DB.prepare(`
    INSERT INTO follows (id, follower_actor, following_actor, status)
    VALUES (?, ?, ?, 'pending')
  `).bind(followId, localActorUrl, targetActorUrl).run();

  // Send Follow activity
  const followActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `https://${hostname}/activities/${followId}`,
    type: 'Follow',
    actor: localActorUrl,
    object: targetActorUrl,
  };

  await queueDelivery(c.env, followActivity, targetActor.inbox, user);

  return c.json({ success: true, status: 'pending' });
});

// Unfollow an account
api.post('/unfollow', async (c) => {
  const user = c.get('user');
  const hostname = getHostname(c);
  const body = await c.req.json<{ actor_url: string }>();

  if (!body.actor_url) {
    return c.json({ error: 'actor_url required' }, 400);
  }

  const localActorUrl = `https://${hostname}/users/${user.username}`;

  const follow = await c.env.DB.prepare(`
    SELECT * FROM follows WHERE follower_actor = ? AND following_actor = ?
  `).bind(localActorUrl, body.actor_url).first<{ id: string }>();

  if (!follow) {
    return c.json({ error: 'Not following' }, 400);
  }

  // Delete the follow
  await c.env.DB.prepare(`
    DELETE FROM follows WHERE id = ?
  `).bind(follow.id).run();

  // Send Undo Follow activity
  const targetActor = await fetchRemoteActor(c.env, body.actor_url);
  if (targetActor) {
    const undoActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${hostname}/activities/${generateId()}`,
      type: 'Undo',
      actor: localActorUrl,
      object: {
        id: `https://${hostname}/activities/${follow.id}`,
        type: 'Follow',
        actor: localActorUrl,
        object: body.actor_url,
      },
    };

    await queueDelivery(c.env, undoActivity, targetActor.inbox, user);
  }

  return c.json({ success: true });
});

// Get following list
api.get('/following', async (c) => {
  const user = c.get('user');
  const hostname = getHostname(c);
  const localActorUrl = `https://${hostname}/users/${user.username}`;

  const following = await c.env.DB.prepare(`
    SELECT f.id, f.following_actor, f.status, ra.actor_json
    FROM follows f
    LEFT JOIN remote_actors ra ON f.following_actor = ra.actor_url
    WHERE f.follower_actor = ?
    ORDER BY f.created_at DESC
  `).bind(localActorUrl).all<{ id: string; following_actor: string; status: string; actor_json: string | null }>();

  const results = following.results.map(f => ({
    id: f.id,
    actor_url: f.following_actor,
    status: f.status,
    actor: f.actor_json ? JSON.parse(f.actor_json) : null,
  }));

  return c.json(results);
});

// Get followers list
api.get('/followers', async (c) => {
  const user = c.get('user');
  const hostname = getHostname(c);
  const localActorUrl = `https://${hostname}/users/${user.username}`;

  const followers = await c.env.DB.prepare(`
    SELECT f.id, f.follower_actor, f.status, ra.actor_json
    FROM follows f
    LEFT JOIN remote_actors ra ON f.follower_actor = ra.actor_url
    WHERE f.following_actor = ? AND f.status = 'accepted'
    ORDER BY f.created_at DESC
  `).bind(localActorUrl).all<{ id: string; follower_actor: string; status: string; actor_json: string | null }>();

  const results = followers.results.map(f => ({
    id: f.id,
    actor_url: f.follower_actor,
    status: f.status,
    actor: f.actor_json ? JSON.parse(f.actor_json) : null,
  }));

  return c.json(results);
});

// Get pending follow requests
api.get('/follows/pending', async (c) => {
  const user = c.get('user');
  const hostname = getHostname(c);
  const localActorUrl = `https://${hostname}/users/${user.username}`;

  const pending = await c.env.DB.prepare(`
    SELECT f.id, f.follower_actor, f.status, ra.actor_json
    FROM follows f
    LEFT JOIN remote_actors ra ON f.follower_actor = ra.actor_url
    WHERE f.following_actor = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).bind(localActorUrl).all<{ id: string; follower_actor: string; status: string; actor_json: string | null }>();

  const results = pending.results.map(f => ({
    id: f.id,
    actor_url: f.follower_actor,
    status: f.status,
    actor: f.actor_json ? JSON.parse(f.actor_json) : null,
  }));

  return c.json(results);
});

async function loadFollowActivity(env: Env, followerActor: string): Promise<any | null> {
  const activity = await env.DB.prepare(`
    SELECT activity_json FROM inbox_queue
    WHERE activity_type = 'Follow' AND actor_url = ?
    ORDER BY received_at DESC
    LIMIT 1
  `).bind(followerActor).first<{ activity_json: string }>();

  if (!activity?.activity_json) return null;

  try {
    return JSON.parse(activity.activity_json);
  } catch {
    return null;
  }
}

// Accept follow request
api.post('/follows/:id/accept', async (c) => {
  const user = c.get('user');
  const hostname = getHostname(c);
  const followId = c.req.param('id');
  const localActorUrl = `https://${hostname}/users/${user.username}`;

  const follow = await c.env.DB.prepare(`
    SELECT * FROM follows
    WHERE id = ? AND following_actor = ? AND status = 'pending'
  `).bind(followId, localActorUrl).first<{ id: string; follower_actor: string }>();

  if (!follow) {
    return c.json({ error: 'Follow request not found' }, 404);
  }

  await c.env.DB.prepare(`
    UPDATE follows SET status = 'accepted' WHERE id = ?
  `).bind(followId).run();

  const followerActor = await fetchRemoteActor(c.env, follow.follower_actor);
  if (followerActor?.inbox) {
    const followActivity = await loadFollowActivity(c.env, follow.follower_actor);
    const acceptActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${hostname}/activities/${generateId()}`,
      type: 'Accept',
      actor: localActorUrl,
      object: followActivity || {
        type: 'Follow',
        actor: follow.follower_actor,
        object: localActorUrl,
      },
    };

    await queueDelivery(c.env, acceptActivity, followerActor.inbox, user);
  }

  return c.json({ success: true });
});

// Reject follow request
api.post('/follows/:id/reject', async (c) => {
  const user = c.get('user');
  const hostname = getHostname(c);
  const followId = c.req.param('id');
  const localActorUrl = `https://${hostname}/users/${user.username}`;

  const follow = await c.env.DB.prepare(`
    SELECT * FROM follows
    WHERE id = ? AND following_actor = ? AND status = 'pending'
  `).bind(followId, localActorUrl).first<{ id: string; follower_actor: string }>();

  if (!follow) {
    return c.json({ error: 'Follow request not found' }, 404);
  }

  await c.env.DB.prepare(`
    UPDATE follows SET status = 'rejected' WHERE id = ?
  `).bind(followId).run();

  const followerActor = await fetchRemoteActor(c.env, follow.follower_actor);
  if (followerActor?.inbox) {
    const followActivity = await loadFollowActivity(c.env, follow.follower_actor);
    const rejectActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${hostname}/activities/${generateId()}`,
      type: 'Reject',
      actor: localActorUrl,
      object: followActivity || {
        type: 'Follow',
        actor: follow.follower_actor,
        object: localActorUrl,
      },
    };

    await queueDelivery(c.env, rejectActivity, followerActor.inbox, user);
  }

  return c.json({ success: true });
});

// Get notifications
api.get('/notifications', async (c) => {
  const user = c.get('user');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);

  const notifications = await c.env.DB.prepare(`
    SELECT n.*, ra.actor_json
    FROM notifications n
    LEFT JOIN remote_actors ra ON n.actor_url = ra.actor_url
    ORDER BY n.created_at DESC
    LIMIT ?
  `).bind(limit).all<{
    id: string;
    type: string;
    actor_url: string;
    object_url: string | null;
    read_at: string | null;
    created_at: string;
    actor_json: string | null;
  }>();

  const results = notifications.results.map(n => ({
    id: n.id,
    type: n.type,
    actor_url: n.actor_url,
    actor: n.actor_json ? JSON.parse(n.actor_json) : null,
    object_url: n.object_url,
    read: !!n.read_at,
    created_at: n.created_at,
  }));

  return c.json(results);
});

// Mark notifications as read
api.post('/notifications/read', async (c) => {
  const body = await c.req.json<{ ids?: string[]; all?: boolean }>();

  if (body.all) {
    await c.env.DB.prepare(`
      UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL
    `).run();
  } else if (body.ids && body.ids.length > 0) {
    const placeholders = body.ids.map(() => '?').join(',');
    await c.env.DB.prepare(`
      UPDATE notifications SET read_at = datetime('now')
      WHERE id IN (${placeholders}) AND read_at IS NULL
    `).bind(...body.ids).run();
  }

  return c.json({ success: true });
});

// Upload media
api.post('/media', async (c) => {
  const user = c.get('user');
  const hostname = getHostname(c);
  const config = await getTenantConfig(c.env);

  if (!config.features.enableMediaUpload) {
    return c.json({ error: 'Media uploads are disabled' }, 403);
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return c.json({ error: 'file required' }, 400);
  }

  // Validate file type
  const allowedTypes = config.content.allowedMediaTypes;
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'Invalid file type' }, 400);
  }

  // Validate file size (max 10MB)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    return c.json({ error: 'File too large (max 10MB)' }, 400);
  }

  const mediaId = generateId();
  const ext = file.type.split('/')[1];
  const key = `media/${mediaId}.${ext}`;

  // Upload to R2
  await c.env.MEDIA.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
    },
  });

  try {
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO media_files (id, r2_key, content_type, created_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).bind(mediaId, key, file.type).run();
  } catch (error) {
    console.warn('media_files insert failed:', error);
  }

  const mediaUrl = `https://${hostname}/media/${mediaId}.${ext}`;

  return c.json({
    id: mediaId,
    url: mediaUrl,
    type: file.type,
  }, 201);
});

export default api;
