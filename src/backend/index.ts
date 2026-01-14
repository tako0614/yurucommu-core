import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

// ============================================================
// TYPES - All AP-native with AP IRIs
// ============================================================

type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  TAKOS_URL: string;
  TAKOS_CLIENT_ID: string;
  TAKOS_CLIENT_SECRET: string;
  APP_URL: string;
  AUTH_MODE?: string;
  AUTH_PASSWORD?: string;
};

type Variables = {
  actor: Actor | null;
};

// Local actor (Person)
interface Actor {
  ap_id: string;  // Primary key: https://domain/ap/users/username
  type: string;
  preferred_username: string;
  name: string | null;
  summary: string | null;
  icon_url: string | null;
  header_url: string | null;
  inbox: string;
  outbox: string;
  followers_url: string;
  following_url: string;
  public_key_pem: string;
  private_key_pem: string;
  takos_user_id: string | null;
  follower_count: number;
  following_count: number;
  post_count: number;
  is_private: number;
  role: 'owner' | 'moderator' | 'member';
  created_at: string;
}

// Cached remote actor
interface ActorCache {
  ap_id: string;
  type: string;
  preferred_username: string | null;
  name: string | null;
  summary: string | null;
  icon_url: string | null;
  inbox: string;
  public_key_pem: string | null;
  raw_json: string;
}

// AP Object (Note/Post)
interface APObject {
  ap_id: string;
  type: string;
  attributed_to: string;
  content: string;
  summary: string | null;
  attachments_json: string;
  in_reply_to: string | null;
  visibility: string;
  community_ap_id: string | null;
  like_count: number;
  reply_count: number;
  announce_count: number;
  published: string;
  is_local: number;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function generateId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate AP IRI for local resources
function actorApId(baseUrl: string, username: string): string {
  return `${baseUrl}/ap/users/${username}`;
}

function objectApId(baseUrl: string, id: string): string {
  return `${baseUrl}/ap/objects/${id}`;
}

function activityApId(baseUrl: string, id: string): string {
  return `${baseUrl}/ap/activities/${id}`;
}

function communityApId(baseUrl: string, name: string): string {
  return `${baseUrl}/ap/groups/${name}`;
}

// Extract domain from AP IRI
function getDomain(apId: string): string {
  return new URL(apId).host;
}

// Check if AP IRI is local
function isLocal(apId: string, baseUrl: string): boolean {
  return apId.startsWith(baseUrl);
}

// Format username with domain for display
function formatUsername(apId: string): string {
  const url = new URL(apId);
  const match = apId.match(/\/users\/([^\/]+)$/);
  if (match) {
    return `${match[1]}@${url.host}`;
  }
  return apId;
}

// RSA key generation
async function generateKeyPair(): Promise<{ publicKeyPem: string; privateKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );

  const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(publicKey))).match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(privateKey))).match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`;

  return { publicKeyPem, privateKeyPem };
}

// HTTP Signature
async function signRequest(privateKeyPem: string, keyId: string, method: string, url: string, body?: string): Promise<Record<string, string>> {
  const urlObj = new URL(url);
  const date = new Date().toUTCString();
  const digest = body ? `SHA-256=${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))))}` : undefined;

  const signedHeaders = digest ? '(request-target) host date digest' : '(request-target) host date';
  const signatureString = digest
    ? `(request-target): ${method.toLowerCase()} ${urlObj.pathname}\nhost: ${urlObj.host}\ndate: ${date}\ndigest: ${digest}`
    : `(request-target): ${method.toLowerCase()} ${urlObj.pathname}\nhost: ${urlObj.host}\ndate: ${date}`;

  const pemContents = privateKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signatureBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signatureString));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  const headers: Record<string, string> = {
    'Date': date,
    'Host': urlObj.host,
    'Signature': `keyId="${keyId}",algorithm="rsa-sha256",headers="${signedHeaders}",signature="${signature}"`,
  };
  if (digest) headers['Digest'] = digest;

  return headers;
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

app.use('/api/*', async (c, next) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    // Sessions now store actor ap_id in member_id column (legacy compatibility)
    const session = await c.env.DB.prepare(
      `SELECT s.*, a.* FROM sessions s
       JOIN actors a ON s.member_id = a.ap_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    ).bind(sessionId).first<any>();

    if (session) {
      c.set('actor', session as Actor);
    }
  }
  await next();
});

// ============================================================
// AUTH ENDPOINTS
// ============================================================

app.get('/api/auth/me', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Not authenticated' }, 401);

  return c.json({
    actor: {
      ap_id: actor.ap_id,
      username: formatUsername(actor.ap_id),
      preferred_username: actor.preferred_username,
      name: actor.name,
      summary: actor.summary,
      icon_url: actor.icon_url,
      header_url: actor.header_url,
      follower_count: actor.follower_count,
      following_count: actor.following_count,
      post_count: actor.post_count,
      role: actor.role,
    }
  });
});

// Password auth (simple mode)
app.post('/api/auth/login', async (c) => {
  if (c.env.AUTH_MODE !== 'password') {
    return c.json({ error: 'Password auth not enabled' }, 400);
  }

  const body = await c.req.json<{ password: string; username?: string }>();
  if (body.password !== c.env.AUTH_PASSWORD) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  const baseUrl = c.env.APP_URL;
  const username = body.username || 'tako';
  const apId = actorApId(baseUrl, username);

  // Get or create actor
  let actor = await c.env.DB.prepare('SELECT * FROM actors WHERE ap_id = ?').bind(apId).first<Actor>();

  if (!actor) {
    const { publicKeyPem, privateKeyPem } = await generateKeyPair();
    await c.env.DB.prepare(`
      INSERT INTO actors (ap_id, type, preferred_username, name, inbox, outbox, followers_url, following_url, public_key_pem, private_key_pem, takos_user_id, role)
      VALUES (?, 'Person', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'owner')
    `).bind(
      apId,
      username,
      username,
      `${apId}/inbox`,
      `${apId}/outbox`,
      `${apId}/followers`,
      `${apId}/following`,
      publicKeyPem,
      privateKeyPem,
      `password:${username}`
    ).run();

    actor = await c.env.DB.prepare('SELECT * FROM actors WHERE ap_id = ?').bind(apId).first<Actor>();
  }

  // Create session (store ap_id in member_id for compatibility)
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (id, member_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, apId, expiresAt).run();

  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });

  return c.json({ success: true });
});

app.post('/api/auth/logout', async (c) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    deleteCookie(c, 'session');
  }
  return c.json({ success: true });
});

