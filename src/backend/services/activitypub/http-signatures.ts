import * as jose from 'jose';

// Maximum age of Date header (5 minutes)
const MAX_DATE_SKEW_MS = 5 * 60 * 1000;

export interface SignatureVerificationResult {
  valid: boolean;
  error?: string;
  keyId?: string;
  signedHeaders?: string[];
}

export async function generateKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  const privateKey = await jose.exportPKCS8(await jose.importJWK(privateKeyJwk, 'RS256'));
  const publicKey = await jose.exportSPKI(await jose.importJWK(publicKeyJwk, 'RS256'));

  return { privateKey, publicKey };
}

function base64Encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function signRequest(params: {
  method: string;
  url: string;
  body?: string;
  privateKeyPem: string;
  keyId: string;
}): Promise<Record<string, string>> {
  const { method, url, body, privateKeyPem, keyId } = params;

  const parsedUrl = new URL(url);
  const date = new Date().toUTCString();
  const digest = body
    ? `SHA-256=${base64Encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))}`
    : undefined;

  const signedHeaders = ['(request-target)', 'host', 'date'];
  if (digest) signedHeaders.push('digest');

  const signingString = signedHeaders
    .map((header) => {
      switch (header) {
        case '(request-target)':
          return `(request-target): ${method.toLowerCase()} ${parsedUrl.pathname}`;
        case 'host':
          return `host: ${parsedUrl.host}`;
        case 'date':
          return `date: ${date}`;
        case 'digest':
          return `digest: ${digest}`;
        default:
          return '';
      }
    })
    .join('\n');

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingString)
  );

  const signatureBase64 = base64Encode(signature);
  const signatureHeader = `keyId="${keyId}",algorithm="rsa-sha256",headers="${signedHeaders.join(' ')}",signature="${signatureBase64}"`;

  const headers: Record<string, string> = {
    Date: date,
    Signature: signatureHeader,
  };

  if (digest) {
    headers['Digest'] = digest;
  }

  return headers;
}

function base64Decode(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Parse HTTP Signature header
 */
function parseSignatureHeader(signatureHeader: string): Record<string, string> {
  const parts: Record<string, string> = {};

  // Handle both comma-separated and quoted values
  const regex = /(\w+)="([^"]+)"/g;
  let match;
  while ((match = regex.exec(signatureHeader)) !== null) {
    parts[match[1]] = match[2];
  }

  return parts;
}

/**
 * Verify the Date header is within acceptable range
 */
function verifyDateHeader(dateHeader: string | null): { valid: boolean; error?: string } {
  if (!dateHeader) {
    return { valid: false, error: 'Missing Date header' };
  }

  const requestDate = new Date(dateHeader);
  if (isNaN(requestDate.getTime())) {
    return { valid: false, error: 'Invalid Date header format' };
  }

  const now = Date.now();
  const diff = Math.abs(now - requestDate.getTime());

  if (diff > MAX_DATE_SKEW_MS) {
    return { valid: false, error: `Date header is too old or too far in future (${Math.round(diff / 1000)}s skew)` };
  }

  return { valid: true };
}

/**
 * Verify the Digest header matches the body
 */
async function verifyDigestHeader(
  digestHeader: string | null,
  body: string | null
): Promise<{ valid: boolean; error?: string }> {
  // Digest is optional but if present, must match
  if (!digestHeader) {
    // No digest header is acceptable for requests without body
    if (!body) {
      return { valid: true };
    }
    // For requests with body, we prefer to have a digest but don't require it for compatibility
    return { valid: true };
  }

  if (!body) {
    return { valid: false, error: 'Digest header present but no body' };
  }

  // Parse digest header (format: "SHA-256=base64hash")
  const match = digestHeader.match(/^([A-Za-z0-9-]+)=(.+)$/);
  if (!match) {
    return { valid: false, error: 'Invalid Digest header format' };
  }

  const [, algorithm, expectedHash] = match;

  if (algorithm.toUpperCase() !== 'SHA-256') {
    return { valid: false, error: `Unsupported digest algorithm: ${algorithm}` };
  }

  const actualHash = base64Encode(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  );

  if (actualHash !== expectedHash) {
    return { valid: false, error: 'Digest mismatch' };
  }

  return { valid: true };
}

/**
 * Verify HTTP Signature (signature only, not Date or Digest)
 */
