import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  TAKOS_URL: string;
  TAKOS_CLIENT_ID: string;
  TAKOS_CLIENT_SECRET: string;
  APP_URL: string;
  AUTH_MODE?: string;       // 'oauth' or 'password'
  AUTH_PASSWORD?: string;   // Password for password auth mode
};

type Variables = {
  member: Member | null;
};

interface Member {
  id: string;
  takos_user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role: 'owner' | 'moderator' | 'member';
  bio?: string | null;
}

interface Room {
  id: string;
  name: string;
  description: string | null;
  kind: 'chat' | 'forum';
  posting_policy: 'members' | 'mods' | 'owners';
  join_policy: 'open' | 'inviteOnly' | 'moderated';
  sort_order: number;
}

interface Message {
  id: string;
  room_id: string;
  member_id: string;
  content: string;
  reply_to_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Thread {
  id: string;
  room_id: string;
  member_id: string;
  title: string;
  content: string | null;
  pinned: number;
  locked: number;
  reply_count: number;
  last_reply_at: string | null;
  created_at: string;
}

interface ThreadReply {
  id: string;
  thread_id: string;
  member_id: string;
  content: string;
  created_at: string;
}

interface DMConversation {
  id: string;
  member1_id: string;
  member2_id: string;
  last_message_at: string | null;
  created_at: string;
}

// ===== v4.0 Social Network Types =====

interface Post {
  id: string;
  member_id: string;
  content: string;
  reply_to_id: string | null;
  repost_of_id: string | null;
  visibility: 'public' | 'followers' | 'private';
  like_count: number;
  reply_count: number;
  repost_count: number;
  created_at: string;
  updated_at: string;
}

interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  accepted_at: string | null;
}

interface Notification {
  id: string;
  member_id: string;
  actor_id: string;
  type: 'follow_request' | 'follow_accepted' | 'like' | 'reply' | 'repost' | 'mention';
  target_type: 'post' | 'member' | null;
  target_id: string | null;
  read: number;
  created_at: string;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper functions
function generateId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// PKCE helper functions
function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Auth middleware
app.use('/api/*', async (c, next) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    const session = await c.env.DB.prepare(
      `SELECT s.*, m.* FROM sessions s
       JOIN members m ON s.member_id = m.id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    ).bind(sessionId).first();

    if (session) {
      c.set('member', {
        id: session.member_id as string,
        takos_user_id: session.takos_user_id as string,
        username: session.username as string,
        display_name: session.display_name as string | null,
        avatar_url: session.avatar_url as string | null,
        role: session.role as 'owner' | 'moderator' | 'member',
        bio: session.bio as string | null,
      });
    }
  }
  await next();
});

// ==================== Auth Routes ====================

// Get auth mode
app.get('/api/auth/mode', (c) => {
  const mode = c.env.AUTH_MODE || 'oauth';
  return c.json({ mode });
});

// Password authentication
app.post('/api/auth/password', async (c) => {
  const authMode = c.env.AUTH_MODE || 'oauth';
  if (authMode !== 'password') {
    return c.json({ error: 'Password auth is disabled' }, 400);
  }

  const body = await c.req.json<{ username: string; password: string }>();
  if (!body.username || !body.password) {
    return c.json({ error: 'Username and password required' }, 400);
  }

  // Check password
  if (body.password !== c.env.AUTH_PASSWORD) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  // Find or create member by username
  let member = await c.env.DB.prepare(
    'SELECT * FROM members WHERE username = ?'
  ).bind(body.username).first<Member>();

  if (!member) {
    // First user becomes owner
    const memberCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM members').first<{ count: number }>();
    const role = memberCount?.count === 0 ? 'owner' : 'member';

    const memberId = generateId();
    await c.env.DB.prepare(
      `INSERT INTO members (id, takos_user_id, username, display_name, role)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(memberId, `local:${body.username}`, body.username, body.username, role).run();

    member = {
      id: memberId,
      takos_user_id: `local:${body.username}`,
      username: body.username,
      display_name: body.username,
      avatar_url: null,
      role: role as 'owner' | 'moderator' | 'member',
    };
  }

  // Create session (30 days)
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, member_id, access_token, expires_at)
     VALUES (?, ?, ?, ?)`
  ).bind(sessionId, member.id, 'password_auth', expiresAt).run();

  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });

  return c.json({ success: true, member });
});

// OAuth login
app.get('/api/auth/login', async (c) => {
  const authMode = c.env.AUTH_MODE || 'oauth';
  if (authMode !== 'oauth') {
    return c.redirect('/');
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const takosUrl = c.env.TAKOS_URL || 'https://takos.jp';
  const appUrl = c.env.APP_URL || 'https://app.yurucommu.com';

  setCookie(c, 'oauth_state', state, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 600, path: '/' });
  setCookie(c, 'oauth_verifier', codeVerifier, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 600, path: '/' });

  const authUrl = new URL(`${takosUrl}/oauth/authorize`);
  authUrl.searchParams.set('client_id', c.env.TAKOS_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', `${appUrl}/api/auth/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return c.redirect(authUrl.toString());
});

// OAuth callback
app.get('/api/auth/callback', async (c) => {
  const { code, state } = c.req.query();
  const savedState = getCookie(c, 'oauth_state');
  const codeVerifier = getCookie(c, 'oauth_verifier');

  if (!code || !state || state !== savedState || !codeVerifier) {
    return c.json({ error: 'Invalid state or missing verifier' }, 400);
  }

  deleteCookie(c, 'oauth_state');
  deleteCookie(c, 'oauth_verifier');

  const takosUrl = c.env.TAKOS_URL || 'https://takos.jp';
  const appUrl = c.env.APP_URL || 'https://app.yurucommu.com';

  const tokenRes = await fetch(`${takosUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${appUrl}/api/auth/callback`,
      client_id: c.env.TAKOS_CLIENT_ID,
      client_secret: c.env.TAKOS_CLIENT_SECRET,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    return c.json({ error: 'Token exchange failed' }, 400);
  }

  const tokens = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in: number };

  const userRes = await fetch(`${takosUrl}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return c.json({ error: 'Failed to get user info' }, 400);
  }

  const userInfo = await userRes.json() as { sub: string; preferred_username?: string; name?: string; picture?: string };

  let member = await c.env.DB.prepare('SELECT * FROM members WHERE takos_user_id = ?').bind(userInfo.sub).first<Member>();

  if (!member) {
    const memberCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM members').first<{ count: number }>();
    const role = memberCount?.count === 0 ? 'owner' : 'member';

    const memberId = generateId();
    await c.env.DB.prepare(
      `INSERT INTO members (id, takos_user_id, username, display_name, avatar_url, role)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(memberId, userInfo.sub, userInfo.preferred_username || `user_${memberId.slice(0, 8)}`, userInfo.name || null, userInfo.picture || null, role).run();

    member = {
      id: memberId,
      takos_user_id: userInfo.sub,
      username: userInfo.preferred_username || `user_${memberId.slice(0, 8)}`,
      display_name: userInfo.name || null,
      avatar_url: userInfo.picture || null,
      role: role as 'owner' | 'moderator' | 'member',
    };
  }

  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, member_id, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(sessionId, member.id, tokens.access_token, tokens.refresh_token || null, expiresAt).run();

  setCookie(c, 'session', sessionId, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: tokens.expires_in, path: '/' });

  return c.redirect('/');
});

app.get('/api/auth/logout', async (c) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  }
  deleteCookie(c, 'session');
  return c.redirect('/');
});

app.get('/api/me', async (c) => {
  const member = c.get('member');
  if (!member) {
    return c.json({ authenticated: false }, 401);
  }
  return c.json({ authenticated: true, member });
});

// Update profile
app.put('/api/me/profile', async (c) => {
  const member = c.get('member');
  if (!member) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json<{ display_name?: string; bio?: string }>();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.display_name !== undefined) {
    updates.push('display_name = ?');
    values.push(body.display_name);
  }
  if (body.bio !== undefined) {
    updates.push('bio = ?');
    values.push(body.bio);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(member.id);

  await c.env.DB.prepare(`UPDATE members SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  return c.json({ success: true });
});

// ==================== Rooms API ====================

app.get('/api/rooms', async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM rooms ORDER BY sort_order ASC, created_at ASC').all<Room>();
  return c.json({ rooms: result.results || [] });
});

app.post('/api/rooms', async (c) => {
  const member = c.get('member');
  if (!member || (member.role !== 'owner' && member.role !== 'moderator')) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  const body = await c.req.json<{ name: string; description?: string; kind?: string; join_policy?: string }>();
  if (!body.name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const id = generateId();
  await c.env.DB.prepare(
    `INSERT INTO rooms (id, name, description, kind, join_policy) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, body.name, body.description || null, body.kind || 'chat', body.join_policy || 'open').run();

  return c.json({ id, name: body.name, description: body.description || null, kind: body.kind || 'chat', join_policy: body.join_policy || 'open' }, 201);
});

app.get('/api/rooms/:id', async (c) => {
  const id = c.req.param('id');
  const room = await c.env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first<Room>();
  if (!room) {
    return c.json({ error: 'Room not found' }, 404);
  }
  return c.json({ room });
});

app.put('/api/rooms/:id', async (c) => {
  const member = c.get('member');
  if (!member || (member.role !== 'owner' && member.role !== 'moderator')) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; description?: string; posting_policy?: string; join_policy?: string; kind?: string }>();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name); }
  if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description); }
  if (body.posting_policy !== undefined) { updates.push('posting_policy = ?'); values.push(body.posting_policy); }
  if (body.join_policy !== undefined) { updates.push('join_policy = ?'); values.push(body.join_policy); }
  if (body.kind !== undefined) { updates.push('kind = ?'); values.push(body.kind); }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  await c.env.DB.prepare(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const room = await c.env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first<Room>();
  return c.json({ success: true, room });
});