// ============================================================
// ACTOR ENDPOINTS (Users/Profiles)
// ============================================================

// Get all local actors
app.get('/api/actors', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, summary, icon_url, role, follower_count, following_count, post_count, created_at
    FROM actors ORDER BY created_at ASC
  `).all();

  const actors = (result.results || []).map((a: any) => ({
    ...a,
    username: formatUsername(a.ap_id),
  }));

  return c.json({ actors });
});

// Get actor by AP ID or username
app.get('/api/actors/:identifier', async (c) => {
  const currentActor = c.get('actor');
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;

  // Check if identifier is a full AP ID or just username
  let apId: string;
  if (identifier.startsWith('http')) {
    apId = identifier;
  } else if (identifier.includes('@')) {
    // Handle @username@domain format
    const [username, domain] = identifier.replace(/^@/, '').split('@');
    if (domain === getDomain(baseUrl)) {
      apId = actorApId(baseUrl, username);
    } else {
      // Remote actor - check cache
      const cached = await c.env.DB.prepare('SELECT * FROM actor_cache WHERE preferred_username = ? AND ap_id LIKE ?')
        .bind(username, `%${domain}%`).first();
      if (cached) {
        return c.json({ actor: { ...cached, username: formatUsername(cached.ap_id) } });
      }
      return c.json({ error: 'Actor not found' }, 404);
    }
  } else {
    apId = actorApId(baseUrl, identifier);
  }

  // Try local actors first
  let actor = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, summary, icon_url, header_url, role,
           follower_count, following_count, post_count, is_private, created_at
    FROM actors WHERE ap_id = ?
  `).bind(apId).first<any>();

  if (!actor) {
    // Try actor cache (remote)
    actor = await c.env.DB.prepare('SELECT * FROM actor_cache WHERE ap_id = ?').bind(apId).first();
    if (!actor) return c.json({ error: 'Actor not found' }, 404);
  }

  // Check follow status if logged in
  let is_following = false;
  let is_followed_by = false;

  if (currentActor && currentActor.ap_id !== apId) {
    const followStatus = await c.env.DB.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM follows WHERE follower_ap_id = ? AND following_ap_id = ? AND status = 'accepted') as is_following,
        EXISTS(SELECT 1 FROM follows WHERE follower_ap_id = ? AND following_ap_id = ? AND status = 'accepted') as is_followed_by
    `).bind(currentActor.ap_id, apId, apId, currentActor.ap_id).first<any>();

    if (followStatus) {
      is_following = !!followStatus.is_following;
      is_followed_by = !!followStatus.is_followed_by;
    }
  }

  return c.json({
    actor: {
      ...actor,
      username: formatUsername(actor.ap_id),
      is_following,
      is_followed_by,
    }
  });
});

// Update own profile
app.put('/api/actors/me', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ name?: string; summary?: string; icon_url?: string; header_url?: string }>();

  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name); }
  if (body.summary !== undefined) { updates.push('summary = ?'); values.push(body.summary); }
  if (body.icon_url !== undefined) { updates.push('icon_url = ?'); values.push(body.icon_url); }
  if (body.header_url !== undefined) { updates.push('header_url = ?'); values.push(body.header_url); }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);

  updates.push("updated_at = datetime('now')");
  values.push(actor.ap_id);

  await c.env.DB.prepare(`UPDATE actors SET ${updates.join(', ')} WHERE ap_id = ?`).bind(...values).run();

  return c.json({ success: true });
});

// Get actor's followers
app.get('/api/actors/:identifier/followers', async (c) => {
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : actorApId(baseUrl, identifier);

  const followers = await c.env.DB.prepare(`
    SELECT f.follower_ap_id, f.created_at,
           COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
           COALESCE(a.name, ac.name) as name,
           COALESCE(a.icon_url, ac.icon_url) as icon_url,
           COALESCE(a.summary, ac.summary) as summary
    FROM follows f
    LEFT JOIN actors a ON f.follower_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON f.follower_ap_id = ac.ap_id
    WHERE f.following_ap_id = ? AND f.status = 'accepted'
    ORDER BY f.created_at DESC
  `).bind(apId).all();

  const result = (followers.results || []).map((f: any) => ({
    ap_id: f.follower_ap_id,
    username: formatUsername(f.follower_ap_id),
    preferred_username: f.preferred_username,
    name: f.name,
    icon_url: f.icon_url,
    summary: f.summary,
  }));

  return c.json({ followers: result });
});

// Get actor's following
app.get('/api/actors/:identifier/following', async (c) => {
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : actorApId(baseUrl, identifier);

  const following = await c.env.DB.prepare(`
    SELECT f.following_ap_id, f.created_at,
           COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
           COALESCE(a.name, ac.name) as name,
           COALESCE(a.icon_url, ac.icon_url) as icon_url,
           COALESCE(a.summary, ac.summary) as summary
    FROM follows f
    LEFT JOIN actors a ON f.following_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON f.following_ap_id = ac.ap_id
    WHERE f.follower_ap_id = ? AND f.status = 'accepted'
    ORDER BY f.created_at DESC
  `).bind(apId).all();

  const result = (following.results || []).map((f: any) => ({
    ap_id: f.following_ap_id,
    username: formatUsername(f.following_ap_id),
    preferred_username: f.preferred_username,
    name: f.name,
    icon_url: f.icon_url,
    summary: f.summary,
  }));

  return c.json({ following: result });
});

// ============================================================
// FOLLOW ENDPOINTS (Unified)
// ============================================================

// Follow an actor
app.post('/api/follow', async (c) => {
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
app.delete('/api/follow', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ target_ap_id: string }>();
  if (!body.target_ap_id) return c.json({ error: 'target_ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const targetApId = body.target_ap_id;

  const follow = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?'
  ).bind(actor.ap_id, targetApId).first<any>();

  if (!follow) return c.json({ error: 'Not following' }, 400);

  // Delete the follow
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?')
    .bind(actor.ap_id, targetApId).run();

  // Update counts if was accepted
  if (follow.status === 'accepted') {
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
    }
  }

  return c.json({ success: true });
});

// Accept follow request
app.post('/api/follow/accept', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ requester_ap_id: string }>();
  if (!body.requester_ap_id) return c.json({ error: 'requester_ap_id required' }, 400);

  const follow = await c.env.DB.prepare(
    'SELECT * FROM follows WHERE follower_ap_id = ? AND following_ap_id = ? AND status = ?'
  ).bind(body.requester_ap_id, actor.ap_id, 'pending').first();

  if (!follow) return c.json({ error: 'No pending follow request' }, 404);

  await c.env.DB.prepare(`
    UPDATE follows SET status = 'accepted', accepted_at = datetime('now')
    WHERE follower_ap_id = ? AND following_ap_id = ?
  `).bind(body.requester_ap_id, actor.ap_id).run();

  // Update counts
  await c.env.DB.prepare('UPDATE actors SET follower_count = follower_count + 1 WHERE ap_id = ?').bind(actor.ap_id).run();
  if (isLocal(body.requester_ap_id, c.env.APP_URL)) {
    await c.env.DB.prepare('UPDATE actors SET following_count = following_count + 1 WHERE ap_id = ?').bind(body.requester_ap_id).run();
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
        object: (follow as any).activity_ap_id,
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
    }
  }

  return c.json({ success: true });
});

// Get pending follow requests
app.get('/api/follow/requests', async (c) => {
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

// ============================================================
// OBJECTS ENDPOINTS (Posts)
// ============================================================

// Get timeline
app.get('/api/timeline', async (c) => {
  const actor = c.get('actor');
  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');
  const communityApId = c.req.query('community');

  let query = `
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked,
           EXISTS(SELECT 1 FROM bookmarks b WHERE b.object_ap_id = o.ap_id AND b.actor_ap_id = ?) as bookmarked
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.visibility = 'public' AND o.in_reply_to IS NULL
  `;
  const params: any[] = [actor?.ap_id || '', actor?.ap_id || ''];

  if (communityApId) {
    query += ` AND o.community_ap_id = ?`;
    params.push(communityApId);
  }

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY o.published DESC LIMIT ?`;
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all();

  const result = (posts.results || []).map((p: any) => ({
    ap_id: p.ap_id,
    type: p.type,
    author: {
      ap_id: p.attributed_to,
      username: formatUsername(p.attributed_to),
      preferred_username: p.author_username,
      name: p.author_name,
      icon_url: p.author_icon_url,
    },
    content: p.content,
    summary: p.summary,
    attachments: JSON.parse(p.attachments_json || '[]'),
    in_reply_to: p.in_reply_to,
    visibility: p.visibility,
    community_ap_id: p.community_ap_id,
    like_count: p.like_count,
    reply_count: p.reply_count,
    announce_count: p.announce_count,
    published: p.published,
    liked: !!p.liked,
    bookmarked: !!p.bookmarked,
  }));

  return c.json({ posts: result });
});

