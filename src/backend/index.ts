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
}

interface Room {
  id: string;
  name: string;
  description: string | null;
  kind: 'chat' | 'forum';
  posting_policy: 'members' | 'mods' | 'owners';
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
      });
    }
  }
  await next();
});

// Auth routes
app.get('/api/auth/login', async (c) => {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const takosUrl = c.env.TAKOS_URL || 'https://takos.jp';
  const appUrl = c.env.APP_URL || 'https://app.yurucommu.com';

  // Store state and code_verifier in cookies for verification
  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 600,
    path: '/',
  });
  setCookie(c, 'oauth_verifier', codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 600,
    path: '/',
  });

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

  // Exchange code for tokens (with PKCE code_verifier)
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

  // Get user info
  const userRes = await fetch(`${takosUrl}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return c.json({ error: 'Failed to get user info' }, 400);
  }

  const userInfo = await userRes.json() as { sub: string; preferred_username?: string; name?: string; picture?: string };

  // Find or create member
  let member = await c.env.DB.prepare(
    'SELECT * FROM members WHERE takos_user_id = ?'
  ).bind(userInfo.sub).first<Member>();

  if (!member) {
    // First user becomes owner
    const memberCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM members').first<{ count: number }>();
    const role = memberCount?.count === 0 ? 'owner' : 'member';

    const memberId = generateId();
    await c.env.DB.prepare(
      `INSERT INTO members (id, takos_user_id, username, display_name, avatar_url, role)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      memberId,
      userInfo.sub,
      userInfo.preferred_username || `user_${memberId.slice(0, 8)}`,
      userInfo.name || null,
      userInfo.picture || null,
      role
    ).run();

    member = {
      id: memberId,
      takos_user_id: userInfo.sub,
      username: userInfo.preferred_username || `user_${memberId.slice(0, 8)}`,
      display_name: userInfo.name || null,
      avatar_url: userInfo.picture || null,
      role: role as 'owner' | 'moderator' | 'member',
    };
  }

  // Create session
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, member_id, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(sessionId, member.id, tokens.access_token, tokens.refresh_token || null, expiresAt).run();

  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: tokens.expires_in,
    path: '/',
  });

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

// Rooms API
app.get('/api/rooms', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM rooms ORDER BY sort_order ASC, created_at ASC'
  ).all<Room>();
  return c.json({ rooms: result.results || [] });
});

app.post('/api/rooms', async (c) => {
  const member = c.get('member');
  if (!member || (member.role !== 'owner' && member.role !== 'moderator')) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  const body = await c.req.json<{ name: string; description?: string }>();
  if (!body.name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const id = generateId();
  await c.env.DB.prepare(
    `INSERT INTO rooms (id, name, description) VALUES (?, ?, ?)`
  ).bind(id, body.name, body.description || null).run();

  return c.json({ id, name: body.name, description: body.description || null }, 201);
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
  const body = await c.req.json<{ name?: string; description?: string; posting_policy?: string }>();

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name);
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description);
  }
  if (body.posting_policy !== undefined) {
    updates.push('posting_policy = ?');
    values.push(body.posting_policy);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  await c.env.DB.prepare(
    `UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return c.json({ success: true });
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

// Messages API
app.get('/api/rooms/:roomId/messages', async (c) => {
  const roomId = c.req.param('roomId');
  const before = c.req.query('before');
  const since = c.req.query('since');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

  let query = `
    SELECT m.*, mem.username, mem.display_name, mem.avatar_url
    FROM messages m
    JOIN members mem ON m.member_id = mem.id
    WHERE m.room_id = ?
  `;
  const params: unknown[] = [roomId];

  if (before) {
    query += ' AND m.created_at < ?';
    params.push(before);
  }

  if (since) {
    query += ' AND m.created_at > ?';
    params.push(since);
  }

  query += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);

  const result = await c.env.DB.prepare(query).bind(...params).all();
  const messages = (result.results || []).reverse();

  // Fetch attachments for all messages
  if (messages.length > 0) {
    const messageIds = messages.map((m: any) => m.id);
    const placeholders = messageIds.map(() => '?').join(',');
    const attachmentsResult = await c.env.DB.prepare(
      `SELECT * FROM attachments WHERE message_id IN (${placeholders})`
    ).bind(...messageIds).all();

    const attachmentsByMessage = new Map<string, any[]>();
    for (const att of attachmentsResult.results || []) {
      const msgId = (att as any).message_id;
      if (!attachmentsByMessage.has(msgId)) {
        attachmentsByMessage.set(msgId, []);
      }
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
  if (!member) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const roomId = c.req.param('roomId');
  const room = await c.env.DB.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId).first<Room>();
  if (!room) {
    return c.json({ error: 'Room not found' }, 404);
  }

  // Check posting policy
  if (room.posting_policy === 'owners' && member.role !== 'owner') {
    return c.json({ error: 'Only owners can post in this room' }, 403);
  }
  if (room.posting_policy === 'mods' && member.role === 'member') {
    return c.json({ error: 'Only moderators can post in this room' }, 403);
  }

  const body = await c.req.json<{ content: string; reply_to_id?: string; attachments?: Array<{ r2_key: string; content_type: string; filename: string; size: number }> }>();
  if (!body.content && (!body.attachments || body.attachments.length === 0)) {
    return c.json({ error: 'Content or attachments required' }, 400);
  }

  const id = generateId();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO messages (id, room_id, member_id, content, reply_to_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, roomId, member.id, body.content || '', body.reply_to_id || null, now, now).run();

  // Save attachments if provided
  const savedAttachments: Array<{ id: string; r2_key: string; content_type: string; filename: string; size: number }> = [];
  if (body.attachments && body.attachments.length > 0) {
    for (const att of body.attachments) {
      const attId = generateId();
      await c.env.DB.prepare(
        `INSERT INTO attachments (id, message_id, r2_key, content_type, filename, size)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(attId, id, att.r2_key, att.content_type, att.filename, att.size).run();
      savedAttachments.push({ id: attId, ...att });
    }
  }

  return c.json({
    id,
    room_id: roomId,
    member_id: member.id,
    content: body.content || '',
    reply_to_id: body.reply_to_id || null,
    created_at: now,
    updated_at: now,
    username: member.username,
    display_name: member.display_name,
    avatar_url: member.avatar_url,
    attachments: savedAttachments,
  }, 201);
});

