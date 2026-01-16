// Utility functions for Yurucommu backend

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

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.localdomain') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  if (isPrivateIPv4(lower)) return true;
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
