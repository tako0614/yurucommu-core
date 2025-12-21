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

  return {
    iss: payload.iss as string,
    aud: payload.aud as string,
    sub: payload.sub as string,
    role: payload.role as 'owner' | 'admin' | 'editor',
    iat: payload.iat as number,
    exp: payload.exp as number,
    jti: payload.jti as string,
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