app.delete('/api/rooms/:id', async (c) => {
  const member = c.get('member');
  if (!member || member.role !== 'owner') {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ==================== Messages API (Chat rooms) ====================

app.get('/api/rooms/:roomId/messages', async (c) => {
  const roomId = c.req.param('roomId');
  const before = c.req.query('before');
  const since = c.req.query('since');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

  let query = `SELECT m.*, mem.username, mem.display_name, mem.avatar_url FROM messages m JOIN members mem ON m.member_id = mem.id WHERE m.room_id = ?`;
  const params: unknown[] = [roomId];

  if (before) { query += ' AND m.created_at < ?'; params.push(before); }
  if (since) { query += ' AND m.created_at > ?'; params.push(since); }

  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);

  const result = await c.env.DB.prepare(query).bind(...params).all();
  const messages = (result.results || []).reverse();

  if (messages.length > 0) {
    const messageIds = messages.map((m: any) => m.id);
    const placeholders = messageIds.map(() => '?').join(',');
    const attachmentsResult = await c.env.DB.prepare(`SELECT * FROM attachments WHERE message_id IN (${placeholders})`).bind(...messageIds).all();

    const attachmentsByMessage = new Map<string, any[]>();
    for (const att of attachmentsResult.results || []) {
      const msgId = (att as any).message_id;
      if (!attachmentsByMessage.has(msgId)) attachmentsByMessage.set(msgId, []);
      attachmentsByMessage.get(msgId)!.push(att);
    }

    for (const msg of messages as any[]) {
      msg.attachments = attachmentsByMessage.get(msg.id) || [];
    }
  }

  return c.json({ messages });
});

app.post('/api/rooms/:roomId/messages', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const roomId = c.req.param('roomId');
  const room = await c.env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first<Room>();
  if (!room) return c.json({ error: 'Room not found' }, 404);

  if (room.posting_policy === 'owners' && member.role !== 'owner') return c.json({ error: 'Only owners can post' }, 403);
  if (room.posting_policy === 'mods' && member.role === 'member') return c.json({ error: 'Only moderators can post' }, 403);

  const body = await c.req.json<{ content: string; reply_to_id?: string; attachments?: Array<{ r2_key: string; content_type: string; filename: string; size: number }> }>();
  if (!body.content && (!body.attachments || body.attachments.length === 0)) return c.json({ error: 'Content or attachments required' }, 400);

  const id = generateId();
  const now = new Date().toISOString();
  const baseUrl = c.env.APP_URL;
  const noteId = `${baseUrl}/ap/notes/${id}`;
  const contextId = `${baseUrl}/ap/rooms/${roomId}`; // chat rooms use room as context

  await c.env.DB.prepare(
    `INSERT INTO messages (id, room_id, member_id, content, reply_to_id, ap_note_id, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, roomId, member.id, body.content || '', body.reply_to_id || null, noteId, contextId, now, now).run();

  const savedAttachments: any[] = [];
  if (body.attachments?.length) {
    for (const att of body.attachments) {
      const attId = generateId();
      await c.env.DB.prepare(`INSERT INTO attachments (id, message_id, r2_key, content_type, filename, size) VALUES (?, ?, ?, ?, ?, ?)`).bind(attId, id, att.r2_key, att.content_type, att.filename, att.size).run();
      savedAttachments.push({ id: attId, ...att });
    }
  }

  // ActivityPub: Announce to remote followers
  const remoteFollowers = await c.env.DB.prepare(`
    SELECT ra.* FROM ap_remote_actors ra
    JOIN ap_followers af ON ra.id = af.actor_id
    WHERE af.accepted = 1
  `).all();

  if (remoteFollowers.results && remoteFollowers.results.length > 0) {
    try {
      const { privateKeyPem } = await getOrCreateKeyPair(c.env.DB);
      const keyId = `${baseUrl}/ap/actor#main-key`;

      // Create Note object
      const noteObject = {
        type: 'Note',
        id: noteId,
        attributedTo: `${baseUrl}/ap/actor`,
        to: [`${baseUrl}/ap/actor/followers`],
        content: body.content || '',
        room: `${baseUrl}/ap/rooms/${roomId}`,
        context: `${baseUrl}/ap/rooms/${roomId}`,
        published: now
      };

      // Create Announce activity (with routing metadata)
      const announceActivity = {
        '@context': AP_CONTEXT,
        id: `${baseUrl}/ap/activities/${generateId()}`,
        type: 'Announce',
        actor: `${baseUrl}/ap/actor`,
        to: [`${baseUrl}/ap/actor/followers`],
        object: noteObject,
        room: `${baseUrl}/ap/rooms/${roomId}`,
        context: contextId,
        published: now
      };

      // Store outbound activity
      await c.env.DB.prepare(
        'INSERT INTO ap_activities (id, activity_id, activity_type, actor, object, raw_json, direction) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(generateId(), announceActivity.id, 'Announce', `${baseUrl}/ap/actor`, JSON.stringify(noteObject), JSON.stringify(announceActivity), 'outbound').run();

      // Queue deliveries for each remote follower
      for (const follower of remoteFollowers.results as any[]) {
        if (follower.inbox) {
          await queueDelivery(c.env.DB, announceActivity.id, follower.inbox);
        }
      }

      // Try immediate delivery (async, don't block response)
      processDeliveryQueue(c.env.DB, privateKeyPem, keyId).catch(e => {
        console.error('Failed to process delivery queue:', e);
      });
    } catch (e) {
      console.error('Failed to announce message:', e);
    }
  }

  return c.json({ id, room_id: roomId, member_id: member.id, content: body.content || '', reply_to_id: body.reply_to_id || null, created_at: now, updated_at: now, username: member.username, display_name: member.display_name, avatar_url: member.avatar_url, attachments: savedAttachments }, 201);
});

app.put('/api/rooms/:roomId/messages/:id', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const message = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<Message>();
  if (!message) return c.json({ error: 'Message not found' }, 404);
  if (message.member_id !== member.id) return c.json({ error: 'Can only edit your own messages' }, 403);

  const body = await c.req.json<{ content: string }>();
  if (!body.content) return c.json({ error: 'Content is required' }, 400);

  await c.env.DB.prepare("UPDATE messages SET content = ?, updated_at = datetime('now') WHERE id = ?").bind(body.content, id).run();
  return c.json({ success: true });
});

app.delete('/api/rooms/:roomId/messages/:id', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const id = c.req.param('id');
  const message = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<Message>();
  if (!message) return c.json({ error: 'Message not found' }, 404);
  if (message.member_id !== member.id && member.role === 'member') return c.json({ error: 'Cannot delete this message' }, 403);

  await c.env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ==================== Threads API (Forum rooms) ====================

app.get('/api/rooms/:roomId/threads', async (c) => {
  const roomId = c.req.param('roomId');
  const limit = Math.min(parseInt(c.req.query('limit') || '30'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const result = await c.env.DB.prepare(`
    SELECT t.*, m.username, m.display_name, m.avatar_url
    FROM threads t
    JOIN members m ON t.member_id = m.id
    WHERE t.room_id = ?
    ORDER BY t.pinned DESC, t.last_reply_at DESC NULLS LAST, t.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(roomId, limit, offset).all();

  return c.json({ threads: result.results || [] });
});

app.post('/api/rooms/:roomId/threads', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const roomId = c.req.param('roomId');
  const room = await c.env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first<Room>();
  if (!room) return c.json({ error: 'Room not found' }, 404);
  if (room.kind !== 'forum') return c.json({ error: 'This room is not a forum' }, 400);

  const body = await c.req.json<{ title: string; content?: string }>();
  if (!body.title) return c.json({ error: 'Title is required' }, 400);

  const id = generateId();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`INSERT INTO threads (id, room_id, member_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, roomId, member.id, body.title, body.content || null, now, now).run();

  return c.json({ id, room_id: roomId, member_id: member.id, title: body.title, content: body.content || null, pinned: 0, locked: 0, reply_count: 0, last_reply_at: null, created_at: now, username: member.username, display_name: member.display_name, avatar_url: member.avatar_url }, 201);
});

app.get('/api/rooms/:roomId/threads/:threadId', async (c) => {
  const threadId = c.req.param('threadId');
  const thread = await c.env.DB.prepare(`
    SELECT t.*, m.username, m.display_name, m.avatar_url
    FROM threads t
    JOIN members m ON t.member_id = m.id
    WHERE t.id = ?
  `).bind(threadId).first();

  if (!thread) return c.json({ error: 'Thread not found' }, 404);
  return c.json({ thread });
});

app.put('/api/rooms/:roomId/threads/:threadId', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const threadId = c.req.param('threadId');
  const thread = await c.env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(threadId).first<Thread>();
  if (!thread) return c.json({ error: 'Thread not found' }, 404);
  if (thread.member_id !== member.id && member.role === 'member') return c.json({ error: 'Cannot edit this thread' }, 403);

  const body = await c.req.json<{ title?: string; content?: string }>();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
  if (body.content !== undefined) { updates.push('content = ?'); values.push(body.content); }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);

  updates.push("updated_at = datetime('now')");
  values.push(threadId);

  await c.env.DB.prepare(`UPDATE threads SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return c.json({ success: true });
});

app.delete('/api/rooms/:roomId/threads/:threadId', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const threadId = c.req.param('threadId');
  const thread = await c.env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(threadId).first<Thread>();
  if (!thread) return c.json({ error: 'Thread not found' }, 404);
  if (thread.member_id !== member.id && member.role === 'member') return c.json({ error: 'Cannot delete this thread' }, 403);

  await c.env.DB.prepare('DELETE FROM threads WHERE id = ?').bind(threadId).run();
  return c.json({ success: true });
});

// Pin/Lock thread
app.post('/api/rooms/:roomId/threads/:threadId/pin', async (c) => {
  const member = c.get('member');
  if (!member || member.role === 'member') return c.json({ error: 'Unauthorized' }, 403);

  const threadId = c.req.param('threadId');
  const thread = await c.env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(threadId).first<Thread>();
  if (!thread) return c.json({ error: 'Thread not found' }, 404);

  const newPinned = thread.pinned ? 0 : 1;
  await c.env.DB.prepare('UPDATE threads SET pinned = ? WHERE id = ?').bind(newPinned, threadId).run();
  return c.json({ success: true, pinned: newPinned });
});

app.post('/api/rooms/:roomId/threads/:threadId/lock', async (c) => {
  const member = c.get('member');
  if (!member || member.role === 'member') return c.json({ error: 'Unauthorized' }, 403);

  const threadId = c.req.param('threadId');
  const thread = await c.env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(threadId).first<Thread>();
  if (!thread) return c.json({ error: 'Thread not found' }, 404);

  const newLocked = thread.locked ? 0 : 1;
  await c.env.DB.prepare('UPDATE threads SET locked = ? WHERE id = ?').bind(newLocked, threadId).run();
  return c.json({ success: true, locked: newLocked });
});

// Thread replies
app.get('/api/threads/:threadId/replies', async (c) => {
  const threadId = c.req.param('threadId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const result = await c.env.DB.prepare(`
    SELECT r.*, m.username, m.display_name, m.avatar_url
    FROM thread_replies r
    JOIN members m ON r.member_id = m.id
    WHERE r.thread_id = ?
    ORDER BY r.created_at ASC
    LIMIT ? OFFSET ?
  `).bind(threadId, limit, offset).all();

  return c.json({ replies: result.results || [] });
});

app.post('/api/threads/:threadId/replies', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const threadId = c.req.param('threadId');
  const thread = await c.env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(threadId).first<Thread>();
  if (!thread) return c.json({ error: 'Thread not found' }, 404);
  if (thread.locked) return c.json({ error: 'Thread is locked' }, 403);

  const body = await c.req.json<{ content: string }>();
  if (!body.content) return c.json({ error: 'Content is required' }, 400);

  const id = generateId();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`INSERT INTO thread_replies (id, thread_id, member_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(id, threadId, member.id, body.content, now, now).run();

  // Update thread stats
  await c.env.DB.prepare(`UPDATE threads SET reply_count = reply_count + 1, last_reply_at = ? WHERE id = ?`).bind(now, threadId).run();

  return c.json({ id, thread_id: threadId, member_id: member.id, content: body.content, created_at: now, username: member.username, display_name: member.display_name, avatar_url: member.avatar_url }, 201);
});

app.delete('/api/threads/:threadId/replies/:replyId', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const replyId = c.req.param('replyId');
  const reply = await c.env.DB.prepare('SELECT * FROM thread_replies WHERE id = ?').bind(replyId).first<ThreadReply>();
  if (!reply) return c.json({ error: 'Reply not found' }, 404);
  if (reply.member_id !== member.id && member.role === 'member') return c.json({ error: 'Cannot delete this reply' }, 403);

  await c.env.DB.prepare('DELETE FROM thread_replies WHERE id = ?').bind(replyId).run();
  await c.env.DB.prepare('UPDATE threads SET reply_count = reply_count - 1 WHERE id = ?').bind(reply.thread_id).run();

  return c.json({ success: true });
});

// ==================== DM API ====================

app.get('/api/dm/conversations', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const result = await c.env.DB.prepare(`
    SELECT c.*,
      m1.username as member1_username, m1.display_name as member1_display_name, m1.avatar_url as member1_avatar_url,
      m2.username as member2_username, m2.display_name as member2_display_name, m2.avatar_url as member2_avatar_url
    FROM dm_conversations c
    JOIN members m1 ON c.member1_id = m1.id
    JOIN members m2 ON c.member2_id = m2.id
    WHERE c.member1_id = ? OR c.member2_id = ?
    ORDER BY c.last_message_at DESC NULLS LAST
  `).bind(member.id, member.id).all();

  return c.json({ conversations: result.results || [] });
});

app.post('/api/dm/conversations', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ member_id: string }>();
  if (!body.member_id) return c.json({ error: 'member_id is required' }, 400);
  if (body.member_id === member.id) return c.json({ error: 'Cannot start conversation with yourself' }, 400);

  // Check if conversation already exists
  const existing = await c.env.DB.prepare(`
    SELECT * FROM dm_conversations
    WHERE (member1_id = ? AND member2_id = ?) OR (member1_id = ? AND member2_id = ?)
  `).bind(member.id, body.member_id, body.member_id, member.id).first();

  if (existing) return c.json({ conversation: existing });

  // Create new conversation
  const id = generateId();
  await c.env.DB.prepare(`INSERT INTO dm_conversations (id, member1_id, member2_id) VALUES (?, ?, ?)`).bind(id, member.id, body.member_id).run();

  const conversation = await c.env.DB.prepare(`
    SELECT c.*,
      m1.username as member1_username, m1.display_name as member1_display_name, m1.avatar_url as member1_avatar_url,
      m2.username as member2_username, m2.display_name as member2_display_name, m2.avatar_url as member2_avatar_url
    FROM dm_conversations c
    JOIN members m1 ON c.member1_id = m1.id
    JOIN members m2 ON c.member2_id = m2.id
    WHERE c.id = ?
  `).bind(id).first();

  return c.json({ conversation }, 201);
});

