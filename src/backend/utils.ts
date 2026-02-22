// Utility functions for Yurucommu backend

// Re-export error types and utilities from local lib
export {
  // Error codes
  ErrorCodes,
  type ErrorCode,
  // Error classes
  AppError,
  BadRequestError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  InternalError,
  ServiceUnavailableError,
  // Utilities
  isAppError,
  normalizeError,
  logError,
  handleDatabaseError,
  type ErrorResponse,
  type ValidationErrorDetail,
} from './lib/errors';

// Re-export Hono error helpers for route handlers
export {
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  validationError,
  validationErrorWithFields,
  internalError,
  serviceUnavailable,
  rateLimited,
  handleDbError,
  throwBadRequest,
  throwUnauthorized,
  throwForbidden,
  throwNotFound,
  throwConflict,
  throwValidation,
  throwInternalError,
  throwServiceUnavailable,
  throwRateLimited,
} from './middleware/error-handler';

/**
 * Safely parse JSON with a fallback value on parse failure.
 * Returns the default value if json is null, undefined, or invalid JSON.
 */
export function safeJsonParse<T>(json: string | null | undefined, defaultValue: T): T {
  if (!json) return defaultValue;
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    // MEDIUM FIX: Log the error for debugging
    console.warn('[Utils] safeJsonParse failed:', err);
    return defaultValue;
  }
}

function parseBoundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function parseLimit(value: string | undefined, fallback: number, max: number): number {
  return parseBoundedInt(value, fallback, 1, max);
}

export function parseOffset(value: string | undefined, fallback: number, max: number): number {
  return parseBoundedInt(value, fallback, 0, max);
}

export function generateId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate AP IRI for local resources
export function actorApId(baseUrl: string, username: string): string {
  return `${baseUrl}/ap/users/${username}`;
}

export function objectApId(baseUrl: string, id: string): string {
  return `${baseUrl}/ap/objects/${id}`;
}

export function activityApId(baseUrl: string, id: string): string {
  return `${baseUrl}/ap/activities/${id}`;
}

export function communityApId(baseUrl: string, name: string): string {
  return `${baseUrl}/ap/groups/${name}`;
}

// Extract domain from AP IRI
export function getDomain(apId: string): string {
  return new URL(apId).host;
}

// Check if AP IRI is local
export function isLocal(apId: string, baseUrl: string): boolean {
  return apId.startsWith(baseUrl);
}

// Format username with domain for display
export function formatUsername(apId: string): string {
  const url = new URL(apId);
  const match = apId.match(/\/users\/([^\/]+)$/);
  if (match) {
    return `${match[1]}@${url.host}`;
  }
  return apId;
}

const HOSTNAME_PATTERN = /^[a-z0-9.-]+$/i;
const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

function parseIPv4(hostname: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = parseIPv4(hostname);
  if (!parts) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ipv6Raw: string): boolean {
  const ipv6 = ipv6Raw.toLowerCase().replace(/^\[|\]$/g, '');
  if (ipv6 === '::1' || ipv6 === '0:0:0:0:0:0:0:1') return true;
  if (ipv6 === '::' || ipv6 === '0:0:0:0:0:0:0:0') return true;
  if (ipv6.startsWith('fc') || ipv6.startsWith('fd')) return true;
  if (ipv6.startsWith('fe8') || ipv6.startsWith('fe9') || ipv6.startsWith('fea') || ipv6.startsWith('feb')) return true;
  if (ipv6.startsWith('ff')) return true;

  const mappedIpv4 = ipv6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedIpv4) {
    return isPrivateIPv4(mappedIpv4[1]);
  }

  return false;
}

export function isPrivateIpAddress(host: string): boolean {
  if (isPrivateIPv4(host)) return true;
  if (host.includes(':')) return isPrivateIPv6(host);
  return false;
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  return normalized.endsWith('.') ? normalized.slice(0, -1) : normalized;
}

export function isBlockedHostname(hostname: string): boolean {
  const lower = normalizeHostname(hostname);
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.localdomain') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  if (isPrivateIpAddress(lower)) return true;
  return false;
}

