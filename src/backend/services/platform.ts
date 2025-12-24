import * as jose from 'jose';
import type { Env, PlatformJWTPayload } from '../types';

export async function verifyPlatformJWT(params: {
  token: string;
  publicKeyPem: string;
  expectedAudience: string;
}): Promise<PlatformJWTPayload> {
  const { token, publicKeyPem, expectedAudience } = params;

  const publicKey = await jose.importSPKI(publicKeyPem, 'ES256');

  const { payload } = await jose.jwtVerify(token, publicKey, {
    issuer: 'takos-private',
    audience: expectedAudience,
  });

  const iss = typeof payload.iss === 'string' ? payload.iss : null;
  const aud = typeof payload.aud === 'string' ? payload.aud : null;
  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  const role = payload.role as PlatformJWTPayload['role'] | undefined;
  const iat = typeof payload.iat === 'number' ? payload.iat : null;
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  const jti = typeof payload.jti === 'string' ? payload.jti : null;
  const validRole = role === 'owner' || role === 'admin' || role === 'editor';

  if (!iss || !aud || !sub || !validRole || !iat || !exp || !jti) {
    throw new Error('Invalid platform token payload');
  }

  return {
    iss,
    aud,
    sub,
    role,
    iat,
    exp,
    jti,
  };
}

export async function isJTIUsed(env: Env, jti: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `SELECT jti FROM used_jtis WHERE jti = ?`
  ).bind(jti).first();
  return result !== null;
}

export async function markJTIUsed(env: Env, jti: string, expiresAt: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO used_jtis (jti, expires_at) VALUES (?, ?)`
  ).bind(jti, expiresAt).run();
}

export async function cleanupExpiredJTIs(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `DELETE FROM used_jtis WHERE expires_at < ?`
  ).bind(now).run();
}

export interface PlatformCapabilities {
  protocol: number;
  sso: boolean;
  admin_api: boolean;
}

export function getCapabilities(): PlatformCapabilities {
  return {
    protocol: 1,
    sso: true,
    admin_api: true,
  };
}
