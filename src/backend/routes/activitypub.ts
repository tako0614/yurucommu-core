import { Hono } from 'hono';
import type { Env, LocalUser, Post, Activity } from '../types';
import { buildActor, buildWebFinger } from '../services/activitypub/actor';
import { processActivity, fetchRemoteActor } from '../services/activitypub/activities';
import { getTenantConfig, isFederationAllowed } from '../services/config';
import { verifyRequest, extractKeyId } from '../services/activitypub/http-signatures';

const activitypub = new Hono<{ Bindings: Env }>();

function getHostname(c: any): string {
  return c.env?.HOSTNAME || new URL(c.req.url).host;
}

function getDomainFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function generateId(): string {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

// WebFinger
activitypub.get('/.well-known/webfinger', async (c) => {
  const resource = c.req.query('resource');
  if (!resource) {
    return c.json({ error: 'resource parameter required' }, 400);
  }

  // Parse acct:username@domain
  const match = resource.match(/^acct:([^@]+)@(.+)$/);
  if (!match) {
    return c.json({ error: 'Invalid resource format' }, 400);
  }

  const [, username, domain] = match;
  const hostname = getHostname(c);

  if (domain !== hostname) {
    return c.json({ error: 'Unknown domain' }, 404);
  }

  const user = await c.env.DB.prepare(
    `SELECT * FROM local_users WHERE username = ?`
  ).bind(username).first<LocalUser>();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json(buildWebFinger(user, hostname), 200, {
    'Content-Type': 'application/jrd+json',
  });
});

// Actor
activitypub.get('/users/:username', async (c) => {
  const username = c.req.param('username');
  const hostname = getHostname(c);

  const user = await c.env.DB.prepare(
    `SELECT * FROM local_users WHERE username = ?`
  ).bind(username).first<LocalUser>();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const accept = c.req.header('Accept') || '';
  if (!accept.includes('application/activity+json') && !accept.includes('application/ld+json')) {
    // Redirect to profile page for browsers
    return c.redirect(`/@${username}`);
  }

  return c.json(buildActor(user, hostname), 200, {
    'Content-Type': 'application/activity+json',
  });
});

// Outbox
activitypub.get('/users/:username/outbox', async (c) => {
  const username = c.req.param('username');
  const hostname = getHostname(c);
  const page = c.req.query('page') === 'true';

  const user = await c.env.DB.prepare(
    `SELECT * FROM local_users WHERE username = ?`
  ).bind(username).first<LocalUser>();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const actorUrl = `https://${hostname}/users/${username}`;
  const outboxUrl = `${actorUrl}/outbox`;

  if (!page) {
    // Return OrderedCollection
    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND visibility = 'public'`
    ).bind(user.id).first<{ count: number }>();

    return c.json({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: outboxUrl,
      type: 'OrderedCollection',
      totalItems: countResult?.count || 0,
      first: `${outboxUrl}?page=true`,
    }, 200, {
      'Content-Type': 'application/activity+json',
    });
  }

  // Return OrderedCollectionPage
  const posts = await c.env.DB.prepare(
    `SELECT * FROM posts WHERE user_id = ? AND visibility = 'public' ORDER BY published_at DESC LIMIT 20`
  ).bind(user.id).all<Post>();

  const orderedItems = posts.results.map((post) => {
    const note: Record<string, unknown> = {
      id: `https://${hostname}/posts/${post.id}`,
      type: 'Note',
      content: post.content,
      published: post.published_at,
      attributedTo: actorUrl,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actorUrl}/followers`],
    };

    if (post.content_warning) {
      note.summary = post.content_warning;
    }

    return {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${hostname}/posts/${post.id}/activity`,
      type: 'Create',
      actor: actorUrl,
      published: post.published_at,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actorUrl}/followers`],
      object: note,
    };
  });

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${outboxUrl}?page=true`,
    type: 'OrderedCollectionPage',
    partOf: outboxUrl,
    orderedItems,
  }, 200, {
    'Content-Type': 'application/activity+json',
  });
});