// Get following timeline
app.get('/api/timeline/following', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');

  let query = `
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked,
           EXISTS(SELECT 1 FROM bookmarks b WHERE b.object_ap_id = o.ap_id AND b.actor_ap_id = ?) as bookmarked
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.in_reply_to IS NULL
      AND (o.attributed_to IN (
        SELECT following_ap_id FROM follows WHERE follower_ap_id = ? AND status = 'accepted'
      ) OR o.attributed_to = ?)
  `;
  const params: any[] = [actor.ap_id, actor.ap_id, actor.ap_id, actor.ap_id];

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY o.published DESC LIMIT ?`;
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all();

  const result = (posts.results || []).map((p: any) => ({
    ap_id: p.ap_id,
    type: p.type,
    author: {
      ap_id: p.attributed_to,
      username: formatUsername(p.attributed_to),
      preferred_username: p.author_username,
      name: p.author_name,
      icon_url: p.author_icon_url,
    },
    content: p.content,
    summary: p.summary,
    attachments: JSON.parse(p.attachments_json || '[]'),
    in_reply_to: p.in_reply_to,
    visibility: p.visibility,
    like_count: p.like_count,
    reply_count: p.reply_count,
    announce_count: p.announce_count,
    published: p.published,
    liked: !!p.liked,
    bookmarked: !!p.bookmarked,
  }));

  return c.json({ posts: result });
});

// Create post
app.post('/api/posts', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{
    content: string;
    summary?: string;
    in_reply_to?: string;
    visibility?: string;
    community_ap_id?: string;
    attachments?: { r2_key: string; content_type: string }[];
  }>();

  if (!body.content?.trim() && (!body.attachments || body.attachments.length === 0)) {
    return c.json({ error: 'Content or attachments required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const objectId = generateId();
  const apId = objectApId(baseUrl, objectId);
  const visibility = body.visibility || 'public';

  const attachmentsJson = JSON.stringify(body.attachments || []);

  await c.env.DB.prepare(`
    INSERT INTO objects (ap_id, type, attributed_to, content, summary, attachments_json, in_reply_to, visibility, community_ap_id, is_local)
    VALUES (?, 'Note', ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(apId, actor.ap_id, body.content?.trim() || '', body.summary || null, attachmentsJson, body.in_reply_to || null, visibility, body.community_ap_id || null).run();

  // Update post count
  await c.env.DB.prepare('UPDATE actors SET post_count = post_count + 1 WHERE ap_id = ?').bind(actor.ap_id).run();

  // Update reply count if this is a reply
  if (body.in_reply_to) {
    await c.env.DB.prepare('UPDATE objects SET reply_count = reply_count + 1 WHERE ap_id = ?').bind(body.in_reply_to).run();

    // Create notification for reply
    const parentPost = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?').bind(body.in_reply_to).first<any>();
    if (parentPost && parentPost.attributed_to !== actor.ap_id) {
      const notifId = generateId();
      await c.env.DB.prepare(`
        INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type, object_ap_id)
        VALUES (?, ?, ?, 'reply', ?)
      `).bind(notifId, parentPost.attributed_to, actor.ap_id, apId).run();
    }
  }

  // Federate to followers if public
  if (visibility === 'public') {
    // Get remote followers
    const remoteFollowers = await c.env.DB.prepare(`
      SELECT ac.inbox FROM follows f
      JOIN actor_cache ac ON f.follower_ap_id = ac.ap_id
      WHERE f.following_ap_id = ? AND f.status = 'accepted'
    `).bind(actor.ap_id).all();

    if (remoteFollowers.results && remoteFollowers.results.length > 0) {
      const createActivityId = activityApId(baseUrl, generateId());
      const createActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: createActivityId,
        type: 'Create',
        actor: actor.ap_id,
        published: new Date().toISOString(),
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [actor.followers_url],
        object: {
          id: apId,
          type: 'Note',
          attributedTo: actor.ap_id,
          content: body.content,
          published: new Date().toISOString(),
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [actor.followers_url],
        },
      };

      // Queue deliveries
      for (const follower of remoteFollowers.results as any[]) {
        if (follower.inbox) {
          const queueId = generateId();
          await c.env.DB.prepare(`
            INSERT INTO delivery_queue (id, activity_ap_id, inbox_url)
            VALUES (?, ?, ?)
          `).bind(queueId, createActivityId, follower.inbox).run();
        }
      }

      // Store activity
      await c.env.DB.prepare(`
        INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
        VALUES (?, 'Create', ?, ?, ?, 'outbound')
      `).bind(createActivityId, actor.ap_id, apId, JSON.stringify(createActivity)).run();
    }
  }

  return c.json({
    post: {
      ap_id: apId,
      type: 'Note',
      author: {
        ap_id: actor.ap_id,
        username: formatUsername(actor.ap_id),
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url,
      },
      content: body.content?.trim() || '',
      summary: body.summary || null,
      attachments: body.attachments || [],
      in_reply_to: body.in_reply_to || null,
      visibility,
      community_ap_id: body.community_ap_id || null,
      like_count: 0,
      reply_count: 0,
      announce_count: 0,
      published: new Date().toISOString(),
      liked: false,
      bookmarked: false,
    }
  }, 201);
});