export async function verifySignature(params: {
  request: Request;
  publicKeyPem: string;
}): Promise<boolean> {
  const result = await verifySignatureWithDetails(params);
  return result.valid;
}

/**
 * Verify HTTP Signature with detailed result
 */
export async function verifySignatureWithDetails(params: {
  request: Request;
  publicKeyPem: string;
}): Promise<SignatureVerificationResult> {
  const { request, publicKeyPem } = params;

  const signatureHeader = request.headers.get('Signature');
  if (!signatureHeader) {
    return { valid: false, error: 'Missing Signature header' };
  }

  // Parse signature header
  const parts = parseSignatureHeader(signatureHeader);
  const { keyId, headers: signedHeadersStr, signature, algorithm } = parts;

  if (!keyId) {
    return { valid: false, error: 'Missing keyId in Signature header' };
  }

  if (!signature) {
    return { valid: false, error: 'Missing signature in Signature header' };
  }

  if (!signedHeadersStr) {
    return { valid: false, error: 'Missing headers in Signature header' };
  }

  // Verify algorithm (optional, but if present must be supported)
  if (algorithm && algorithm !== 'rsa-sha256' && algorithm !== 'hs2019') {
    return { valid: false, error: `Unsupported signature algorithm: ${algorithm}` };
  }

  const signedHeaders = signedHeadersStr.split(' ');

  // Required headers for security
  if (!signedHeaders.includes('(request-target)')) {
    return { valid: false, error: 'Signature must include (request-target)' };
  }

  if (!signedHeaders.includes('host')) {
    return { valid: false, error: 'Signature must include host' };
  }

  if (!signedHeaders.includes('date')) {
    return { valid: false, error: 'Signature must include date' };
  }

  const url = new URL(request.url);

  // Build signing string
  const signingStringParts: string[] = [];
  for (const header of signedHeaders) {
    let value: string;
    switch (header) {
      case '(request-target)':
        value = `${request.method.toLowerCase()} ${url.pathname}`;
        break;
      case 'host':
        value = request.headers.get('Host') || url.host;
        break;
      case 'date':
        value = request.headers.get('Date') || '';
        break;
      case 'digest':
        value = request.headers.get('Digest') || '';
        break;
      case 'content-type':
        value = request.headers.get('Content-Type') || '';
        break;
      case 'content-length':
        value = request.headers.get('Content-Length') || '';
        break;
      default:
        value = request.headers.get(header) || '';
    }
    signingStringParts.push(`${header}: ${value}`);
  }

  const signingString = signingStringParts.join('\n');

  try {
    const publicKey = await crypto.subtle.importKey(
      'spki',
      pemToArrayBuffer(publicKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signatureBytes = base64Decode(signature);

    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signatureBytes,
      new TextEncoder().encode(signingString)
    );

    if (!isValid) {
      return { valid: false, error: 'Signature verification failed', keyId, signedHeaders };
    }

    return { valid: true, keyId, signedHeaders };
  } catch (err) {
    return { valid: false, error: `Crypto error: ${err}`, keyId, signedHeaders };
  }
}

/**
 * Comprehensive request verification including Date, Digest, and Signature
 */
export async function verifyRequest(params: {
  request: Request;
  body: string | null;
  publicKeyPem: string;
  strictMode?: boolean;
}): Promise<SignatureVerificationResult> {
  const { request, body, publicKeyPem, strictMode = false } = params;

  // 1. Verify Date header
  const dateResult = verifyDateHeader(request.headers.get('Date'));
  if (!dateResult.valid) {
    if (strictMode) {
      return { valid: false, error: dateResult.error };
    }
    console.warn(`Date verification warning: ${dateResult.error}`);
  }

  // 2. Verify Digest header (if present)
  const digestResult = await verifyDigestHeader(request.headers.get('Digest'), body);
  if (!digestResult.valid) {
    return { valid: false, error: digestResult.error };
  }

  // 3. Verify Signature
  const signatureResult = await verifySignatureWithDetails({
    request,
    publicKeyPem,
  });

  return signatureResult;
}

/**
 * Extract keyId from Signature header
 */
export function extractKeyId(signatureHeader: string | null): string | null {
  if (!signatureHeader) return null;
  const parts = parseSignatureHeader(signatureHeader);
  return parts.keyId || null;
}