app.get('/api/dm/conversations/:conversationId/messages', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const conversationId = c.req.param('conversationId');

  // Verify access
  const conversation = await c.env.DB.prepare('SELECT * FROM dm_conversations WHERE id = ?').bind(conversationId).first<DMConversation>();
  if (!conversation) return c.json({ error: 'Conversation not found' }, 404);
  if (conversation.member1_id !== member.id && conversation.member2_id !== member.id) return c.json({ error: 'Unauthorized' }, 403);

  const before = c.req.query('before');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

  let query = `SELECT dm.*, m.username, m.display_name, m.avatar_url FROM dm_messages dm JOIN members m ON dm.sender_id = m.id WHERE dm.conversation_id = ?`;
  const params: unknown[] = [conversationId];

  if (before) { query += ' AND dm.created_at < ?'; params.push(before); }

  query += ' ORDER BY dm.created_at DESC LIMIT ?';
  params.push(limit);

  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ messages: (result.results || []).reverse() });
});

app.post('/api/dm/conversations/:conversationId/messages', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const conversationId = c.req.param('conversationId');

  // Verify access
  const conversation = await c.env.DB.prepare('SELECT * FROM dm_conversations WHERE id = ?').bind(conversationId).first<DMConversation>();
  if (!conversation) return c.json({ error: 'Conversation not found' }, 404);
  if (conversation.member1_id !== member.id && conversation.member2_id !== member.id) return c.json({ error: 'Unauthorized' }, 403);

  const body = await c.req.json<{ content: string }>();
  if (!body.content) return c.json({ error: 'Content is required' }, 400);

  const id = generateId();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`INSERT INTO dm_messages (id, conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)`).bind(id, conversationId, member.id, body.content, now).run();

  // Update conversation
  await c.env.DB.prepare('UPDATE dm_conversations SET last_message_at = ? WHERE id = ?').bind(now, conversationId).run();

  return c.json({ id, conversation_id: conversationId, sender_id: member.id, content: body.content, created_at: now, username: member.username, display_name: member.display_name, avatar_url: member.avatar_url }, 201);
});

// ==================== Members API ====================

app.get('/api/members', async (c) => {
  const result = await c.env.DB.prepare('SELECT id, username, display_name, avatar_url, role, bio, is_remote, ap_actor_id, created_at FROM members ORDER BY created_at ASC').all();
  return c.json({ members: result.results || [] });
});

app.get('/api/members/:id', async (c) => {
  const id = c.req.param('id');
  const member = await c.env.DB.prepare('SELECT id, username, display_name, avatar_url, role, bio, is_remote, ap_actor_id, created_at FROM members WHERE id = ?').bind(id).first();
  if (!member) return c.json({ error: 'Member not found' }, 404);
  return c.json({ member });
});

// Get member profile with follow stats
app.get('/api/members/:id/profile', async (c) => {
  const currentMember = c.get('member');
  const id = c.req.param('id');

  const member = await c.env.DB.prepare(`
    SELECT id, username, display_name, avatar_url, header_url, role, bio, is_remote, ap_actor_id,
           follower_count, following_count, post_count, created_at
    FROM members WHERE id = ?
  `).bind(id).first();

  if (!member) return c.json({ error: 'Member not found' }, 404);

  // Check if current user is following this member
  let is_following = false;
  let is_followed_by = false;

  if (currentMember && currentMember.id !== id) {
    const followStatus = await c.env.DB.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND status = 'accepted') as is_following,
        EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND status = 'accepted') as is_followed_by
    `).bind(currentMember.id, id, id, currentMember.id).first<{ is_following: number; is_followed_by: number }>();

    if (followStatus) {
      is_following = !!followStatus.is_following;
      is_followed_by = !!followStatus.is_followed_by;
    }
  }

  return c.json({
    member: {
      ...member,
      is_following,
      is_followed_by,
    }
  });
});

app.put('/api/members/:id/role', async (c) => {
  const currentMember = c.get('member');
  if (!currentMember || currentMember.role !== 'owner') return c.json({ error: 'Only owners can change roles' }, 403);

  const id = c.req.param('id');
  const body = await c.req.json<{ role: string }>();
  if (!['owner', 'moderator', 'member'].includes(body.role)) return c.json({ error: 'Invalid role' }, 400);

  await c.env.DB.prepare("UPDATE members SET role = ?, updated_at = datetime('now') WHERE id = ?").bind(body.role, id).run();
  return c.json({ success: true });
});

app.delete('/api/members/:id', async (c) => {
  const currentMember = c.get('member');
  if (!currentMember || (currentMember.role !== 'owner' && currentMember.role !== 'moderator')) return c.json({ error: 'Unauthorized' }, 403);

  const id = c.req.param('id');
  if (id === currentMember.id) return c.json({ error: 'Cannot delete yourself' }, 400);

  const targetMember = await c.env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first<Member>();
  if (!targetMember) return c.json({ error: 'Member not found' }, 404);
  if (targetMember.role === 'owner') return c.json({ error: 'Cannot delete an owner' }, 403);

  await c.env.DB.prepare('DELETE FROM sessions WHERE member_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM members WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ==================== ActivityPub Invite/BAN API ====================

// Send Invite to remote actor
app.post('/api/ap/invite', async (c) => {
  const member = c.get('member');
  if (!member || (member.role !== 'owner' && member.role !== 'moderator')) {
    return c.json({ error: 'Only owners/moderators can invite' }, 403);
  }

  const body = await c.req.json<{ actor_id: string }>();
  if (!body.actor_id) return c.json({ error: 'actor_id required' }, 400);

  const baseUrl = c.env.APP_URL;

  // Check if already invited
  const existing = await c.env.DB.prepare('SELECT * FROM ap_invites WHERE actor_id = ?').bind(body.actor_id).first();
  if (existing) return c.json({ error: 'Already invited' }, 400);

  // Fetch actor info
  let actorInbox: string | null = null;
  try {
    const actorResponse = await fetch(body.actor_id, { headers: { Accept: 'application/activity+json' } });
    if (actorResponse.ok) {
      const actorData: any = await actorResponse.json();
      actorInbox = actorData.inbox;

      // Store remote actor
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO ap_remote_actors (id, actor_type, preferred_username, name, summary, inbox, outbox, followers, following, public_key_id, public_key_pem, icon_url, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        body.actor_id,
        actorData.type || 'Person',
        actorData.preferredUsername,
        actorData.name,
        actorData.summary,
        actorData.inbox,
        actorData.outbox,
        actorData.followers,
        actorData.following,
        actorData.publicKey?.id,
        actorData.publicKey?.publicKeyPem,
        actorData.icon?.url || actorData.icon,
        JSON.stringify(actorData)
      ).run();
    }
  } catch (e) {
    return c.json({ error: 'Failed to fetch actor' }, 400);
  }

  if (!actorInbox) return c.json({ error: 'Could not find actor inbox' }, 400);

  // Create invite record
  const inviteId = generateId();
  await c.env.DB.prepare(
    'INSERT INTO ap_invites (id, actor_id, invited_by, created_at) VALUES (?, ?, ?, datetime("now"))'
  ).bind(inviteId, body.actor_id, member.id).run();

  // Send Invite activity
  const { privateKeyPem } = await getOrCreateKeyPair(c.env.DB);
  const inviteActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${baseUrl}/ap/activities/${inviteId}`,
    type: 'Invite',
    actor: `${baseUrl}/ap/actor`,
    object: `${baseUrl}/ap/actor`,
    to: [body.actor_id]
  };

  await deliverActivity(inviteActivity, actorInbox, privateKeyPem, `${baseUrl}/ap/actor#main-key`);

  // Store outbound activity
  await c.env.DB.prepare(
    'INSERT INTO ap_activities (id, activity_id, activity_type, actor, object, raw_json, direction) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(generateId(), inviteActivity.id, 'Invite', `${baseUrl}/ap/actor`, body.actor_id, JSON.stringify(inviteActivity), 'outbound').run();

  return c.json({ success: true, invite_id: inviteId });
});

// Get invites list
app.get('/api/ap/invites', async (c) => {
  const member = c.get('member');
  if (!member || (member.role !== 'owner' && member.role !== 'moderator')) {
    return c.json({ error: 'Only owners/moderators can view invites' }, 403);
  }

  const invites = await c.env.DB.prepare(`
    SELECT i.*, ra.preferred_username, ra.name, ra.icon_url
    FROM ap_invites i
    LEFT JOIN ap_remote_actors ra ON i.actor_id = ra.id
    ORDER BY i.created_at DESC
  `).all();

  return c.json({ invites: invites.results || [] });
});

// Delete invite
app.delete('/api/ap/invites/:id', async (c) => {
  const member = c.get('member');
  if (!member || (member.role !== 'owner' && member.role !== 'moderator')) {
    return c.json({ error: 'Only owners/moderators can delete invites' }, 403);
  }

  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM ap_invites WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// BAN remote actor (Remove activity)
app.post('/api/ap/ban', async (c) => {
  const member = c.get('member');
  if (!member || (member.role !== 'owner' && member.role !== 'moderator')) {
    return c.json({ error: 'Only owners/moderators can ban' }, 403);
  }

  const body = await c.req.json<{ actor_id: string; reason?: string }>();
  if (!body.actor_id) return c.json({ error: 'actor_id required' }, 400);

  const baseUrl = c.env.APP_URL;

  // Add to ban list
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO ap_bans (id, actor_id, reason, banned_by, created_at) VALUES (?, ?, ?, ?, datetime("now"))'
  ).bind(generateId(), body.actor_id, body.reason || null, member.id).run();

  // Remove from followers
  await c.env.DB.prepare('DELETE FROM ap_followers WHERE actor_id = ?').bind(body.actor_id).run();

  // Remove member entry
  await c.env.DB.prepare('DELETE FROM members WHERE ap_actor_id = ?').bind(body.actor_id).run();

  // Send Remove activity
  const cachedActor = await c.env.DB.prepare('SELECT inbox FROM ap_remote_actors WHERE id = ?').bind(body.actor_id).first();
  if (cachedActor?.inbox) {
    const { privateKeyPem } = await getOrCreateKeyPair(c.env.DB);
    const removeActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${baseUrl}/ap/activities/${generateId()}`,
      type: 'Remove',
      actor: `${baseUrl}/ap/actor`,
      object: body.actor_id,
      target: `${baseUrl}/ap/actor/followers`
    };

    await deliverActivity(removeActivity, cachedActor.inbox as string, privateKeyPem, `${baseUrl}/ap/actor#main-key`);

    // Store outbound activity
    await c.env.DB.prepare(
      'INSERT INTO ap_activities (id, activity_id, activity_type, actor, object, raw_json, direction) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(generateId(), removeActivity.id, 'Remove', `${baseUrl}/ap/actor`, body.actor_id, JSON.stringify(removeActivity), 'outbound').run();
  }

  return c.json({ success: true });
});

// Get ban list
app.get('/api/ap/bans', async (c) => {
  const member = c.get('member');
  if (!member || (member.role !== 'owner' && member.role !== 'moderator')) {
    return c.json({ error: 'Only owners/moderators can view bans' }, 403);
  }

  const bans = await c.env.DB.prepare(`
    SELECT b.*, ra.preferred_username, ra.name, ra.icon_url
    FROM ap_bans b
    LEFT JOIN ap_remote_actors ra ON b.actor_id = ra.id
    ORDER BY b.created_at DESC
  `).all();

  return c.json({ bans: bans.results || [] });
});

// Unban actor
app.delete('/api/ap/bans/:actor_id', async (c) => {
  const member = c.get('member');
  if (!member || (member.role !== 'owner' && member.role !== 'moderator')) {
    return c.json({ error: 'Only owners/moderators can unban' }, 403);
  }

  const actorId = decodeURIComponent(c.req.param('actor_id'));
  await c.env.DB.prepare('DELETE FROM ap_bans WHERE actor_id = ?').bind(actorId).run();
  return c.json({ success: true });
});

// ==================== Search API ====================

app.get('/api/search/messages', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const q = c.req.query('q');
  if (!q || q.length < 2) return c.json({ error: 'Query too short' }, 400);

  const result = await c.env.DB.prepare(`
    SELECT m.*, mem.username, mem.display_name, mem.avatar_url, r.name as room_name
    FROM messages m
    JOIN members mem ON m.member_id = mem.id
    JOIN rooms r ON m.room_id = r.id
    WHERE m.content LIKE ?
    ORDER BY m.created_at DESC
    LIMIT 50
  `).bind(`%${q}%`).all();

  return c.json({ messages: result.results || [] });
});

// ==================== Media API ====================

app.post('/api/upload', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'No file provided' }, 400);

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) return c.json({ error: 'Invalid file type. Only images allowed.' }, 400);
  if (file.size > 10 * 1024 * 1024) return c.json({ error: 'File too large. Max 10MB.' }, 400);

  const id = generateId();
  const ext = file.name.split('.').pop() || 'bin';
  const r2Key = `uploads/${id}.${ext}`;

  await c.env.MEDIA.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } });

  return c.json({ id, r2_key: r2Key, content_type: file.type, filename: file.name, size: file.size }, 201);
});

