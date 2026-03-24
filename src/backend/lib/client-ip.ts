import type { Context } from 'hono';
import type { Env, Variables } from '../types';

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]+$/;

/**
 * Validate IP address format (basic check).
 */
function isValidIP(ip: string): boolean {
  if (IPV4_PATTERN.test(ip)) {
    return ip.split('.').map(Number).every((part) => part >= 0 && part <= 255);
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
  const candidates = [
    c.req.header('CF-Connecting-IP'),
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim(),
    c.req.header('X-Real-IP'),
  ];

  for (const ip of candidates) {
    if (ip && isValidIP(ip)) return ip;
  }

  return 'unknown';
}
