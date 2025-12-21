import type { Env, Session } from '../types';

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateSessionId(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer);
}

export async function createSession(env: Env, userId: string): Promise<Session> {
  const session: Session = {
    id: generateSessionId(),
    user_id: userId,
    expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    created_at: Date.now(),
  };

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).bind(session.id, session.user_id, session.expires_at, session.created_at).run();

  return session;
}

export async function getSession(env: Env, sessionId: string): Promise<Session | null> {
  const session = await env.DB.prepare(
    `SELECT * FROM sessions WHERE id = ?`
  ).bind(sessionId).first<Session>();

  if (!session) return null;

  if (session.expires_at < Date.now()) {
    await deleteSession(env, sessionId);
    return null;
  }

  return session;
}

export async function deleteSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM sessions WHERE id = ?`
  ).bind(sessionId).run();
}

export async function cleanupExpiredSessions(env: Env): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM sessions WHERE expires_at < ?`
  ).bind(Date.now()).run();
}

export const SESSION_COOKIE_NAME = '__Host-takos_session';

export function setSessionCookie(sessionId: string, maxAge: number): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getSessionIdFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === SESSION_COOKIE_NAME) {
      return value;
    }
  }
  return null;
}