app.get('/media/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.MEDIA.get(key);
  if (!object) return c.json({ error: 'Not found' }, 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000');

  return new Response(object.body, { headers });
});

// Health check
app.get('/api/health', (c) => c.json({ ok: true }));

// ============================================
// ActivityPub Federation (v3.0)
// ============================================

const AP_CONTEXT = [
  'https://www.w3.org/ns/activitystreams',
  'https://w3id.org/security/v1',
  {
    'apc': 'https://yurucommu.com/ns/apc#',
    'rooms': { '@id': 'apc:rooms', '@type': '@id' },
    'room': { '@id': 'apc:room', '@type': '@id' },
    'Room': 'apc:Room',
    'kind': 'apc:kind',
    'joinPolicy': 'apc:joinPolicy',
    'postingPolicy': 'apc:postingPolicy',
    'visibility': 'apc:visibility',
    'threadRoot': { '@id': 'apc:threadRoot', '@type': '@id' },
    'stream': { '@id': 'apc:stream', '@type': '@id' },
    'threads': { '@id': 'apc:threads', '@type': '@id' },
    'owners': { '@id': 'apc:owners', '@type': '@id' },
    'moderators': { '@id': 'apc:moderators', '@type': '@id' },
    'specVersion': 'apc:specVersion',
    'capabilities': 'apc:capabilities',
  }
];

// Helper: Get or create RSA key pair
async function getOrCreateKeyPair(db: D1Database): Promise<{ publicKeyPem: string; privateKeyPem: string }> {
  const existing = await db.prepare('SELECT * FROM ap_actor_keys WHERE id = ?').bind('main').first();
  if (existing) {
    return { publicKeyPem: existing.public_key_pem as string, privateKeyPem: existing.private_key_pem as string };
  }

  // Generate new RSA key pair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );

  const publicKeyDer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privateKeyDer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(publicKeyDer))).match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(privateKeyDer))).match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`;

  await db.prepare('INSERT INTO ap_actor_keys (id, public_key_pem, private_key_pem) VALUES (?, ?, ?)')
    .bind('main', publicKeyPem, privateKeyPem).run();

  return { publicKeyPem, privateKeyPem };
}

// Helper: Import private key for signing
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

// Helper: Sign HTTP request
async function signRequest(method: string, url: string, body: string, privateKeyPem: string, keyId: string): Promise<Headers> {
  const privateKey = await importPrivateKey(privateKeyPem);
  const urlObj = new URL(url);
  const date = new Date().toUTCString();

  // Create digest
  const bodyBytes = new TextEncoder().encode(body);
  const digestBuffer = await crypto.subtle.digest('SHA-256', bodyBytes);
  const digest = `SHA-256=${btoa(String.fromCharCode(...new Uint8Array(digestBuffer)))}`;

  // Create signature string
  const signedHeaders = '(request-target) host date digest';
  const signatureString = [
    `(request-target): ${method.toLowerCase()} ${urlObj.pathname}`,
    `host: ${urlObj.host}`,
    `date: ${date}`,
    `digest: ${digest}`
  ].join('\n');

  // Sign
  const signatureBytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signatureString));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));

  const headers = new Headers();
  headers.set('Date', date);
  headers.set('Digest', digest);
  headers.set('Signature', `keyId="${keyId}",algorithm="rsa-sha256",headers="${signedHeaders}",signature="${signature}"`);
  headers.set('Content-Type', 'application/activity+json');

  return headers;
}

// Helper: Import public key for verification
async function importPublicKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem.replace(/-----BEGIN PUBLIC KEY-----/, '').replace(/-----END PUBLIC KEY-----/, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  return crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

// Helper: Verify HTTP Signature
async function verifyHttpSignature(request: Request, db: D1Database): Promise<{ verified: boolean; actorId?: string }> {
  try {
    const signatureHeader = request.headers.get('Signature');
    if (!signatureHeader) return { verified: false };

    // Parse signature header
    const params: Record<string, string> = {};
    signatureHeader.split(',').forEach(part => {
      const [key, ...valueParts] = part.split('=');
      const value = valueParts.join('=').replace(/^"/, '').replace(/"$/, '');
      params[key.trim()] = value;
    });

    const keyId = params.keyId;
    const signedHeaders = params.headers?.split(' ') || [];
    const signature = params.signature;

    if (!keyId || !signature) return { verified: false };

    // Fetch actor's public key
    const actorId = keyId.split('#')[0];
    let publicKeyPem: string | null = null;

    // Check cache first
    const cached = await db.prepare('SELECT public_key_pem FROM ap_remote_actors WHERE id = ?').bind(actorId).first();
    if (cached?.public_key_pem) {
      publicKeyPem = cached.public_key_pem as string;
    } else {
      // Fetch from remote
      const actorResponse = await fetch(actorId, { headers: { Accept: 'application/activity+json' } });
      if (actorResponse.ok) {
        const actorData: any = await actorResponse.json();
        publicKeyPem = actorData.publicKey?.publicKeyPem;
      }
    }

    if (!publicKeyPem) return { verified: false };

    // Reconstruct signature string
    const url = new URL(request.url);
    const signatureParts: string[] = [];
    for (const header of signedHeaders) {
      if (header === '(request-target)') {
        signatureParts.push(`(request-target): ${request.method.toLowerCase()} ${url.pathname}`);
      } else {
        const value = request.headers.get(header);
        if (value) signatureParts.push(`${header}: ${value}`);
      }
    }
    const signatureString = signatureParts.join('\n');

    // Verify signature
    const publicKey = await importPublicKey(publicKeyPem);
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signatureBytes,
      new TextEncoder().encode(signatureString)
    );

    return { verified, actorId: verified ? actorId : undefined };
  } catch (e) {
    console.error('Signature verification failed:', e);
    return { verified: false };
  }
}

// Helper: Deliver activity to remote inbox (immediate)
async function deliverActivityImmediate(activity: object, targetInbox: string, privateKeyPem: string, keyId: string): Promise<boolean> {
  try {
    const body = JSON.stringify(activity);
    const headers = await signRequest('POST', targetInbox, body, privateKeyPem, keyId);

    const response = await fetch(targetInbox, { method: 'POST', headers, body });
    return response.ok || response.status === 202;
  } catch (e) {
    console.error('Delivery failed:', e);
    return false;
  }
}

// Helper: Queue activity for delivery with retry
async function queueDelivery(db: D1Database, activityId: string, targetInbox: string): Promise<void> {
  const id = generateId();
  await db.prepare(
    `INSERT INTO ap_delivery_queue (id, activity_id, target_inbox, status, created_at) VALUES (?, ?, ?, 'pending', datetime('now'))`
  ).bind(id, activityId, targetInbox).run();
}

// Helper: Process delivery queue
async function processDeliveryQueue(db: D1Database, privateKeyPem: string, keyId: string): Promise<{ processed: number; succeeded: number; failed: number }> {
  // Get pending deliveries (up to 10 at a time)
  const pendingDeliveries = await db.prepare(`
    SELECT dq.*, aa.raw_json as activity_json
    FROM ap_delivery_queue dq
    JOIN ap_activities aa ON dq.activity_id = aa.activity_id
    WHERE dq.status = 'pending'
      AND (dq.next_retry_at IS NULL OR dq.next_retry_at <= datetime('now'))
    ORDER BY dq.created_at ASC
    LIMIT 10
  `).all();

  let processed = 0, succeeded = 0, failed = 0;

  for (const delivery of (pendingDeliveries.results || []) as any[]) {
    processed++;
    const activity = JSON.parse(delivery.activity_json);

    const success = await deliverActivityImmediate(activity, delivery.target_inbox, privateKeyPem, keyId);

    if (success) {
      succeeded++;
      await db.prepare(`UPDATE ap_delivery_queue SET status = 'success', last_attempt_at = datetime('now') WHERE id = ?`)
        .bind(delivery.id).run();
    } else {
      const attempts = (delivery.attempts || 0) + 1;
      if (attempts >= 5) {
        failed++;
        await db.prepare(`UPDATE ap_delivery_queue SET status = 'failed', attempts = ?, last_attempt_at = datetime('now'), error_message = 'Max retries exceeded' WHERE id = ?`)
          .bind(attempts, delivery.id).run();
      } else {
        // Exponential backoff: 1min, 5min, 15min, 60min
        const delayMinutes = [1, 5, 15, 60][attempts - 1] || 60;
        await db.prepare(`UPDATE ap_delivery_queue SET attempts = ?, last_attempt_at = datetime('now'), next_retry_at = datetime('now', '+${delayMinutes} minutes') WHERE id = ?`)
          .bind(attempts, delivery.id).run();
      }
    }
  }

  return { processed, succeeded, failed };
}

// Helper: Deliver activity (queued version for background delivery)
async function deliverActivity(activity: object, targetInbox: string, privateKeyPem: string, keyId: string): Promise<boolean> {
  // For now, still do immediate delivery but log failures
  // In production, this would queue and return immediately
  return deliverActivityImmediate(activity, targetInbox, privateKeyPem, keyId);
}

// WebFinger
app.get('/.well-known/webfinger', async (c) => {
  const resource = c.req.query('resource');
  if (!resource) return c.json({ error: 'resource required' }, 400);

  const expected = `acct:community@${new URL(c.env.APP_URL).host}`;
  if (resource !== expected) return c.json({ error: 'not found' }, 404);

  return c.json({
    subject: resource,
    links: [
      { rel: 'self', type: 'application/activity+json', href: `${c.env.APP_URL}/ap/actor` }
    ]
  });
});

// NodeInfo (for compatibility)
app.get('/.well-known/nodeinfo', (c) => {
  return c.json({
    links: [
      { rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1', href: `${c.env.APP_URL}/nodeinfo/2.1` }
    ]
  });
});

app.get('/nodeinfo/2.1', async (c) => {
  const memberCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM members').first();
  const messageCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM messages').first();

  return c.json({
    version: '2.1',
    software: { name: 'yurucommu', version: '3.0.0' },
    protocols: ['activitypub'],
    usage: {
      users: { total: memberCount?.count || 0, activeMonth: memberCount?.count || 0 },
      localPosts: messageCount?.count || 0
    },
    openRegistrations: true
  });
});

// Group Actor
app.get('/ap/actor', async (c) => {
  const accept = c.req.header('Accept') || '';
  if (!accept.includes('application/activity+json') && !accept.includes('application/ld+json')) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  const { publicKeyPem } = await getOrCreateKeyPair(c.env.DB);
  const baseUrl = c.env.APP_URL;

  const actor = {
    '@context': AP_CONTEXT,
    id: `${baseUrl}/ap/actor`,
    type: 'Group',
    preferredUsername: 'community',
    name: 'Yurucommu',
    summary: 'ゆるいコミュニティチャット',
    inbox: `${baseUrl}/ap/actor/inbox`,
    outbox: `${baseUrl}/ap/actor/outbox`,
    followers: `${baseUrl}/ap/actor/followers`,
    following: `${baseUrl}/ap/actor/following`,
    publicKey: {
      id: `${baseUrl}/ap/actor#main-key`,
      owner: `${baseUrl}/ap/actor`,
      publicKeyPem
    },
    rooms: `${baseUrl}/ap/rooms`,
    owners: `${baseUrl}/ap/actor/owners`,
    moderators: `${baseUrl}/ap/actor/moderators`,
    joinPolicy: 'open',
    postingPolicy: 'members',
    visibility: 'public',
    specVersion: '0.3',
    capabilities: ['rooms', 'forum', 'announceOnlyForwarding'],
    endpoints: { sharedInbox: `${baseUrl}/ap/actor/inbox` }
  };

  return c.json(actor, 200, { 'Content-Type': 'application/activity+json' });
});