// Get single post
app.get('/api/posts/:id', async (c) => {
  const actor = c.get('actor');
  const id = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Handle both AP IRI and short ID
  const apId = id.startsWith('http') ? id : objectApId(baseUrl, id);

  const post = await c.env.DB.prepare(`
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked,
           EXISTS(SELECT 1 FROM bookmarks b WHERE b.object_ap_id = o.ap_id AND b.actor_ap_id = ?) as bookmarked
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.ap_id = ?
  `).bind(actor?.ap_id || '', actor?.ap_id || '', apId).first<any>();

  if (!post) return c.json({ error: 'Not found' }, 404);

  return c.json({
    post: {
      ap_id: post.ap_id,
      type: post.type,
      author: {
        ap_id: post.attributed_to,
        username: formatUsername(post.attributed_to),
        preferred_username: post.author_username,
        name: post.author_name,
        icon_url: post.author_icon_url,
      },
      content: post.content,
      summary: post.summary,
      attachments: JSON.parse(post.attachments_json || '[]'),
      in_reply_to: post.in_reply_to,
      visibility: post.visibility,
      community_ap_id: post.community_ap_id,
      like_count: post.like_count,
      reply_count: post.reply_count,
      announce_count: post.announce_count,
      published: post.published,
      liked: !!post.liked,
      bookmarked: !!post.bookmarked,
    }
  });
});

// Get post replies
app.get('/api/posts/:id/replies', async (c) => {
  const actor = c.get('actor');
  const id = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = id.startsWith('http') ? id : objectApId(baseUrl, id);

  const replies = await c.env.DB.prepare(`
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.in_reply_to = ?
    ORDER BY o.published ASC
  `).bind(actor?.ap_id || '', apId).all();

  const result = (replies.results || []).map((r: any) => ({
    ap_id: r.ap_id,
    type: r.type,
    author: {
      ap_id: r.attributed_to,
      username: formatUsername(r.attributed_to),
      preferred_username: r.author_username,
      name: r.author_name,
      icon_url: r.author_icon_url,
    },
    content: r.content,
    published: r.published,
    like_count: r.like_count,
    liked: !!r.liked,
  }));

  return c.json({ replies: result });
});

// Delete post
app.delete('/api/posts/:id', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = id.startsWith('http') ? id : objectApId(baseUrl, id);

  const post = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ?').bind(apId).first<APObject>();
  if (!post) return c.json({ error: 'Not found' }, 404);
  if (post.attributed_to !== actor.ap_id && actor.role !== 'owner' && actor.role !== 'moderator') {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM objects WHERE ap_id = ?').bind(apId).run();
  await c.env.DB.prepare('UPDATE actors SET post_count = post_count - 1 WHERE ap_id = ? AND post_count > 0').bind(post.attributed_to).run();

  // Update parent reply count if this was a reply
  if (post.in_reply_to) {
    await c.env.DB.prepare('UPDATE objects SET reply_count = reply_count - 1 WHERE ap_id = ? AND reply_count > 0').bind(post.in_reply_to).run();
  }

  return c.json({ success: true });
});

// ============================================================
// LIKE ENDPOINTS
// ============================================================

app.post('/api/posts/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const objectApIdVal = id.startsWith('http') ? id : objectApId(baseUrl, id);

  const existing = await c.env.DB.prepare('SELECT 1 FROM likes WHERE actor_ap_id = ? AND object_ap_id = ?')
    .bind(actor.ap_id, objectApIdVal).first();

  if (existing) return c.json({ error: 'Already liked' }, 400);

  const activityId = activityApId(baseUrl, generateId());

  await c.env.DB.prepare(`
    INSERT INTO likes (actor_ap_id, object_ap_id, activity_ap_id)
    VALUES (?, ?, ?)
  `).bind(actor.ap_id, objectApIdVal, activityId).run();

  await c.env.DB.prepare('UPDATE objects SET like_count = like_count + 1 WHERE ap_id = ?').bind(objectApIdVal).run();

  // Create notification
  const post = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?').bind(objectApIdVal).first<any>();
  if (post && post.attributed_to !== actor.ap_id && isLocal(post.attributed_to, baseUrl)) {
    const notifId = generateId();
    await c.env.DB.prepare(`
      INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type, object_ap_id)
      VALUES (?, ?, ?, 'like', ?)
    `).bind(notifId, post.attributed_to, actor.ap_id, objectApIdVal).run();
  }

  return c.json({ success: true });
});

app.delete('/api/posts/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const objectApIdVal = id.startsWith('http') ? id : objectApId(baseUrl, id);

  const result = await c.env.DB.prepare('DELETE FROM likes WHERE actor_ap_id = ? AND object_ap_id = ?')
    .bind(actor.ap_id, objectApIdVal).run();

  if (result.meta.changes > 0) {
    await c.env.DB.prepare('UPDATE objects SET like_count = like_count - 1 WHERE ap_id = ? AND like_count > 0').bind(objectApIdVal).run();
  }

  return c.json({ success: true });
});

// ============================================================
// BOOKMARK ENDPOINTS
// ============================================================