// Inbox
activitypub.post('/users/:username/inbox', async (c) => {
  const username = c.req.param('username');
  const hostname = getHostname(c);

  const user = await c.env.DB.prepare(
    `SELECT * FROM local_users WHERE username = ?`
  ).bind(username).first<LocalUser>();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Clone request for body reading (since we need to read it twice)
  const bodyText = await c.req.text();
  let activity: Activity;
  try {
    activity = JSON.parse(bodyText) as Activity;
  } catch {
    const queueId = generateId();
    const message = 'Invalid JSON body';
    try {
      await c.env.DB.prepare(
        `INSERT INTO inbox_queue (id, activity_type, actor_url, activity_json, signature_verified, signature_error, processed_at, error)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`
      ).bind(
        queueId,
        'InvalidJSON',
        '',
        bodyText,
        0,
        message,
        message
      ).run();
    } catch (error) {
      console.warn('inbox_queue insert failed:', error);
    }
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const activityType = (() => {
    if (typeof activity.type === 'string') {
      return activity.type;
    }
    if (Array.isArray(activity.type)) {
      const entry = activity.type.find((value) => typeof value === 'string');
      return entry || 'Unknown';
    }
    return 'Unknown';
  })();
  const recordInboxError = async (actor: string | null, message: string): Promise<void> => {
    try {
      const queueId = generateId();
      await c.env.DB.prepare(
        `INSERT INTO inbox_queue (id, activity_type, actor_url, activity_json, signature_verified, signature_error, processed_at, error)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`
      ).bind(
        queueId,
        activityType,
        actor || '',
        bodyText,
        0,
        message,
        message
      ).run();
    } catch (error) {
      console.warn('inbox_queue insert failed:', error);
    }
  };

  const actorValue = activity.actor as { id?: unknown; url?: unknown } | string | null;
  const actorUrl =
    typeof actorValue === 'string'
      ? actorValue
      : typeof actorValue?.id === 'string'
        ? actorValue.id
        : typeof actorValue?.url === 'string'
          ? actorValue.url
          : typeof (actorValue?.url as { href?: unknown } | undefined)?.href === 'string'
            ? (actorValue?.url as { href: string }).href
            : null;
  if (!actorUrl || actorUrl.length === 0) {
    await recordInboxError(null, 'Invalid actor');
    return c.json({ error: 'Invalid actor' }, 400);
  }
  let signatureVerified = false;
  let signatureError: string | null = null;

  const actorDomain = getDomainFromUrl(actorUrl);
  if (!actorDomain) {
    await recordInboxError(actorUrl, 'Invalid actor domain');
    return c.json({ error: 'Invalid actor domain' }, 400);
  }

  activity.actor = actorUrl as any;
  const config = await getTenantConfig(c.env);
  if (actorDomain !== hostname && !isFederationAllowed(config, actorDomain)) {
    await recordInboxError(actorUrl, 'Federation not allowed for this domain');
    return c.json({ error: 'Federation not allowed for this domain' }, 403);
  }

  // Verify HTTP signature
  const signatureHeader = c.req.header('Signature');
  const keyId = extractKeyId(signatureHeader || null);

  if (!signatureHeader) {
    console.warn('Missing Signature header from:', actorUrl);
    signatureError = 'Missing Signature header';
  } else {
    // Fetch the actor to get public key
    const actor = await fetchRemoteActor(c.env, actorUrl);

    if (!actor) {
      console.warn('Could not fetch actor:', actorUrl);
      signatureError = 'Could not fetch actor';
    } else if (!actor.publicKey?.publicKeyPem) {
      console.warn('Actor has no public key:', actorUrl);
      signatureError = 'Actor has no public key';
    } else {
      // Verify the keyId matches the actor's key
      const expectedKeyId = actor.publicKey.id || `${actorUrl}#main-key`;
      if (keyId && keyId !== expectedKeyId && !keyId.startsWith(actorUrl)) {
        console.warn(`KeyId mismatch: ${keyId} vs expected ${expectedKeyId}`);
        signatureError = 'KeyId mismatch';
      } else {
        // Verify the signature
        const result = await verifyRequest({
          request: c.req.raw,
          body: bodyText,
          publicKeyPem: actor.publicKey.publicKeyPem,
          strictMode: false,
        });

        if (result.valid) {
          signatureVerified = true;
        } else {
          console.warn(`Signature verification failed for ${actorUrl}: ${result.error}`);
          signatureError = result.error || 'Signature verification failed';
        }
      }
    }
  }

  if (!signatureVerified) {
    const queueId = generateId();
    const signatureMessage = signatureError || 'Signature verification failed';
    await c.env.DB.prepare(
      `INSERT INTO inbox_queue (id, activity_type, actor_url, activity_json, signature_verified, signature_error, processed_at, error)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`
    ).bind(
      queueId,
      activityType,
      actorUrl,
      bodyText,
      0,
      signatureMessage,
      signatureMessage
    ).run();
    return c.json({ error: 'Invalid signature', details: signatureError || 'Signature verification failed' }, 401);
  }

  // Store in queue for audit (including signature status)
  const queueId = generateId();
  await c.env.DB.prepare(
    `INSERT INTO inbox_queue (id, activity_type, actor_url, activity_json, signature_verified, signature_error)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    queueId,
    activityType,
    actorUrl || '',
    bodyText,
    signatureVerified ? 1 : 0,
    signatureError
  ).run();

  // Process the activity immediately
  try {
    const result = await processActivity(c.env, activity, user, hostname);

    // Mark as processed
    await c.env.DB.prepare(
      `UPDATE inbox_queue SET processed_at = datetime('now') WHERE id = ?`
    ).bind(queueId).run();

    if (!result.success) {
      await c.env.DB.prepare(
        `UPDATE inbox_queue SET error = ? WHERE id = ?`
      ).bind(result.error || 'Unknown error', queueId).run();
    }
  } catch (error) {
    console.error('Activity processing error:', error);
    await c.env.DB.prepare(
      `UPDATE inbox_queue SET error = ? WHERE id = ?`
    ).bind(String(error), queueId).run();
  }

  return c.json({ status: 'accepted' }, 202);
});

// Followers collection
activitypub.get('/users/:username/followers', async (c) => {
  const username = c.req.param('username');
  const hostname = getHostname(c);

  const user = await c.env.DB.prepare(
    `SELECT * FROM local_users WHERE username = ?`
  ).bind(username).first<LocalUser>();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const actorUrl = `https://${hostname}/users/${username}`;

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM follows WHERE following_actor = ? AND status = 'accepted'`
  ).bind(actorUrl).first<{ count: number }>();

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${actorUrl}/followers`,
    type: 'OrderedCollection',
    totalItems: countResult?.count || 0,
  }, 200, {
    'Content-Type': 'application/activity+json',
  });
});

// Following collection
activitypub.get('/users/:username/following', async (c) => {
  const username = c.req.param('username');
  const hostname = getHostname(c);

  const user = await c.env.DB.prepare(
    `SELECT * FROM local_users WHERE username = ?`
  ).bind(username).first<LocalUser>();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  const actorUrl = `https://${hostname}/users/${username}`;

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM follows WHERE follower_actor = ? AND status = 'accepted'`
  ).bind(actorUrl).first<{ count: number }>();

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${actorUrl}/following`,
    type: 'OrderedCollection',
    totalItems: countResult?.count || 0,
  }, 200, {
    'Content-Type': 'application/activity+json',
  });
});

export default activitypub;
