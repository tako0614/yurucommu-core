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
  await c.env.DB.prepare('INSERT INTO sessions (id, member_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, actor!.ap_id, expiresAt).run();

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

export default auth;