// Owners collection
app.get('/ap/actor/owners', async (c) => {
  const owners = await c.env.DB.prepare("SELECT id, username, display_name, ap_actor_id FROM members WHERE role = 'owner'").all();
  const baseUrl = c.env.APP_URL;

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${baseUrl}/ap/actor/owners`,
    type: 'OrderedCollection',
    totalItems: owners.results?.length || 0,
    orderedItems: owners.results?.map((m: any) => m.ap_actor_id || `${baseUrl}/ap/members/${m.id}`) || []
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Moderators collection
app.get('/ap/actor/moderators', async (c) => {
  const mods = await c.env.DB.prepare("SELECT id, username, display_name, ap_actor_id FROM members WHERE role = 'moderator'").all();
  const baseUrl = c.env.APP_URL;

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${baseUrl}/ap/actor/moderators`,
    type: 'OrderedCollection',
    totalItems: mods.results?.length || 0,
    orderedItems: mods.results?.map((m: any) => m.ap_actor_id || `${baseUrl}/ap/members/${m.id}`) || []
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Followers collection (with access control for unlisted/inviteOnly)
app.get('/ap/actor/followers', async (c) => {
  const visibility = 'public'; // TODO: make configurable

  // For unlisted/confidential, check if requester is a member
  if (visibility !== 'public') {
    const signatureResult = await verifyHttpSignature(c.req.raw, c.env.DB);
    if (signatureResult.verified && signatureResult.actorId) {
      const isMember = await c.env.DB.prepare('SELECT * FROM ap_followers WHERE actor_id = ? AND accepted = 1').bind(signatureResult.actorId).first();
      if (!isMember) {
        // Non-member: only return totalItems
        const count = await c.env.DB.prepare('SELECT COUNT(*) as count FROM ap_followers WHERE accepted = 1').first();
        return c.json({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${c.env.APP_URL}/ap/actor/followers`,
          type: 'OrderedCollection',
          totalItems: count?.count || 0
        }, 200, { 'Content-Type': 'application/activity+json' });
      }
    }
  }

  const followers = await c.env.DB.prepare('SELECT actor_id FROM ap_followers WHERE accepted = 1').all();

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${c.env.APP_URL}/ap/actor/followers`,
    type: 'OrderedCollection',
    totalItems: followers.results?.length || 0,
    orderedItems: followers.results?.map((f: any) => f.actor_id) || []
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Following collection (empty for Group)
app.get('/ap/actor/following', (c) => {
  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${c.env.APP_URL}/ap/actor/following`,
    type: 'OrderedCollection',
    totalItems: 0,
    orderedItems: []
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Outbox collection
app.get('/ap/actor/outbox', async (c) => {
  const activities = await c.env.DB.prepare(
    "SELECT * FROM ap_activities WHERE direction = 'outbound' ORDER BY created_at DESC LIMIT 50"
  ).all();

  return c.json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${c.env.APP_URL}/ap/actor/outbox`,
    type: 'OrderedCollection',
    totalItems: activities.results?.length || 0,
    orderedItems: activities.results?.map((a: any) => JSON.parse(a.raw_json)) || []
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Inbox (receive activities)
app.post('/ap/actor/inbox', async (c) => {
  // Verify HTTP Signature (soft fail for now - log but accept)
  const signatureResult = await verifyHttpSignature(c.req.raw, c.env.DB);
  if (!signatureResult.verified) {
    console.log('Warning: Signature verification failed or missing, accepting anyway');
  }

  const activity = await c.req.json();
  console.log('Received activity:', JSON.stringify(activity));

  const activityId = activity.id || generateId();
  const activityType = activity.type;
  const actor = typeof activity.actor === 'string' ? activity.actor : activity.actor?.id;

  // Store activity
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO ap_activities (id, activity_id, activity_type, actor, object, raw_json, direction) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(generateId(), activityId, activityType, actor, JSON.stringify(activity.object), JSON.stringify(activity), 'inbound').run();

  const baseUrl = c.env.APP_URL;

  // Handle Follow
  if (activityType === 'Follow') {
    const targetId = typeof activity.object === 'string' ? activity.object : activity.object?.id;
    if (targetId !== `${baseUrl}/ap/actor`) {
      return c.json({ error: 'Invalid target' }, 400);
    }

    const { privateKeyPem } = await getOrCreateKeyPair(c.env.DB);
    const keyId = `${baseUrl}/ap/actor#main-key`;

    // Check if banned
    const banned = await c.env.DB.prepare('SELECT * FROM ap_bans WHERE actor_id = ?').bind(actor).first();
    if (banned) {
      // Send Reject
      const rejectActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${baseUrl}/ap/activities/${generateId()}`,
        type: 'Reject',
        actor: `${baseUrl}/ap/actor`,
        object: activity
      };
      // Try to get actor inbox
      const cachedActor = await c.env.DB.prepare('SELECT inbox FROM ap_remote_actors WHERE id = ?').bind(actor).first();
      if (cachedActor?.inbox) {
        await deliverActivity(rejectActivity, cachedActor.inbox as string, privateKeyPem, keyId);
      }
      return c.json({ status: 'rejected', reason: 'banned' }, 202);
    }

    // joinPolicy check (currently always 'open', but prepared for inviteOnly)
    const joinPolicy = 'open'; // TODO: make configurable

    if (joinPolicy === 'inviteOnly') {
      const invite = await c.env.DB.prepare('SELECT * FROM ap_invites WHERE actor_id = ? AND (expires_at IS NULL OR expires_at > datetime("now"))').bind(actor).first();
      if (!invite) {
        // No valid invite - Reject
        const rejectActivity = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${baseUrl}/ap/activities/${generateId()}`,
          type: 'Reject',
          actor: `${baseUrl}/ap/actor`,
          object: activity
        };
        const cachedActor = await c.env.DB.prepare('SELECT inbox FROM ap_remote_actors WHERE id = ?').bind(actor).first();
        if (cachedActor?.inbox) {
          await deliverActivity(rejectActivity, cachedActor.inbox as string, privateKeyPem, keyId);
        }
        return c.json({ status: 'rejected', reason: 'invite_required' }, 202);
      }
      // Mark invite as used
      await c.env.DB.prepare('UPDATE ap_invites SET accepted = 1 WHERE actor_id = ?').bind(actor).run();
    }

    // Fetch actor info and create member
    try {
      const actorResponse = await fetch(actor, { headers: { Accept: 'application/activity+json' } });
      if (actorResponse.ok) {
        const actorData: any = await actorResponse.json();

        // Store remote actor
        await c.env.DB.prepare(
          'INSERT OR REPLACE INTO ap_remote_actors (id, actor_type, preferred_username, name, summary, inbox, outbox, followers, following, public_key_id, public_key_pem, icon_url, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          actor,
          actorData.type || 'Person',
          actorData.preferredUsername,
          actorData.name,
          actorData.summary,
          actorData.inbox,
          actorData.outbox,
          actorData.followers,
          actorData.following,
          actorData.publicKey?.id,
          actorData.publicKey?.publicKeyPem,
          actorData.icon?.url || actorData.icon,
          JSON.stringify(actorData)
        ).run();

        // Add to followers
        await c.env.DB.prepare('INSERT OR IGNORE INTO ap_followers (id, actor_id, accepted) VALUES (?, ?, 1)')
          .bind(generateId(), actor).run();

        // Create member entry
        const existingMember = await c.env.DB.prepare('SELECT * FROM members WHERE ap_actor_id = ?').bind(actor).first();
        if (!existingMember) {
          await c.env.DB.prepare(
            'INSERT INTO members (id, takos_user_id, username, display_name, avatar_url, role, ap_actor_id, is_remote) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
          ).bind(
            generateId(),
            actor,
            actorData.preferredUsername || 'remote',
            actorData.name,
            actorData.icon?.url || actorData.icon,
            'member',
            actor
          ).run();
        }

        // Send Accept
        const acceptActivity = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${baseUrl}/ap/activities/${generateId()}`,
          type: 'Accept',
          actor: `${baseUrl}/ap/actor`,
          object: activity
        };

        await deliverActivity(acceptActivity, actorData.inbox, privateKeyPem, keyId);

        // Store outbound activity
        await c.env.DB.prepare(
          'INSERT INTO ap_activities (id, activity_id, activity_type, actor, object, raw_json, direction) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(generateId(), acceptActivity.id, 'Accept', `${baseUrl}/ap/actor`, JSON.stringify(activity), JSON.stringify(acceptActivity), 'outbound').run();
      }
    } catch (e) {
      console.error('Failed to process Follow:', e);
    }

    return c.json({ status: 'accepted' }, 202);
  }

  // Handle Undo (for Follow)
  if (activityType === 'Undo') {
    const innerActivity = activity.object;
    if (innerActivity?.type === 'Follow') {
      await c.env.DB.prepare('DELETE FROM ap_followers WHERE actor_id = ?').bind(actor).run();
      await c.env.DB.prepare('DELETE FROM members WHERE ap_actor_id = ?').bind(actor).run();
    }
    return c.json({ status: 'accepted' }, 202);
  }

  // Handle Create (Note or Article)
  if (activityType === 'Create') {
    const obj = activity.object;

    // Verify sender is a follower
    const follower = await c.env.DB.prepare('SELECT * FROM ap_followers WHERE actor_id = ? AND accepted = 1').bind(actor).first();
    if (!follower) {
      return c.json({ error: 'Not a member' }, 403);
    }

    // Get member
    const member = await c.env.DB.prepare('SELECT * FROM members WHERE ap_actor_id = ?').bind(actor).first();
    if (!member) {
      return c.json({ error: 'Member not found' }, 403);
    }

    // Handle Note (chat message or thread reply)
    if (obj?.type === 'Note') {
      // Check if this is a thread reply
      const threadRoot = obj.threadRoot || obj.inReplyTo;
      const isThreadReply = threadRoot && (threadRoot.includes('/ap/threads/') || obj.inReplyTo?.includes('/ap/threads/'));

      if (isThreadReply) {
        // Extract thread ID
        const threadIdMatch = (obj.threadRoot || obj.inReplyTo).match(/\/ap\/threads\/([^\/]+)/);
        const threadId = threadIdMatch ? threadIdMatch[1] : null;

        if (threadId) {
          const thread = await c.env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(threadId).first();
          if (thread && !(thread as any).locked) {
            const replyId = generateId();
            await c.env.DB.prepare(
              'INSERT INTO thread_replies (id, thread_id, member_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, datetime("now"), datetime("now"))'
            ).bind(replyId, threadId, member.id, obj.content || '').run();

            // Update thread reply count
            await c.env.DB.prepare(
              "UPDATE threads SET reply_count = reply_count + 1, last_reply_at = datetime('now') WHERE id = ?"
            ).bind(threadId).run();

            return c.json({ status: 'accepted' }, 202);
          }
        }
      }

      // Regular chat message
      const roomId = typeof obj.room === 'string' ? obj.room.split('/').pop() : null;
      const room = roomId ? await c.env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first() : null;
      const targetRoomId = room ? room.id : 'general';

      const messageId = generateId();
      const contextId = `${baseUrl}/ap/rooms/${targetRoomId}`;
      await c.env.DB.prepare(
        'INSERT INTO messages (id, room_id, member_id, content, ap_note_id, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))'
      ).bind(messageId, targetRoomId, member.id, obj.content || '', obj.id, contextId).run();

      // Announce to all followers (except sender)
      const { privateKeyPem } = await getOrCreateKeyPair(c.env.DB);
      const remoteActors = await c.env.DB.prepare('SELECT * FROM ap_remote_actors WHERE id IN (SELECT actor_id FROM ap_followers WHERE accepted = 1)').all();

      const announceActivity = {
        '@context': AP_CONTEXT,
        id: `${baseUrl}/ap/activities/${generateId()}`,
        type: 'Announce',
        actor: `${baseUrl}/ap/actor`,
        to: [`${baseUrl}/ap/actor/followers`],
        object: obj.id,
        room: `${baseUrl}/ap/rooms/${targetRoomId}`,
        context: contextId,
        published: new Date().toISOString()
      };

      await c.env.DB.prepare(
        'INSERT INTO ap_activities (id, activity_id, activity_type, actor, object, raw_json, direction) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(generateId(), announceActivity.id, 'Announce', `${baseUrl}/ap/actor`, obj.id, JSON.stringify(announceActivity), 'outbound').run();

      for (const remoteActor of (remoteActors.results || []) as any[]) {
        if (remoteActor.inbox && remoteActor.id !== actor) {
          await queueDelivery(c.env.DB, announceActivity.id, remoteActor.inbox);
        }
      }

      processDeliveryQueue(c.env.DB, privateKeyPem, `${baseUrl}/ap/actor#main-key`).catch(e => {
        console.error('Failed to process delivery queue:', e);
      });

      return c.json({ status: 'accepted' }, 202);
    }

    // Handle Article (forum thread)
    if (obj?.type === 'Article') {
      const roomId = typeof obj.room === 'string' ? obj.room.split('/').pop() : null;
      const room = roomId ? await c.env.DB.prepare('SELECT * FROM rooms WHERE id = ? AND kind = ?').bind(roomId, 'forum').first() : null;

      if (room) {
        const threadId = generateId();
        const threadContextId = obj.id; // forum uses thread as context
        await c.env.DB.prepare(
          'INSERT INTO threads (id, room_id, member_id, title, content, ap_article_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))'
        ).bind(threadId, room.id, member.id, obj.name || 'Untitled', obj.content || '', obj.id).run();

        // Announce the thread
        const { privateKeyPem } = await getOrCreateKeyPair(c.env.DB);
        const remoteActors = await c.env.DB.prepare('SELECT * FROM ap_remote_actors WHERE id IN (SELECT actor_id FROM ap_followers WHERE accepted = 1)').all();

        const announceActivity = {
          '@context': AP_CONTEXT,
          id: `${baseUrl}/ap/activities/${generateId()}`,
          type: 'Announce',
          actor: `${baseUrl}/ap/actor`,
          to: [`${baseUrl}/ap/actor/followers`],
          object: obj.id,
          room: `${baseUrl}/ap/rooms/${room.id}`,
          context: threadContextId,
          threadRoot: obj.id,
          published: new Date().toISOString()
        };

        await c.env.DB.prepare(
          'INSERT INTO ap_activities (id, activity_id, activity_type, actor, object, raw_json, direction) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(generateId(), announceActivity.id, 'Announce', `${baseUrl}/ap/actor`, obj.id, JSON.stringify(announceActivity), 'outbound').run();

        for (const remoteActor of (remoteActors.results || []) as any[]) {
          if (remoteActor.inbox && remoteActor.id !== actor) {
            await queueDelivery(c.env.DB, announceActivity.id, remoteActor.inbox);
          }
        }

        processDeliveryQueue(c.env.DB, privateKeyPem, `${baseUrl}/ap/actor#main-key`).catch(e => {
          console.error('Failed to process delivery queue:', e);
        });

        return c.json({ status: 'accepted' }, 202);
      }
    }
  }

  return c.json({ status: 'received' }, 202);
});

// Rooms collection
app.get('/ap/rooms', async (c) => {
  const rooms = await c.env.DB.prepare('SELECT * FROM rooms ORDER BY sort_order ASC').all();

  return c.json({
    '@context': AP_CONTEXT,
    id: `${c.env.APP_URL}/ap/rooms`,
    type: 'Collection',
    totalItems: rooms.results?.length || 0,
    items: rooms.results?.map((r: any) => ({
      id: `${c.env.APP_URL}/ap/rooms/${r.id}`,
      type: 'Room',
      name: r.name,
      summary: r.description,
      kind: r.kind,
      postingPolicy: r.posting_policy,
      attributedTo: `${c.env.APP_URL}/ap/actor`,
      stream: `${c.env.APP_URL}/ap/rooms/${r.id}/stream`
    })) || []
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Single Room
app.get('/ap/rooms/:roomId', async (c) => {
  const roomId = c.req.param('roomId');
  const room = await c.env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first();

  if (!room) return c.json({ error: 'Not found' }, 404);

  return c.json({
    '@context': AP_CONTEXT,
    id: `${c.env.APP_URL}/ap/rooms/${room.id}`,
    type: 'Room',
    name: room.name,
    summary: room.description,
    kind: room.kind,
    postingPolicy: room.posting_policy,
    attributedTo: `${c.env.APP_URL}/ap/actor`,
    stream: `${c.env.APP_URL}/ap/rooms/${room.id}/stream`
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Thread object (for forum federation)
app.get('/ap/threads/:threadId', async (c) => {
  const threadId = c.req.param('threadId');
  const baseUrl = c.env.APP_URL;

  const thread = await c.env.DB.prepare(`
    SELECT t.*, mem.username, mem.display_name, mem.avatar_url, mem.ap_actor_id, r.name as room_name
    FROM threads t
    JOIN members mem ON t.member_id = mem.id
    JOIN rooms r ON t.room_id = r.id
    WHERE t.id = ?
  `).bind(threadId).first();

  if (!thread) return c.json({ error: 'Not found' }, 404);

  const article = {
    '@context': AP_CONTEXT,
    type: 'Article',
    id: `${baseUrl}/ap/threads/${thread.id}`,
    attributedTo: (thread as any).ap_actor_id || `${baseUrl}/ap/actor`,
    to: [`${baseUrl}/ap/actor/followers`],
    name: (thread as any).title,
    content: (thread as any).content || '',
    room: `${baseUrl}/ap/rooms/${(thread as any).room_id}`,
    context: `${baseUrl}/ap/rooms/${(thread as any).room_id}`,
    replies: `${baseUrl}/ap/threads/${thread.id}/replies`,
    published: (thread as any).created_at,
    updated: (thread as any).updated_at
  };

  return c.json(article, 200, { 'Content-Type': 'application/activity+json' });
});

// Thread replies collection
app.get('/ap/threads/:threadId/replies', async (c) => {
  const threadId = c.req.param('threadId');
  const baseUrl = c.env.APP_URL;

  const replies = await c.env.DB.prepare(`
    SELECT tr.*, mem.username, mem.display_name, mem.avatar_url, mem.ap_actor_id
    FROM thread_replies tr
    JOIN members mem ON tr.member_id = mem.id
    WHERE tr.thread_id = ?
    ORDER BY tr.created_at ASC
  `).bind(threadId).all();

  return c.json({
    '@context': AP_CONTEXT,
    id: `${baseUrl}/ap/threads/${threadId}/replies`,
    type: 'OrderedCollection',
    totalItems: replies.results?.length || 0,
    orderedItems: replies.results?.map((r: any) => ({
      type: 'Note',
      id: `${baseUrl}/ap/replies/${r.id}`,
      attributedTo: r.ap_actor_id || `${baseUrl}/ap/actor`,
      content: r.content,
      inReplyTo: `${baseUrl}/ap/threads/${threadId}`,
      threadRoot: `${baseUrl}/ap/threads/${threadId}`,
      published: r.created_at
    })) || []
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Thread reply object
app.get('/ap/replies/:replyId', async (c) => {
  const replyId = c.req.param('replyId');
  const baseUrl = c.env.APP_URL;

  const reply = await c.env.DB.prepare(`
    SELECT tr.*, mem.username, mem.display_name, mem.avatar_url, mem.ap_actor_id, t.room_id
    FROM thread_replies tr
    JOIN members mem ON tr.member_id = mem.id
    JOIN threads t ON tr.thread_id = t.id
    WHERE tr.id = ?
  `).bind(replyId).first();

  if (!reply) return c.json({ error: 'Not found' }, 404);

  return c.json({
    '@context': AP_CONTEXT,
    type: 'Note',
    id: `${baseUrl}/ap/replies/${reply.id}`,
    attributedTo: (reply as any).ap_actor_id || `${baseUrl}/ap/actor`,
    to: [`${baseUrl}/ap/actor/followers`],
    content: (reply as any).content,
    inReplyTo: `${baseUrl}/ap/threads/${(reply as any).thread_id}`,
    threadRoot: `${baseUrl}/ap/threads/${(reply as any).thread_id}`,
    room: `${baseUrl}/ap/rooms/${(reply as any).room_id}`,
    published: (reply as any).created_at
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// Note object (for remote fetch)
app.get('/ap/notes/:noteId', async (c) => {
  const noteId = c.req.param('noteId');
  const baseUrl = c.env.APP_URL;

  const message = await c.env.DB.prepare(`
    SELECT m.*, mem.username, mem.display_name, mem.avatar_url, mem.ap_actor_id
    FROM messages m
    JOIN members mem ON m.member_id = mem.id
    WHERE m.id = ?
  `).bind(noteId).first();

  if (!message) return c.json({ error: 'Not found' }, 404);

  const note = {
    '@context': AP_CONTEXT,
    type: 'Note',
    id: `${baseUrl}/ap/notes/${message.id}`,
    attributedTo: (message as any).ap_actor_id || `${baseUrl}/ap/actor`,
    to: [`${baseUrl}/ap/actor/followers`],
    content: (message as any).content,
    room: `${baseUrl}/ap/rooms/${(message as any).room_id}`,
    context: `${baseUrl}/ap/rooms/${(message as any).room_id}`,
    published: (message as any).created_at
  };

  return c.json(note, 200, { 'Content-Type': 'application/activity+json' });
});

// Room stream (messages as Announce activities)
app.get('/ap/rooms/:roomId/stream', async (c) => {
  const roomId = c.req.param('roomId');
  const messages = await c.env.DB.prepare(`
    SELECT m.*, mem.username, mem.display_name, mem.avatar_url, mem.ap_actor_id
    FROM messages m
    JOIN members mem ON m.member_id = mem.id
    WHERE m.room_id = ?
    ORDER BY m.created_at DESC
    LIMIT 50
  `).bind(roomId).all();

  const baseUrl = c.env.APP_URL;

  return c.json({
    '@context': AP_CONTEXT,
    id: `${baseUrl}/ap/rooms/${roomId}/stream`,
    type: 'OrderedCollection',
    totalItems: messages.results?.length || 0,
    orderedItems: messages.results?.map((m: any) => ({
      type: 'Announce',
      id: `${baseUrl}/ap/activities/msg-${m.id}`,
      actor: `${baseUrl}/ap/actor`,
      object: m.ap_note_id || {
        type: 'Note',
        id: `${baseUrl}/ap/notes/${m.id}`,
        attributedTo: m.ap_actor_id || `${baseUrl}/ap/actor`,
        content: m.content,
        published: m.created_at
      },
      room: `${baseUrl}/ap/rooms/${roomId}`,
      published: m.created_at
    })) || []
  }, 200, { 'Content-Type': 'application/activity+json' });
});

// ==================== Delivery Queue Management ====================

// Process delivery queue (can be called by cron or manually)
app.post('/ap/queue/process', async (c) => {
  const { privateKeyPem } = await getOrCreateKeyPair(c.env.DB);
  const keyId = `${c.env.APP_URL}/ap/actor#main-key`;

  const result = await processDeliveryQueue(c.env.DB, privateKeyPem, keyId);
  return c.json(result);
});

// Get queue stats
app.get('/ap/queue/stats', async (c) => {
  const stats = await c.env.DB.prepare(`
    SELECT status, COUNT(*) as count FROM ap_delivery_queue GROUP BY status
  `).all();

  const pending = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM ap_delivery_queue
    WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
  `).first();

  return c.json({
    byStatus: stats.results || [],
    readyToProcess: pending?.count || 0
  });
});

// ==================== v4.0 Social Network API ====================

// ----- Communities -----

// Get all communities
app.get('/api/communities', async (c) => {
  const communities = await c.env.DB.prepare(`
    SELECT * FROM communities ORDER BY sort_order ASC, created_at ASC
  `).all();
  return c.json({ communities: communities.results || [] });
});

// Create community
app.post('/api/communities', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ name: string; description?: string }>();
  if (!body.name?.trim()) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const id = generateId();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO communities (id, name, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, body.name.trim(), body.description?.trim() || '', now, now).run();

  const community = await c.env.DB.prepare(`SELECT * FROM communities WHERE id = ?`).bind(id).first();
  return c.json({ community }, 201);
});

// ----- Timeline / Posts -----

// Get timeline (all public posts, optionally filtered by community)
app.get('/api/timeline', async (c) => {
  const member = c.get('member');
  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');
  const communityId = c.req.query('community');

  let query = `
    SELECT p.*, m.username, m.display_name, m.avatar_url, p.community_id,
           EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.member_id = ?) as liked,
           EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.member_id = ?) as bookmarked
    FROM posts p
    JOIN members m ON p.member_id = m.id
    WHERE p.visibility = 'public'
  `;
  const params: any[] = [member?.id || '', member?.id || ''];

  // Filter by community if specified
  if (communityId) {
    query += ` AND p.community_id = ?`;
    params.push(communityId);
  }

  if (before) {
    query += ` AND p.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY p.created_at DESC LIMIT ?`;
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ posts: posts.results || [] });
});

// Get timeline (following only)
app.get('/api/timeline/following', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');

  let query = `
    SELECT p.*, m.username, m.display_name, m.avatar_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.member_id = ?) as liked,
           EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.member_id = ?) as bookmarked
    FROM posts p
    JOIN members m ON p.member_id = m.id
    WHERE p.member_id IN (
      SELECT following_id FROM follows WHERE follower_id = ? AND status = 'accepted'
    ) OR p.member_id = ?
  `;
  const params: any[] = [member.id, member.id, member.id, member.id];

  if (before) {
    query += ` AND p.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY p.created_at DESC LIMIT ?`;
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ posts: posts.results || [] });
});

// Create post
app.post('/api/posts', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ content: string; reply_to_id?: string; visibility?: string; community_id?: string; media?: { r2_key: string; content_type: string }[] }>();
  if (!body.content?.trim() && (!body.media || body.media.length === 0)) {
    return c.json({ error: 'Content or media is required' }, 400);
  }

  const postId = generateId();
  const visibility = body.visibility || 'public';
  const communityId = body.community_id || null; // NULL = personal post
  const mediaJson = JSON.stringify(body.media || []);

  await c.env.DB.prepare(`
    INSERT INTO posts (id, member_id, content, reply_to_id, visibility, community_id, media_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(postId, member.id, body.content?.trim() || '', body.reply_to_id || null, visibility, communityId, mediaJson).run();

  // Update post count
  await c.env.DB.prepare(`UPDATE members SET post_count = post_count + 1 WHERE id = ?`).bind(member.id).run();

  // If reply, update reply count and create notification
  if (body.reply_to_id) {
    await c.env.DB.prepare(`UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?`).bind(body.reply_to_id).run();

    // Get original post author
    const originalPost = await c.env.DB.prepare(`SELECT member_id FROM posts WHERE id = ?`).bind(body.reply_to_id).first();
    if (originalPost && originalPost.member_id !== member.id) {
      const notifId = generateId();
      await c.env.DB.prepare(`
        INSERT INTO notifications (id, member_id, actor_id, type, target_type, target_id)
        VALUES (?, ?, ?, 'reply', 'post', ?)
      `).bind(notifId, originalPost.member_id, member.id, postId).run();
    }
  }

  const post = await c.env.DB.prepare(`
    SELECT p.*, m.username, m.display_name, m.avatar_url
    FROM posts p JOIN members m ON p.member_id = m.id
    WHERE p.id = ?
  `).bind(postId).first();

  return c.json({ post }, 201);
});

// Get single post
app.get('/api/posts/:id', async (c) => {
  const member = c.get('member');
  const postId = c.req.param('id');

  const post = await c.env.DB.prepare(`
    SELECT p.*, m.username, m.display_name, m.avatar_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.member_id = ?) as liked,
           EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.member_id = ?) as bookmarked
    FROM posts p JOIN members m ON p.member_id = m.id
    WHERE p.id = ?
  `).bind(member?.id || '', member?.id || '', postId).first();

  if (!post) return c.json({ error: 'Not found' }, 404);
  return c.json({ post });
});

// Get post replies
app.get('/api/posts/:id/replies', async (c) => {
  const member = c.get('member');
  const postId = c.req.param('id');

  const replies = await c.env.DB.prepare(`
    SELECT p.*, m.username, m.display_name, m.avatar_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.member_id = ?) as liked
    FROM posts p JOIN members m ON p.member_id = m.id
    WHERE p.reply_to_id = ?
    ORDER BY p.created_at ASC
  `).bind(member?.id || '', postId).all();

  return c.json({ replies: replies.results || [] });
});

// Delete post
app.delete('/api/posts/:id', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const post = await c.env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(postId).first<Post>();

  if (!post) return c.json({ error: 'Not found' }, 404);
  if (post.member_id !== member.id && member.role !== 'owner' && member.role !== 'moderator') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(postId).run();
  await c.env.DB.prepare(`UPDATE members SET post_count = post_count - 1 WHERE id = ? AND post_count > 0`).bind(post.member_id).run();

  return c.json({ success: true });
});

// Like post
app.post('/api/posts/:id/like', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const post = await c.env.DB.prepare(`SELECT * FROM posts WHERE id = ?`).bind(postId).first<Post>();
  if (!post) return c.json({ error: 'Not found' }, 404);

  try {
    const likeId = generateId();
    await c.env.DB.prepare(`INSERT INTO likes (id, member_id, post_id) VALUES (?, ?, ?)`).bind(likeId, member.id, postId).run();
    await c.env.DB.prepare(`UPDATE posts SET like_count = like_count + 1 WHERE id = ?`).bind(postId).run();

    // Create notification
    if (post.member_id !== member.id) {
      const notifId = generateId();
      await c.env.DB.prepare(`
        INSERT INTO notifications (id, member_id, actor_id, type, target_type, target_id)
        VALUES (?, ?, ?, 'like', 'post', ?)
      `).bind(notifId, post.member_id, member.id, postId).run();
    }
  } catch (e) {
    // Already liked
  }

  return c.json({ success: true });
});

// Unlike post
app.delete('/api/posts/:id/like', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const result = await c.env.DB.prepare(`DELETE FROM likes WHERE member_id = ? AND post_id = ?`).bind(member.id, postId).run();

  if (result.meta.changes > 0) {
    await c.env.DB.prepare(`UPDATE posts SET like_count = like_count - 1 WHERE id = ? AND like_count > 0`).bind(postId).run();
  }

  return c.json({ success: true });
});

// Bookmark post
app.post('/api/posts/:id/bookmark', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  try {
    const bookmarkId = generateId();
    await c.env.DB.prepare(`INSERT INTO bookmarks (id, member_id, post_id) VALUES (?, ?, ?)`).bind(bookmarkId, member.id, postId).run();
  } catch (e) {
    // Already bookmarked
  }

  return c.json({ success: true });
});

// Remove bookmark
app.delete('/api/posts/:id/bookmark', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  await c.env.DB.prepare(`DELETE FROM bookmarks WHERE member_id = ? AND post_id = ?`).bind(member.id, postId).run();
  return c.json({ success: true });
});

// Get user's posts
app.get('/api/members/:id/posts', async (c) => {
  const currentMember = c.get('member');
  const memberId = c.req.param('id');
  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');

  let query = `
    SELECT p.*, m.username, m.display_name, m.avatar_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.member_id = ?) as liked
    FROM posts p JOIN members m ON p.member_id = m.id
    WHERE p.member_id = ? AND p.reply_to_id IS NULL
  `;
  const params: any[] = [currentMember?.id || '', memberId];

  if (before) {
    query += ` AND p.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY p.created_at DESC LIMIT ?`;
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ posts: posts.results || [] });
});

// Get member's liked posts
app.get('/api/members/:id/likes', async (c) => {
  const currentMember = c.get('member');
  const memberId = c.req.param('id');
  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');

  let query = `
    SELECT p.*, m.username, m.display_name, m.avatar_url,
           EXISTS(SELECT 1 FROM likes l2 WHERE l2.post_id = p.id AND l2.member_id = ?) as liked
    FROM likes l
    JOIN posts p ON l.post_id = p.id
    JOIN members m ON p.member_id = m.id
    WHERE l.member_id = ?
  `;
  const params: any[] = [currentMember?.id || '', memberId];

  if (before) {
    query += ` AND l.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY l.created_at DESC LIMIT ?`;
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ posts: posts.results || [] });
});

// ----- Follow -----

// Get followers
app.get('/api/follow/followers', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const followers = await c.env.DB.prepare(`
    SELECT m.*, f.status, f.created_at as follow_date
    FROM follows f
    JOIN members m ON f.follower_id = m.id
    WHERE f.following_id = ? AND f.status = 'accepted'
    ORDER BY f.created_at DESC
  `).bind(member.id).all();

  return c.json({ followers: followers.results || [] });
});

// Get following
app.get('/api/follow/following', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const following = await c.env.DB.prepare(`
    SELECT m.*, f.status, f.created_at as follow_date
    FROM follows f
    JOIN members m ON f.following_id = m.id
    WHERE f.follower_id = ? AND f.status = 'accepted'
    ORDER BY f.created_at DESC
  `).bind(member.id).all();

  return c.json({ following: following.results || [] });
});

// Get pending follow requests (requests to me)
app.get('/api/follow/requests', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const requests = await c.env.DB.prepare(`
    SELECT m.*, f.id as follow_id, f.created_at as request_date
    FROM follows f
    JOIN members m ON f.follower_id = m.id
    WHERE f.following_id = ? AND f.status = 'pending'
    ORDER BY f.created_at DESC
  `).bind(member.id).all();

  return c.json({ requests: requests.results || [] });
});

// Get follow status with a user
app.get('/api/follow/:memberId/status', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const targetId = c.req.param('memberId');

  // Am I following them?
  const following = await c.env.DB.prepare(`
    SELECT status FROM follows WHERE follower_id = ? AND following_id = ?
  `).bind(member.id, targetId).first();

  // Are they following me?
  const followedBy = await c.env.DB.prepare(`
    SELECT status FROM follows WHERE follower_id = ? AND following_id = ?
  `).bind(targetId, member.id).first();

  return c.json({
    following: following?.status || null,
    followedBy: followedBy?.status || null
  });
});

// Send follow request
app.post('/api/follow/:memberId', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const targetId = c.req.param('memberId');
  if (targetId === member.id) return c.json({ error: 'Cannot follow yourself' }, 400);

  // Check if target exists
  const target = await c.env.DB.prepare(`SELECT * FROM members WHERE id = ?`).bind(targetId).first();
  if (!target) return c.json({ error: 'User not found' }, 404);

  // Check existing follow
  const existing = await c.env.DB.prepare(`
    SELECT * FROM follows WHERE follower_id = ? AND following_id = ?
  `).bind(member.id, targetId).first();

  if (existing) {
    return c.json({ status: existing.status });
  }

  // Create follow request (pending for mutual follow system)
  const followId = generateId();
  await c.env.DB.prepare(`
    INSERT INTO follows (id, follower_id, following_id, status)
    VALUES (?, ?, ?, 'pending')
  `).bind(followId, member.id, targetId).run();

  // Create notification
  const notifId = generateId();
  await c.env.DB.prepare(`
    INSERT INTO notifications (id, member_id, actor_id, type, target_type, target_id)
    VALUES (?, ?, ?, 'follow_request', 'member', ?)
  `).bind(notifId, targetId, member.id, member.id).run();

  return c.json({ status: 'pending' }, 201);
});

// Accept follow request
app.post('/api/follow/:memberId/accept', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const followerId = c.req.param('memberId');

  const result = await c.env.DB.prepare(`
    UPDATE follows SET status = 'accepted', accepted_at = datetime('now')
    WHERE follower_id = ? AND following_id = ? AND status = 'pending'
  `).bind(followerId, member.id).run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'No pending request found' }, 404);
  }

  // Update follower counts
  await c.env.DB.prepare(`UPDATE members SET following_count = following_count + 1 WHERE id = ?`).bind(followerId).run();
  await c.env.DB.prepare(`UPDATE members SET follower_count = follower_count + 1 WHERE id = ?`).bind(member.id).run();

  // Create notification for the follower
  const notifId = generateId();
  await c.env.DB.prepare(`
    INSERT INTO notifications (id, member_id, actor_id, type, target_type, target_id)
    VALUES (?, ?, ?, 'follow_accepted', 'member', ?)
  `).bind(notifId, followerId, member.id, member.id).run();

  return c.json({ success: true });
});

// Reject follow request
app.post('/api/follow/:memberId/reject', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const followerId = c.req.param('memberId');

  await c.env.DB.prepare(`
    DELETE FROM follows WHERE follower_id = ? AND following_id = ? AND status = 'pending'
  `).bind(followerId, member.id).run();

  return c.json({ success: true });
});

// Unfollow
app.delete('/api/follow/:memberId', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const targetId = c.req.param('memberId');

  const follow = await c.env.DB.prepare(`
    SELECT * FROM follows WHERE follower_id = ? AND following_id = ?
  `).bind(member.id, targetId).first<Follow>();

  if (!follow) return c.json({ success: true });

  await c.env.DB.prepare(`DELETE FROM follows WHERE id = ?`).bind(follow.id).run();

  // Update counts if was accepted
  if (follow.status === 'accepted') {
    await c.env.DB.prepare(`UPDATE members SET following_count = following_count - 1 WHERE id = ? AND following_count > 0`).bind(member.id).run();
    await c.env.DB.prepare(`UPDATE members SET follower_count = follower_count - 1 WHERE id = ? AND follower_count > 0`).bind(targetId).run();
  }

  return c.json({ success: true });
});

// ----- Notifications -----

// Get notifications
app.get('/api/notifications', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '20');

  const notifications = await c.env.DB.prepare(`
    SELECT n.*, m.username as actor_username, m.display_name as actor_display_name, m.avatar_url as actor_avatar_url
    FROM notifications n
    JOIN members m ON n.actor_id = m.id
    WHERE n.member_id = ?
    ORDER BY n.created_at DESC
    LIMIT ?
  `).bind(member.id, limit).all();

  return c.json({ notifications: notifications.results || [] });
});

// Get unread count
app.get('/api/notifications/unread/count', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const result = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM notifications WHERE member_id = ? AND read = 0
  `).bind(member.id).first();

  return c.json({ count: result?.count || 0 });
});

// Mark notifications as read
app.post('/api/notifications/read', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ids?: string[] }>();

  if (body.ids && body.ids.length > 0) {
    // Mark specific notifications as read
    const placeholders = body.ids.map(() => '?').join(',');
    await c.env.DB.prepare(`
      UPDATE notifications SET read = 1 WHERE id IN (${placeholders}) AND member_id = ?
    `).bind(...body.ids, member.id).run();
  } else {
    // Mark all as read
    await c.env.DB.prepare(`UPDATE notifications SET read = 1 WHERE member_id = ?`).bind(member.id).run();
  }

  return c.json({ success: true });
});

// ----- Profile -----

// Get member profile (public)
app.get('/api/profile/:id', async (c) => {
  const currentMember = c.get('member');
  const memberId = c.req.param('id');

  const profile = await c.env.DB.prepare(`
    SELECT id, username, display_name, avatar_url, header_url, bio, follower_count, following_count, post_count, created_at
    FROM members WHERE id = ?
  `).bind(memberId).first();

  if (!profile) return c.json({ error: 'Not found' }, 404);

  // Get follow status if logged in
  let followStatus = null;
  if (currentMember && currentMember.id !== memberId) {
    const follow = await c.env.DB.prepare(`
      SELECT status FROM follows WHERE follower_id = ? AND following_id = ?
    `).bind(currentMember.id, memberId).first();
    followStatus = follow?.status || null;
  }

  return c.json({ profile: { ...profile, followStatus } });
});

// ----- Search -----

// Search users
app.get('/api/search/users', async (c) => {
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ users: [] });

  const users = await c.env.DB.prepare(`
    SELECT id, username, display_name, avatar_url, bio
    FROM members
    WHERE username LIKE ? OR display_name LIKE ?
    ORDER BY username ASC
    LIMIT 20
  `).bind(`%${query}%`, `%${query}%`).all();

  return c.json({ users: users.results || [] });
});

// Search posts
app.get('/api/search/posts', async (c) => {
  const member = c.get('member');
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ posts: [] });

  const posts = await c.env.DB.prepare(`
    SELECT p.*, m.username, m.display_name, m.avatar_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.member_id = ?) as liked
    FROM posts p JOIN members m ON p.member_id = m.id
    WHERE p.content LIKE ? AND p.visibility = 'public'
    ORDER BY p.created_at DESC
    LIMIT 50
  `).bind(member?.id || '', `%${query}%`).all();

  return c.json({ posts: posts.results || [] });
});

// ----- Bookmarks -----

// Get bookmarked posts
app.get('/api/bookmarks', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');

  let query = `
    SELECT p.*, m.username, m.display_name, m.avatar_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.member_id = ?) as liked,
           1 as bookmarked
    FROM bookmarks b
    JOIN posts p ON b.post_id = p.id
    JOIN members m ON p.member_id = m.id
    WHERE b.member_id = ?
  `;
  const params: any[] = [member.id, member.id];

  if (before) {
    query += ` AND b.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY b.created_at DESC LIMIT ?`;
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ posts: posts.results || [] });
});

// ----- Block/Mute -----

// Block user
app.post('/api/block/:memberId', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const targetId = c.req.param('memberId');
  if (targetId === member.id) return c.json({ error: 'Cannot block yourself' }, 400);

  try {
    const id = generateId();
    await c.env.DB.prepare(`INSERT INTO blocks (id, blocker_id, blocked_id) VALUES (?, ?, ?)`)
      .bind(id, member.id, targetId).run();
    // Also unfollow each other
    await c.env.DB.prepare(`DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)`)
      .bind(member.id, targetId, targetId, member.id).run();
  } catch (e) {
    // Already blocked
  }
  return c.json({ success: true });
});

// Unblock user
app.delete('/api/block/:memberId', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const targetId = c.req.param('memberId');
  await c.env.DB.prepare(`DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?`)
    .bind(member.id, targetId).run();
  return c.json({ success: true });
});

// Mute user
app.post('/api/mute/:memberId', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const targetId = c.req.param('memberId');
  if (targetId === member.id) return c.json({ error: 'Cannot mute yourself' }, 400);

  try {
    const id = generateId();
    await c.env.DB.prepare(`INSERT INTO mutes (id, muter_id, muted_id) VALUES (?, ?, ?)`)
      .bind(id, member.id, targetId).run();
  } catch (e) {
    // Already muted
  }
  return c.json({ success: true });
});

// Unmute user
app.delete('/api/mute/:memberId', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const targetId = c.req.param('memberId');
  await c.env.DB.prepare(`DELETE FROM mutes WHERE muter_id = ? AND muted_id = ?`)
    .bind(member.id, targetId).run();
  return c.json({ success: true });
});

// Get blocked users
app.get('/api/blocks', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const blocks = await c.env.DB.prepare(`
    SELECT m.id, m.username, m.display_name, m.avatar_url, b.created_at as blocked_at
    FROM blocks b JOIN members m ON b.blocked_id = m.id
    WHERE b.blocker_id = ?
    ORDER BY b.created_at DESC
  `).bind(member.id).all();

  return c.json({ users: blocks.results || [] });
});

// Get muted users
app.get('/api/mutes', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const mutes = await c.env.DB.prepare(`
    SELECT m.id, m.username, m.display_name, m.avatar_url, mu.created_at as muted_at
    FROM mutes mu JOIN members m ON mu.muted_id = m.id
    WHERE mu.muter_id = ?
    ORDER BY mu.created_at DESC
  `).bind(member.id).all();

  return c.json({ users: mutes.results || [] });
});

// ----- Community Management -----

// Update community
app.put('/api/communities/:id', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const communityId = c.req.param('id');
  const body = await c.req.json<{ name?: string; description?: string }>();

  // Only creator or owner can edit (for now just check member role)
  if (member.role !== 'owner' && member.role !== 'moderator') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name.trim());
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description.trim());
  }

  if (updates.length === 0) {
    return c.json({ error: 'No updates provided' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(communityId);

  await c.env.DB.prepare(`UPDATE communities SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values).run();

  const community = await c.env.DB.prepare(`SELECT * FROM communities WHERE id = ?`).bind(communityId).first();
  return c.json({ community });
});

