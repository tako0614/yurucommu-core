import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, Variables, Actor } from '../types';
import { generateId, actorApId, formatUsername, generateKeyPair } from '../utils';

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

auth.get('/me', async (c) => {
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

auth.post('/login', async (c) => {
  if (c.env.AUTH_MODE !== 'password') {
    return c.json({ error: 'Password auth not enabled' }, 400);
  }

  const body = await c.req.json<{ password: string }>();
  if (body.password !== c.env.AUTH_PASSWORD) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  // Single-user instance: find existing owner or create default
  let actor = await c.env.DB.prepare("SELECT * FROM actors WHERE role = 'owner' LIMIT 1").first<Actor>();

  if (!actor) {
    // Create default owner actor
    const baseUrl = c.env.APP_URL;
    const username = 'tako';
    const apId = actorApId(baseUrl, username);

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

  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (id, member_id, access_token, expires_at) VALUES (?, ?, ?, ?)').bind(sessionId, actor!.ap_id, sessionId, expiresAt).run();

  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });

  return c.json({ success: true });
});

auth.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    deleteCookie(c, 'session');
  }
  return c.json({ success: true });
});

// Get all accounts (for account switching)
auth.get('/accounts', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Not authenticated' }, 401);

  const accounts = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, icon_url
    FROM actors ORDER BY created_at ASC
  `).all();

  return c.json({
    accounts: (accounts.results || []).map((a: any) => ({
      ap_id: a.ap_id,
      preferred_username: a.preferred_username,
      name: a.name,
      icon_url: a.icon_url,
    })),
    current_ap_id: actor.ap_id,
  });
});

// Switch to a different account
auth.post('/switch', async (c) => {
  const currentActor = c.get('actor');
  if (!currentActor) return c.json({ error: 'Not authenticated' }, 401);

  const sessionId = getCookie(c, 'session');
  if (!sessionId) return c.json({ error: 'No session' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);

  // Verify the target account exists
  const targetActor = await c.env.DB.prepare('SELECT ap_id FROM actors WHERE ap_id = ?')
    .bind(body.ap_id).first();

  if (!targetActor) return c.json({ error: 'Account not found' }, 404);

  // Update session to point to new account
  await c.env.DB.prepare('UPDATE sessions SET member_id = ? WHERE id = ?')
    .bind(body.ap_id, sessionId).run();

  return c.json({ success: true });
});

// Create a new account
auth.post('/accounts', async (c) => {
  const currentActor = c.get('actor');
  if (!currentActor) return c.json({ error: 'Not authenticated' }, 401);

  const body = await c.req.json<{ username: string; name?: string }>();
  if (!body.username) return c.json({ error: 'username required' }, 400);

  // Validate username (alphanumeric and underscore only)
  if (!/^[a-zA-Z0-9_]+$/.test(body.username)) {
    return c.json({ error: 'Invalid username. Use only letters, numbers, and underscores.' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, body.username);

  // Check if username already exists
  const existing = await c.env.DB.prepare('SELECT ap_id FROM actors WHERE ap_id = ?')
    .bind(apId).first();

  if (existing) return c.json({ error: 'Username already taken' }, 400);

  // Create new actor
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  await c.env.DB.prepare(`
    INSERT INTO actors (ap_id, type, preferred_username, name, inbox, outbox, followers_url, following_url, public_key_pem, private_key_pem, takos_user_id, role)
    VALUES (?, 'Person', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'member')
  `).bind(
    apId,
    body.username,
    body.name || body.username,
    `${apId}/inbox`,
    `${apId}/outbox`,
    `${apId}/followers`,
    `${apId}/following`,
    publicKeyPem,
    privateKeyPem,
    `local:${body.username}`
  ).run();

  const newActor = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, icon_url FROM actors WHERE ap_id = ?
  `).bind(apId).first();

  return c.json({ success: true, account: newActor });
});

export default auth;