app.post('/api/posts/:id/bookmark', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const objectApIdVal = id.startsWith('http') ? id : objectApId(baseUrl, id);

  try {
    await c.env.DB.prepare('INSERT INTO bookmarks (actor_ap_id, object_ap_id) VALUES (?, ?)')
      .bind(actor.ap_id, objectApIdVal).run();
  } catch (e) {
    return c.json({ error: 'Already bookmarked' }, 400);
  }

  return c.json({ success: true });
});

app.delete('/api/posts/:id/bookmark', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const objectApIdVal = id.startsWith('http') ? id : objectApId(baseUrl, id);

  await c.env.DB.prepare('DELETE FROM bookmarks WHERE actor_ap_id = ? AND object_ap_id = ?')
    .bind(actor.ap_id, objectApIdVal).run();

  return c.json({ success: true });
});

app.get('/api/bookmarks', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');

  let query = `
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked,
           1 as bookmarked,
           b.created_at as bookmark_created_at
    FROM bookmarks b
    JOIN objects o ON b.object_ap_id = o.ap_id
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE b.actor_ap_id = ?
  `;
  const params: any[] = [actor.ap_id, actor.ap_id];

  if (before) {
    query += ` AND b.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY b.created_at DESC LIMIT ?`;
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all();

  const result = (posts.results || []).map((p: any) => ({
    ap_id: p.ap_id,
    type: p.type,
    author: {
      ap_id: p.attributed_to,
      username: formatUsername(p.attributed_to),
      preferred_username: p.author_username,
      name: p.author_name,
      icon_url: p.author_icon_url,
    },
    content: p.content,
    published: p.published,
    like_count: p.like_count,
    liked: !!p.liked,
    bookmarked: true,
  }));

  return c.json({ posts: result });
});

// ============================================================
// NOTIFICATIONS ENDPOINTS
// ============================================================

app.get('/api/notifications', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '20');

  const notifications = await c.env.DB.prepare(`
    SELECT n.*,
           COALESCE(a.preferred_username, ac.preferred_username) as actor_username,
           COALESCE(a.name, ac.name) as actor_name,
           COALESCE(a.icon_url, ac.icon_url) as actor_icon_url
    FROM notifications n
    LEFT JOIN actors a ON n.actor_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON n.actor_ap_id = ac.ap_id
    WHERE n.recipient_ap_id = ?
    ORDER BY n.created_at DESC
    LIMIT ?
  `).bind(actor.ap_id, limit).all();

  const result = (notifications.results || []).map((n: any) => ({
    id: n.id,
    type: n.type,
    actor: {
      ap_id: n.actor_ap_id,
      username: formatUsername(n.actor_ap_id),
      preferred_username: n.actor_username,
      name: n.actor_name,
      icon_url: n.actor_icon_url,
    },
    object_ap_id: n.object_ap_id,
    read: !!n.read,
    created_at: n.created_at,
  }));

  return c.json({ notifications: result });
});

app.get('/api/notifications/unread/count', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const result = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE recipient_ap_id = ? AND read = 0'
  ).bind(actor.ap_id).first<{ count: number }>();

  return c.json({ count: result?.count || 0 });
});

app.post('/api/notifications/read', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ids?: string[] }>();

  if (body.ids && body.ids.length > 0) {
    const placeholders = body.ids.map(() => '?').join(',');
    await c.env.DB.prepare(`UPDATE notifications SET read = 1 WHERE id IN (${placeholders}) AND recipient_ap_id = ?`)
      .bind(...body.ids, actor.ap_id).run();
  } else {
    await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE recipient_ap_id = ?').bind(actor.ap_id).run();
  }

  return c.json({ success: true });
});

// ============================================================
// SEARCH ENDPOINTS
// ============================================================

app.get('/api/search/actors', async (c) => {
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ actors: [] });

  // Search local actors
  const actors = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, icon_url, summary
    FROM actors
    WHERE preferred_username LIKE ? OR name LIKE ?
    ORDER BY preferred_username ASC
    LIMIT 20
  `).bind(`%${query}%`, `%${query}%`).all();

  const result = (actors.results || []).map((a: any) => ({
    ...a,
    username: formatUsername(a.ap_id),
  }));

  return c.json({ actors: result });
});

app.get('/api/search/posts', async (c) => {
  const actor = c.get('actor');
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ posts: [] });

  const posts = await c.env.DB.prepare(`
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.content LIKE ? AND o.visibility = 'public'
    ORDER BY o.published DESC
    LIMIT 50
  `).bind(actor?.ap_id || '', `%${query}%`).all();

  const result = (posts.results || []).map((p: any) => ({
    ap_id: p.ap_id,
    author: {
      ap_id: p.attributed_to,
      username: formatUsername(p.attributed_to),
      preferred_username: p.author_username,
      name: p.author_name,
      icon_url: p.author_icon_url,
    },
    content: p.content,
    published: p.published,
    like_count: p.like_count,
    liked: !!p.liked,
  }));

  return c.json({ posts: result });
});

// Remote actor search via WebFinger
app.get('/api/search/remote', async (c) => {
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ actors: [] });

  // Parse @user@domain format
  const match = query.match(/^@?([^@]+)@([^@]+)$/);
  if (!match) return c.json({ actors: [] });

  const [, username, domain] = match;

  try {
    // WebFinger lookup
    const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=acct:${username}@${domain}`;
    const wfRes = await fetch(webfingerUrl, { headers: { 'Accept': 'application/jrd+json' } });
    if (!wfRes.ok) return c.json({ actors: [] });

    const wfData = await wfRes.json() as any;
    const actorLink = wfData.links?.find((l: any) => l.rel === 'self' && l.type === 'application/activity+json');
    if (!actorLink?.href) return c.json({ actors: [] });

    // Fetch actor
    const actorRes = await fetch(actorLink.href, {
      headers: { 'Accept': 'application/activity+json, application/ld+json' }
    });
    if (!actorRes.ok) return c.json({ actors: [] });

    const actorData = await actorRes.json() as any;

    // Cache the actor
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

    return c.json({
      actors: [{
        ap_id: actorData.id,
        username: `${actorData.preferredUsername}@${domain}`,
        preferred_username: actorData.preferredUsername,
        name: actorData.name,
        summary: actorData.summary,
        icon_url: actorData.icon?.url,
      }]
    });
  } catch (e) {
    console.error('Remote search failed:', e);
    return c.json({ actors: [] });
  }
});

// ============================================================
// COMMUNITIES ENDPOINTS
// ============================================================

