import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import type { Env, Variables, Actor } from '../types';
import { sessions } from '../../db';

function isExpired(expiresAt: string): boolean {
  const expiresMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresMs) || expiresMs <= Date.now();
}

/**
 * Look up the session cookie, load the associated member, and set `c.var.actor`
 * if the session is valid and unexpired.
 */
export async function extractActorFromSession(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<void> {
  const sessionId = getCookie(c, 'session');
  if (!sessionId) return;

  const db = c.get('db');
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    with: { member: true },
  });

  if (!session || isExpired(session.expiresAt)) return;

  const m = session.member;
  const actor: Actor = {
    ap_id: m.apId,
    type: m.type,
    preferred_username: m.preferredUsername,
    name: m.name,
    summary: m.summary,
    icon_url: m.iconUrl,
    header_url: m.headerUrl,
    inbox: m.inbox,
    outbox: m.outbox,
    followers_url: m.followersUrl,
    following_url: m.followingUrl,
    public_key_pem: m.publicKeyPem,
    private_key_pem: m.privateKeyPem,
    takos_user_id: m.takosUserId,
    follower_count: m.followerCount,
    following_count: m.followingCount,
    post_count: m.postCount,
    is_private: m.isPrivate,
    role: m.role as 'owner' | 'moderator' | 'member',
    created_at: m.createdAt,
  };
  c.set('actor', actor);
}