// Delete community
app.delete('/api/communities/:id', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  const communityId = c.req.param('id');

  // Only owner can delete
  if (member.role !== 'owner') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Set posts in this community to personal (null community_id)
  await c.env.DB.prepare(`UPDATE posts SET community_id = NULL WHERE community_id = ?`)
    .bind(communityId).run();

  await c.env.DB.prepare(`DELETE FROM communities WHERE id = ?`).bind(communityId).run();

  return c.json({ success: true });
});

// ----- Settings -----

// Delete account
app.delete('/api/me', async (c) => {
  const member = c.get('member');
  if (!member) return c.json({ error: 'Unauthorized' }, 401);

  // Cannot delete if owner (need to transfer ownership first)
  if (member.role === 'owner') {
    return c.json({ error: 'Owners cannot delete their account. Transfer ownership first.' }, 400);
  }

  // Delete all related data
  await c.env.DB.prepare(`DELETE FROM sessions WHERE member_id = ?`).bind(member.id).run();
  await c.env.DB.prepare(`DELETE FROM posts WHERE member_id = ?`).bind(member.id).run();
  await c.env.DB.prepare(`DELETE FROM likes WHERE member_id = ?`).bind(member.id).run();
  await c.env.DB.prepare(`DELETE FROM follows WHERE follower_id = ? OR following_id = ?`).bind(member.id, member.id).run();
  await c.env.DB.prepare(`DELETE FROM notifications WHERE member_id = ? OR actor_id = ?`).bind(member.id, member.id).run();
  await c.env.DB.prepare(`DELETE FROM bookmarks WHERE member_id = ?`).bind(member.id).run();
  await c.env.DB.prepare(`DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?`).bind(member.id, member.id).run();
  await c.env.DB.prepare(`DELETE FROM mutes WHERE muter_id = ? OR muted_id = ?`).bind(member.id, member.id).run();
  await c.env.DB.prepare(`DELETE FROM dm_messages WHERE sender_id = ?`).bind(member.id).run();
  await c.env.DB.prepare(`DELETE FROM members WHERE id = ?`).bind(member.id).run();

  return c.json({ success: true });
});

// Serve static files with SPA fallback
app.get('*', async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);

  // If asset not found and not an API route, serve index.html for SPA routing
  if (response.status === 404) {
    const url = new URL(c.req.url);
    url.pathname = '/index.html';
    return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
  }

  return response;
});

export default app;