app.get('/api/communities', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, summary, icon_url, visibility, member_count, created_at
    FROM communities
    ORDER BY name ASC
  `).all();

  return c.json({ communities: result.results || [] });
});

app.get('/api/communities/:name', async (c) => {
  const name = c.req.param('name');
  const baseUrl = c.env.APP_URL;
  const apId = name.startsWith('http') ? name : communityApId(baseUrl, name);

  const community = await c.env.DB.prepare('SELECT * FROM communities WHERE ap_id = ?').bind(apId).first();
  if (!community) return c.json({ error: 'Community not found' }, 404);

  return c.json({ community });
});

// ============================================================
// DM ENDPOINTS
// ============================================================

app.get('/api/dm/conversations', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const result = await c.env.DB.prepare(`
    SELECT c.*,
           COALESCE(a1.preferred_username, ac1.preferred_username) as p1_username,
           COALESCE(a1.name, ac1.name) as p1_name,
           COALESCE(a1.icon_url, ac1.icon_url) as p1_icon_url,
           COALESCE(a2.preferred_username, ac2.preferred_username) as p2_username,
           COALESCE(a2.name, ac2.name) as p2_name,
           COALESCE(a2.icon_url, ac2.icon_url) as p2_icon_url
    FROM dm_conversations c
    LEFT JOIN actors a1 ON c.participant1_ap_id = a1.ap_id
    LEFT JOIN actor_cache ac1 ON c.participant1_ap_id = ac1.ap_id
    LEFT JOIN actors a2 ON c.participant2_ap_id = a2.ap_id
    LEFT JOIN actor_cache ac2 ON c.participant2_ap_id = ac2.ap_id
    WHERE c.participant1_ap_id = ? OR c.participant2_ap_id = ?
    ORDER BY c.last_message_at DESC NULLS LAST
  `).bind(actor.ap_id, actor.ap_id).all();

  const conversations = (result.results || []).map((conv: any) => {
    const isP1 = conv.participant1_ap_id === actor.ap_id;
    const other = {
      ap_id: isP1 ? conv.participant2_ap_id : conv.participant1_ap_id,
      username: formatUsername(isP1 ? conv.participant2_ap_id : conv.participant1_ap_id),
      preferred_username: isP1 ? conv.p2_username : conv.p1_username,
      name: isP1 ? conv.p2_name : conv.p1_name,
      icon_url: isP1 ? conv.p2_icon_url : conv.p1_icon_url,
    };
    return {
      id: conv.id,
      other_participant: other,
      last_message_at: conv.last_message_at,
      created_at: conv.created_at,
    };
  });

  return c.json({ conversations });
});

app.post('/api/dm/conversations', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ participant_ap_id: string }>();
  if (!body.participant_ap_id) return c.json({ error: 'participant_ap_id required' }, 400);
  if (body.participant_ap_id === actor.ap_id) return c.json({ error: 'Cannot start conversation with yourself' }, 400);

  // Check if conversation exists
  const existing = await c.env.DB.prepare(`
    SELECT * FROM dm_conversations
    WHERE (participant1_ap_id = ? AND participant2_ap_id = ?) OR (participant1_ap_id = ? AND participant2_ap_id = ?)
  `).bind(actor.ap_id, body.participant_ap_id, body.participant_ap_id, actor.ap_id).first();

  if (existing) return c.json({ conversation: { id: (existing as any).id } });

  const id = generateId();
  await c.env.DB.prepare(`
    INSERT INTO dm_conversations (id, participant1_ap_id, participant2_ap_id)
    VALUES (?, ?, ?)
  `).bind(id, actor.ap_id, body.participant_ap_id).run();

  return c.json({ conversation: { id } }, 201);
});

app.get('/api/dm/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const convId = c.req.param('id');

  // Verify access
  const conv = await c.env.DB.prepare('SELECT * FROM dm_conversations WHERE id = ?').bind(convId).first<any>();
  if (!conv) return c.json({ error: 'Conversation not found' }, 404);
  if (conv.participant1_ap_id !== actor.ap_id && conv.participant2_ap_id !== actor.ap_id) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  const limit = parseInt(c.req.query('limit') || '50');
  const before = c.req.query('before');

  let query = `
    SELECT m.*,
           COALESCE(a.preferred_username, ac.preferred_username) as sender_username,
           COALESCE(a.name, ac.name) as sender_name,
           COALESCE(a.icon_url, ac.icon_url) as sender_icon_url
    FROM dm_messages m
    LEFT JOIN actors a ON m.sender_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON m.sender_ap_id = ac.ap_id
    WHERE m.conversation_id = ?
  `;
  const params: any[] = [convId];

  if (before) {
    query += ` AND m.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY m.created_at DESC LIMIT ?`;
  params.push(limit);

  const result = await c.env.DB.prepare(query).bind(...params).all();

  const messages = (result.results || []).reverse().map((m: any) => ({
    id: m.id,
    sender: {
      ap_id: m.sender_ap_id,
      username: formatUsername(m.sender_ap_id),
      preferred_username: m.sender_username,
      name: m.sender_name,
      icon_url: m.sender_icon_url,
    },
    content: m.content,
    created_at: m.created_at,
  }));

  return c.json({ messages });
});

app.post('/api/dm/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const convId = c.req.param('id');

  // Verify access
  const conv = await c.env.DB.prepare('SELECT * FROM dm_conversations WHERE id = ?').bind(convId).first<any>();
  if (!conv) return c.json({ error: 'Conversation not found' }, 404);
  if (conv.participant1_ap_id !== actor.ap_id && conv.participant2_ap_id !== actor.ap_id) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  const body = await c.req.json<{ content: string }>();
  if (!body.content?.trim()) return c.json({ error: 'Content required' }, 400);

  const id = generateId();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO dm_messages (id, conversation_id, sender_ap_id, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, convId, actor.ap_id, body.content.trim(), now).run();

  await c.env.DB.prepare('UPDATE dm_conversations SET last_message_at = ? WHERE id = ?').bind(now, convId).run();

  return c.json({
    message: {
      id,
      sender: {
        ap_id: actor.ap_id,
        username: formatUsername(actor.ap_id),
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url,
      },
      content: body.content.trim(),
      created_at: now,
    }
  }, 201);
});

// ============================================================
// MEDIA UPLOAD
// ============================================================

app.post('/api/media/upload', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  if (!file) return c.json({ error: 'No file provided' }, 400);

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'Invalid file type' }, 400);
  }

  const id = generateId();
  const ext = file.name.split('.').pop() || 'bin';
  const r2Key = `uploads/${id}.${ext}`;

  await c.env.MEDIA.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  const url = `${c.env.APP_URL}/media/${r2Key}`;

  return c.json({ url, r2_key: r2Key, content_type: file.type });
});

app.get('/media/*', async (c) => {
  const path = c.req.path.replace('/media/', '');
  const object = await c.env.MEDIA.get(path);
  if (!object) return c.json({ error: 'Not found' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000',
    },
  });
});

// ============================================================
// ACTIVITYPUB ENDPOINTS
// ============================================================

// WebFinger
app.get('/.well-known/webfinger', async (c) => {
  const resource = c.req.query('resource');
  if (!resource) return c.json({ error: 'resource required' }, 400);

  const baseUrl = c.env.APP_URL;
  const domain = getDomain(baseUrl);

  // Parse acct:user@domain
  const match = resource.match(/^acct:([^@]+)@(.+)$/);
  if (!match || match[2] !== domain) return c.json({ error: 'Not found' }, 404);

  const username = match[1];
  const apId = actorApId(baseUrl, username);

  const actor = await c.env.DB.prepare('SELECT ap_id FROM actors WHERE preferred_username = ?').bind(username).first();
  if (!actor) return c.json({ error: 'Not found' }, 404);

  return c.json({
    subject: resource,
    links: [
      {
        rel: 'self',
        type: 'application/activity+json',
        href: apId,
      },
    ],
  });
});

// Actor profile
app.get('/ap/users/:username', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await c.env.DB.prepare('SELECT * FROM actors WHERE ap_id = ?').bind(apId).first<Actor>();
  if (!actor) return c.json({ error: 'Not found' }, 404);

  const actorJson = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
    id: actor.ap_id,
    type: 'Person',
    preferredUsername: actor.preferred_username,
    name: actor.name,
    summary: actor.summary,
    inbox: actor.inbox,
    outbox: actor.outbox,
    followers: actor.followers_url,
    following: actor.following_url,
    icon: actor.icon_url ? {
      type: 'Image',
      mediaType: 'image/png',
      url: actor.icon_url,
    } : undefined,
    image: actor.header_url ? {
      type: 'Image',
      mediaType: 'image/png',
      url: actor.header_url,
    } : undefined,
    publicKey: {
      id: `${actor.ap_id}#main-key`,
      owner: actor.ap_id,
      publicKeyPem: actor.public_key_pem,
    },
  };

  return c.json(actorJson, 200, {
    'Content-Type': 'application/activity+json',
  });
});

