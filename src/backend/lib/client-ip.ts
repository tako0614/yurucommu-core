import type { Context } from 'hono';
import type { Env, Variables } from '../types';

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]+$/;

/**
 * Validate IP address format (basic check).
 */
export function isValidIP(ip: string): boolean {
  if (IPV4_PATTERN.test(ip)) {
    const parts = ip.split('.').map(Number);
    return parts.every((part) => part >= 0 && part <= 255);
  }

  return IPV6_PATTERN.test(ip) && ip.includes(':');
}

/**
 * Extract client IP with proper validation.
 * Priority: CF-Connecting-IP > X-Forwarded-For (first) > X-Real-IP > "unknown"
 */
export function getClientIP(
  c: Context<{ Bindings: Env; Variables: Variables }>
): string {
  const cfIp = c.req.header('CF-Connecting-IP');
  if (cfIp && isValidIP(cfIp)) {
    return cfIp;
  }

  const xff = c.req.header('X-Forwarded-For');
  if (xff) {
    const firstIp = xff.split(',')[0]?.trim();
    if (firstIp && isValidIP(firstIp)) {
      return firstIp;
    }
  }

  const realIp = c.req.header('X-Real-IP');
  if (realIp && isValidIP(realIp)) {
    return realIp;
  }

  return 'unknown';
}