app.put('/api/rooms/:roomId/messages/:id', async (c) => {
  const member = c.get('member');
  if (!member) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const id = c.req.param('id');
  const message = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<Message>();

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }
  if (message.member_id !== member.id) {
    return c.json({ error: 'Can only edit your own messages' }, 403);
  }

  const body = await c.req.json<{ content: string }>();
  if (!body.content) {
    return c.json({ error: 'Content is required' }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE messages SET content = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(body.content, id).run();

  return c.json({ success: true });
});

app.delete('/api/rooms/:roomId/messages/:id', async (c) => {
  const member = c.get('member');
  if (!member) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const id = c.req.param('id');
  const message = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<Message>();

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Can delete own messages or moderators/owners can delete any
  if (message.member_id !== member.id && member.role === 'member') {
    return c.json({ error: 'Cannot delete this message' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// Members API
app.get('/api/members', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT id, username, display_name, avatar_url, role, created_at FROM members ORDER BY created_at ASC'
  ).all();
  return c.json({ members: result.results || [] });
});

app.get('/api/members/:id', async (c) => {
  const id = c.req.param('id');
  const member = await c.env.DB.prepare(
    'SELECT id, username, display_name, avatar_url, role, created_at FROM members WHERE id = ?'
  ).bind(id).first();
  if (!member) {
    return c.json({ error: 'Member not found' }, 404);
  }
  return c.json({ member });
});

app.put('/api/members/:id/role', async (c) => {
  const currentMember = c.get('member');
  if (!currentMember || currentMember.role !== 'owner') {
    return c.json({ error: 'Only owners can change roles' }, 403);
  }

  const id = c.req.param('id');
  const body = await c.req.json<{ role: string }>();

  if (!['owner', 'moderator', 'member'].includes(body.role)) {
    return c.json({ error: 'Invalid role' }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE members SET role = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(body.role, id).run();

  return c.json({ success: true });
});

app.delete('/api/members/:id', async (c) => {
  const currentMember = c.get('member');
  if (!currentMember || (currentMember.role !== 'owner' && currentMember.role !== 'moderator')) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  const id = c.req.param('id');

  // Cannot delete yourself or owners
  if (id === currentMember.id) {
    return c.json({ error: 'Cannot delete yourself' }, 400);
  }

  const targetMember = await c.env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first<Member>();
  if (!targetMember) {
    return c.json({ error: 'Member not found' }, 404);
  }
  if (targetMember.role === 'owner') {
    return c.json({ error: 'Cannot delete an owner' }, 403);
  }

  // Delete sessions first
  await c.env.DB.prepare('DELETE FROM sessions WHERE member_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM members WHERE id = ?').bind(id).run();

  return c.json({ success: true });
});

// Media upload API
app.post('/api/upload', async (c) => {
  const member = c.get('member');
  if (!member) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;

  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  // Validate file type (images only for now)
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: 'Invalid file type. Only images allowed.' }, 400);
  }

  // Max 10MB
  if (file.size > 10 * 1024 * 1024) {
    return c.json({ error: 'File too large. Max 10MB.' }, 400);
  }

  const id = generateId();
  const ext = file.name.split('.').pop() || 'bin';
  const r2Key = `uploads/${id}.${ext}`;

  // Upload to R2
  await c.env.MEDIA.put(r2Key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
    },
  });

  return c.json({
    id,
    r2_key: r2Key,
    content_type: file.type,
    filename: file.name,
    size: file.size,
  }, 201);
});

// Serve media files from R2
app.get('/media/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.MEDIA.get(key);

  if (!object) {
    return c.json({ error: 'Not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000');

  return new Response(object.body, { headers });
});

// Get attachments for a message
app.get('/api/messages/:messageId/attachments', async (c) => {
  const messageId = c.req.param('messageId');
  const result = await c.env.DB.prepare(
    'SELECT * FROM attachments WHERE message_id = ?'
  ).bind(messageId).all();
  return c.json({ attachments: result.results || [] });
});

// Health check
app.get('/api/health', (c) => c.json({ ok: true }));

// Serve static files
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