// Actor inbox
app.post('/ap/users/:username/inbox', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const localActorApId = actorApId(baseUrl, username);

  const localActor = await c.env.DB.prepare('SELECT * FROM actors WHERE ap_id = ?').bind(localActorApId).first<Actor>();
  if (!localActor) return c.json({ error: 'Not found' }, 404);

  const activity = await c.req.json() as any;
  const activityType = activity.type;
  const actorApIdVal = typeof activity.actor === 'string' ? activity.actor : activity.actor?.id;

  console.log(`Inbox received: ${activityType} from ${actorApIdVal}`);

  // Store activity
  const activityId = activity.id || activityApId(baseUrl, generateId());
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction, processed)
    VALUES (?, ?, ?, ?, ?, 'inbound', 0)
  `).bind(activityId, activityType, actorApIdVal, typeof activity.object === 'string' ? activity.object : activity.object?.id, JSON.stringify(activity)).run();

  // Ensure remote actor is cached
  let remoteActor = await c.env.DB.prepare('SELECT * FROM actor_cache WHERE ap_id = ?').bind(actorApIdVal).first<ActorCache>();
  if (!remoteActor) {
    try {
      const res = await fetch(actorApIdVal, { headers: { 'Accept': 'application/activity+json' } });
      if (res.ok) {
        const actorData = await res.json() as any;
        await c.env.DB.prepare(`
          INSERT INTO actor_cache (ap_id, type, preferred_username, name, summary, icon_url, inbox, outbox, public_key_id, public_key_pem, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          actorData.id, actorData.type, actorData.preferredUsername, actorData.name, actorData.summary,
          actorData.icon?.url, actorData.inbox, actorData.outbox, actorData.publicKey?.id, actorData.publicKey?.publicKeyPem,
          JSON.stringify(actorData)
        ).run();
        remoteActor = await c.env.DB.prepare('SELECT * FROM actor_cache WHERE ap_id = ?').bind(actorApIdVal).first<ActorCache>();
      }
    } catch (e) {
      console.error('Failed to fetch remote actor:', e);
    }
  }

  // Handle activity types
  if (activityType === 'Follow') {
    // Someone wants to follow local user
    const status = localActor.is_private ? 'pending' : 'accepted';

    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO follows (follower_ap_id, following_ap_id, status, activity_ap_id, accepted_at)
      VALUES (?, ?, ?, ?, ${status === 'accepted' ? "datetime('now')" : 'NULL'})
    `).bind(actorApIdVal, localActorApId, status, activityId).run();

    if (status === 'accepted') {
      // Update follower count
      await c.env.DB.prepare('UPDATE actors SET follower_count = follower_count + 1 WHERE ap_id = ?').bind(localActorApId).run();

      // Send Accept
      const acceptId = activityApId(baseUrl, generateId());
      const acceptActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: acceptId,
        type: 'Accept',
        actor: localActorApId,
        object: activity,
      };

      if (remoteActor?.inbox) {
        const keyId = `${localActorApId}#main-key`;
        const headers = await signRequest(localActor.private_key_pem, keyId, 'POST', remoteActor.inbox, JSON.stringify(acceptActivity));

        try {
          await fetch(remoteActor.inbox, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/activity+json' },
            body: JSON.stringify(acceptActivity),
          });
        } catch (e) {
          console.error('Failed to send Accept:', e);
        }
      }
    }

    // Create notification
    const notifId = generateId();
    await c.env.DB.prepare(`
      INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type)
      VALUES (?, ?, ?, ?)
    `).bind(notifId, localActorApId, actorApIdVal, status === 'pending' ? 'follow_request' : 'follow').run();
  }
  else if (activityType === 'Accept') {
    // Our follow was accepted
    const objectId = typeof activity.object === 'string' ? activity.object : activity.object?.id;

    await c.env.DB.prepare(`
      UPDATE follows SET status = 'accepted', accepted_at = datetime('now')
      WHERE activity_ap_id = ? OR (follower_ap_id = ? AND following_ap_id = ?)
    `).bind(objectId, localActorApId, actorApIdVal).run();

    // Update following count
    await c.env.DB.prepare('UPDATE actors SET following_count = following_count + 1 WHERE ap_id = ?').bind(localActorApId).run();
  }
  else if (activityType === 'Undo') {
    const objectType = activity.object?.type;

    if (objectType === 'Follow') {
      // Unfollow
      await c.env.DB.prepare('DELETE FROM follows WHERE follower_ap_id = ? AND following_ap_id = ?')
        .bind(actorApIdVal, localActorApId).run();
      await c.env.DB.prepare('UPDATE actors SET follower_count = follower_count - 1 WHERE ap_id = ? AND follower_count > 0')
        .bind(localActorApId).run();
    }
    else if (objectType === 'Like') {
      const objectApIdVal = typeof activity.object.object === 'string' ? activity.object.object : activity.object.object?.id;
      await c.env.DB.prepare('DELETE FROM likes WHERE actor_ap_id = ? AND object_ap_id = ?')
        .bind(actorApIdVal, objectApIdVal).run();
      await c.env.DB.prepare('UPDATE objects SET like_count = like_count - 1 WHERE ap_id = ? AND like_count > 0')
        .bind(objectApIdVal).run();
    }
  }
  else if (activityType === 'Like') {
    const objectApIdVal = typeof activity.object === 'string' ? activity.object : activity.object?.id;

    // Only process if it's a local object
    if (isLocal(objectApIdVal, baseUrl)) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO likes (actor_ap_id, object_ap_id, activity_ap_id)
        VALUES (?, ?, ?)
      `).bind(actorApIdVal, objectApIdVal, activityId).run();

      await c.env.DB.prepare('UPDATE objects SET like_count = like_count + 1 WHERE ap_id = ?').bind(objectApIdVal).run();

      // Create notification
      const obj = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?').bind(objectApIdVal).first<any>();
      if (obj) {
        const notifId = generateId();
        await c.env.DB.prepare(`
          INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type, object_ap_id)
          VALUES (?, ?, ?, 'like', ?)
        `).bind(notifId, obj.attributed_to, actorApIdVal, objectApIdVal).run();
      }
    }
  }
  else if (activityType === 'Create') {
    const object = activity.object;
    if (object?.type === 'Note') {
      // Cache remote post
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO objects (ap_id, type, attributed_to, content, summary, in_reply_to, visibility, published, is_local, raw_json)
        VALUES (?, 'Note', ?, ?, ?, ?, 'public', ?, 0, ?)
      `).bind(
        object.id,
        actorApIdVal,
        object.content || '',
        object.summary,
        object.inReplyTo,
        object.published || new Date().toISOString(),
        JSON.stringify(object)
      ).run();

      // If it's a reply to a local object, update reply count and notify
      if (object.inReplyTo && isLocal(object.inReplyTo, baseUrl)) {
        await c.env.DB.prepare('UPDATE objects SET reply_count = reply_count + 1 WHERE ap_id = ?').bind(object.inReplyTo).run();

        const parent = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?').bind(object.inReplyTo).first<any>();
        if (parent) {
          const notifId = generateId();
          await c.env.DB.prepare(`
            INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type, object_ap_id)
            VALUES (?, ?, ?, 'reply', ?)
          `).bind(notifId, parent.attributed_to, actorApIdVal, object.id).run();
        }
      }
    }
  }
  else if (activityType === 'Delete') {
    const objectApIdVal = typeof activity.object === 'string' ? activity.object : activity.object?.id;

    // Delete if it's from the same actor
    await c.env.DB.prepare('DELETE FROM objects WHERE ap_id = ? AND attributed_to = ?')
      .bind(objectApIdVal, actorApIdVal).run();
  }

  // Mark activity as processed
  await c.env.DB.prepare('UPDATE activities SET processed = 1 WHERE ap_id = ?').bind(activityId).run();

  return c.json({ success: true }, 202);
});