export function isSafeRemoteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (!HOSTNAME_PATTERN.test(parsed.hostname)) return false;
    if (!parsed.hostname.includes('.')) return false;
    if (isBlockedHostname(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a remote domain for safe use
 * Returns the normalized host or null if invalid
 */
export function normalizeRemoteDomain(domain: string): string | null {
  const trimmed = domain.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(`https://${trimmed}`);
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    const hostname = parsed.hostname;
    if (!HOSTNAME_PATTERN.test(hostname)) return null;
    if (!hostname.includes('.')) return null;
    if (isBlockedHostname(hostname)) return null;
    return parsed.host;
  } catch {
    return null;
  }
}

async function dohResolve(hostname: string, type: 'A' | 'AAAA' | 'CNAME'): Promise<Array<{ type: number; data: string }>> {
  const response = await fetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`, {
    headers: { Accept: 'application/dns-json' },
    redirect: 'manual',
  });

  if (!response.ok) {
    throw new Error(`DoH lookup failed (${response.status})`);
  }

  const json = await response.json() as {
    Answer?: Array<{ type?: number; data?: string }>;
  };

  return (json.Answer ?? [])
    .filter((answer): answer is { type: number; data: string } => typeof answer.type === 'number' && typeof answer.data === 'string');
}

export async function resolveRemoteHostnameIPs(hostname: string): Promise<string[]> {
  const visited = new Set<string>();
  const ips = new Set<string>();

  async function walk(name: string, depth: number): Promise<void> {
    if (depth > 10) {
      throw new Error('DNS resolution exceeded max depth');
    }

    const normalized = normalizeHostname(name);
    if (visited.has(normalized)) return;
    visited.add(normalized);

    const [aAnswers, aaaaAnswers, cnameAnswers] = await Promise.all([
      dohResolve(normalized, 'A'),
      dohResolve(normalized, 'AAAA'),
      dohResolve(normalized, 'CNAME'),
    ]);

    for (const answer of aAnswers) {
      if (answer.type === 1) {
        ips.add(answer.data);
      }
    }

    for (const answer of aaaaAnswers) {
      if (answer.type === 28) {
        ips.add(answer.data);
      }
    }

    for (const answer of cnameAnswers) {
      if (answer.type === 5) {
        // eslint-disable-next-line no-await-in-loop
        await walk(answer.data, depth + 1);
      }
    }
  }

  await walk(hostname, 0);
  return Array.from(ips);
}

export async function assertSafeRemoteUrlResolved(url: string): Promise<void> {
  if (!isSafeRemoteUrl(url)) {
    throw new Error(`Unsafe remote URL: ${url}`);
  }

  const parsed = new URL(url);
  const hostname = normalizeHostname(parsed.hostname);
  if (isBlockedHostname(hostname)) {
    throw new Error(`Blocked hostname: ${hostname}`);
  }

  const resolvedIps = await resolveRemoteHostnameIPs(hostname);
  if (resolvedIps.length === 0) {
    throw new Error(`Failed to resolve hostname: ${hostname}`);
  }

  for (const ip of resolvedIps) {
    if (isPrivateIpAddress(ip)) {
      throw new Error(`Hostname ${hostname} resolved to private IP ${ip}`);
    }
  }
}

// RSA key generation
export async function generateKeyPair(): Promise<{ publicKeyPem: string; privateKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );

  const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(publicKey))).match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(privateKey))).match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`;

  return { publicKeyPem, privateKeyPem };
}

// HTTP Signature
export async function signRequest(privateKeyPem: string, keyId: string, method: string, url: string, body?: string): Promise<Record<string, string>> {
  const urlObj = new URL(url);
  const date = new Date().toUTCString();
  const digest = body ? `SHA-256=${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))))}` : undefined;

  const signedHeaders = digest ? '(request-target) host date digest' : '(request-target) host date';
  const signatureString = digest
    ? `(request-target): ${method.toLowerCase()} ${urlObj.pathname}\nhost: ${urlObj.host}\ndate: ${date}\ndigest: ${digest}`
    : `(request-target): ${method.toLowerCase()} ${urlObj.pathname}\nhost: ${urlObj.host}\ndate: ${date}`;

  const pemContents = privateKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signatureBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signatureString));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  const headers: Record<string, string> = {
    'Date': date,
    'Host': urlObj.host,
    'Signature': `keyId="${keyId}",algorithm="rsa-sha256",headers="${signedHeaders}",signature="${signature}"`,
  };
  if (digest) headers['Digest'] = digest;

  return headers;
}

// Default timeout for external HTTP requests (30 seconds)
const DEFAULT_FETCH_TIMEOUT_MS = 30000;

/**
 * Fetch with timeout support
 * Wraps the standard fetch API with AbortController for timeout handling
 *
 * @param url - URL to fetch
 * @param options - Fetch options with optional timeout
 * @returns Response or throws on timeout/error
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number; skipSafetyCheck?: boolean } = {}
): Promise<Response> {
  const {
    timeout = DEFAULT_FETCH_TIMEOUT_MS,
    skipSafetyCheck = false,
    ...fetchOptions
  } = options;

  if (!skipSafetyCheck) {
    await assertSafeRemoteUrlResolved(url);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      redirect: 'manual', // Prevent redirect-based SSRF bypassing DNS safety checks
    });
    // Reject redirects to prevent SSRF via open redirects on remote servers
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Redirect not allowed from remote URL: ${url} -> ${response.headers.get('location')}`);
    }
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout / 1000} seconds: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