// Actor outbox
app.get('/ap/users/:username/outbox', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const actor = await c.env.DB.prepare('SELECT ap_id FROM actors WHERE ap_id = ?').bind(apId).first();
  if (!actor) return c.json({ error: 'Not found' }, 404);

  const posts = await c.env.DB.prepare(`
    SELECT ap_id, content, published FROM objects
    WHERE attributed_to = ? AND visibility = 'public' AND is_local = 1
    ORDER BY published DESC
    LIMIT 20
  `).bind(apId).all();

  const items = (posts.results || []).map((p: any) => ({
    type: 'Create',
    actor: apId,
    published: p.published,
    object: {
      id: p.ap_id,
      type: 'Note',
      attributedTo: apId,
      content: p.content,
      published: p.published,
    },
  }));

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${apId}/outbox`,
    type: 'OrderedCollection',
    totalItems: items.length,
    orderedItems: items,
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Actor followers collection
app.get('/ap/users/:username/followers', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const followers = await c.env.DB.prepare(`
    SELECT follower_ap_id FROM follows WHERE following_ap_id = ? AND status = 'accepted'
  `).bind(apId).all();

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${apId}/followers`,
    type: 'OrderedCollection',
    totalItems: followers.results?.length || 0,
    orderedItems: (followers.results || []).map((f: any) => f.follower_ap_id),
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Actor following collection
app.get('/ap/users/:username/following', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const following = await c.env.DB.prepare(`
    SELECT following_ap_id FROM follows WHERE follower_ap_id = ? AND status = 'accepted'
  `).bind(apId).all();

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${apId}/following`,
    type: 'OrderedCollection',
    totalItems: following.results?.length || 0,
    orderedItems: (following.results || []).map((f: any) => f.following_ap_id),
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Object endpoint
app.get('/ap/objects/:id', async (c) => {
  const id = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = objectApId(baseUrl, id);

  const obj = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ?').bind(apId).first<APObject>();
  if (!obj) return c.json({ error: 'Not found' }, 404);

  const actor = await c.env.DB.prepare('SELECT followers_url FROM actors WHERE ap_id = ?').bind(obj.attributed_to).first<any>();

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: obj.ap_id,
    type: obj.type,
    attributedTo: obj.attributed_to,
    content: obj.content,
    summary: obj.summary,
    inReplyTo: obj.in_reply_to,
    published: obj.published,
    to: obj.visibility === 'public' ? ['https://www.w3.org/ns/activitystreams#Public'] : [],
    cc: actor?.followers_url ? [actor.followers_url] : [],
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// ============================================================
// FALLBACK TO STATIC ASSETS
// ============================================================

app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
