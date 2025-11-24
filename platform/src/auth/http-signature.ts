/**
 * HTTP Signatures implementation for ActivityPub
 * Based on: https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures
 *
 * Used for signing outgoing requests and verifying incoming requests
 */

import type { Context } from "hono";
import { importPrivateKey, importPublicKey } from "./crypto-keys";

export interface SignatureParams {
  keyId: string;
  privateKeyPem: string;
  headers: string[];
}

export interface ParsedSignature {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
}

/**
 * Generate HTTP Signature header for a request
 *
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - Request path (e.g., /ap/users/alice/inbox)
 * @param host - Target host (e.g., mastodon.social)
 * @param body - Request body (for POST/PUT)
 * @param params - Signature parameters
 * @returns Signature header value
 */
export async function generateSignature(
  method: string,
  path: string,
  host: string,
  body: string | null,
  params: SignatureParams
): Promise<string> {
  const date = new Date().toUTCString();
  const digest = body ? await generateDigest(body) : null;

  // Build signing string
  const headers: Record<string, string> = {
    "(request-target)": `${method.toLowerCase()} ${path}`,
    host: host,
    date: date,
  };

  if (digest) {
    headers.digest = digest;
  }

  // Determine which headers to sign
  const headersToSign = params.headers.length > 0 ? params.headers : ["(request-target)", "host", "date"];
  if (digest && !headersToSign.includes("digest")) {
    headersToSign.push("digest");
  }

  // Build signing string
  const signingString = headersToSign
    .map((headerName) => {
      const value = headers[headerName];
      if (!value) {
        throw new Error(`Missing header: ${headerName}`);
      }
      return `${headerName}: ${value}`;
    })
    .join("\n");

  // Sign with private key
  const privateKey = await importPrivateKey(params.privateKeyPem);
  const encoder = new TextEncoder();
  const data = encoder.encode(signingString);
  const signatureBytes = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data);

  // Convert to base64
  const signatureBase64 = arrayBufferToBase64(signatureBytes);

  // Build Signature header
  const signatureHeader = [
    `keyId="${params.keyId}"`,
    `algorithm="rsa-sha256"`,
    `headers="${headersToSign.join(" ")}"`,
    `signature="${signatureBase64}"`,
  ].join(",");

  return signatureHeader;
}

/**
 * Verify HTTP Signature from a request
 *
 * @param c - Hono context
 * @param publicKeyPem - Public key in PEM format
 * @returns true if signature is valid
 */
export async function verifySignature(c: Context, publicKeyPem: string): Promise<boolean> {
  const signatureHeader = c.req.header("signature");
  if (!signatureHeader) {
    console.error("Missing Signature header");
    return false;
  }

  // Verify timestamp to prevent replay attacks
  const dateHeader = c.req.header("date");
  if (!dateHeader) {
    console.error("Missing Date header (required for replay protection)");
    return false;
  }

  try {
    const requestTime = new Date(dateHeader).getTime();
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes tolerance

    if (isNaN(requestTime)) {
      console.error(`Invalid Date header format: ${dateHeader}`);
      return false;
    }

    if (Math.abs(now - requestTime) > maxAge) {
      console.warn(`Request timestamp out of range: ${dateHeader} (now: ${new Date(now).toISOString()})`);
      return false;
    }
  } catch (error) {
    console.error(`Date header validation error: ${error}`);
    return false;
  }

  // Parse signature header
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    console.error("Failed to parse Signature header");
    return false;
  }

  // Verify algorithm
  if (parsed.algorithm !== "rsa-sha256") {
    console.error(`Unsupported algorithm: ${parsed.algorithm}`);
    return false;
  }

  // Build signing string from request
  const method = c.req.method;
  const url = new URL(c.req.url);
  const path = url.pathname + url.search;

  const headers: Record<string, string> = {
    "(request-target)": `${method.toLowerCase()} ${path}`,
  };

  // Collect headers
  for (const headerName of parsed.headers) {
    if (headerName === "(request-target)") continue;

    const value = c.req.header(headerName);
    if (!value) {
      console.error(`Missing required header: ${headerName}`);
      return false;
    }
    headers[headerName] = value;
  }

  // Build signing string
  const signingString = parsed.headers
    .map((headerName) => {
      const value = headers[headerName];
      if (!value) {
        throw new Error(`Missing header: ${headerName}`);
      }
      return `${headerName}: ${value}`;
    })
    .join("\n");

  // Verify signature
  try {
    const publicKey = await importPublicKey(publicKeyPem);
    const encoder = new TextEncoder();
    const data = encoder.encode(signingString);
    const signatureBytes = base64ToArrayBuffer(parsed.signature);

    const isValid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signatureBytes, data);

    return isValid;
  } catch (error) {
    console.error("Signature verification error:", error);
    return false;
  }
}

/**
 * Parse Signature header
 */
function parseSignatureHeader(header: string): ParsedSignature | null {
  try {
    const params: Record<string, string> = {};

    // Parse key="value" pairs
    const regex = /(\w+)="([^"]+)"/g;
    let match;
    while ((match = regex.exec(header)) !== null) {
      params[match[1]] = match[2];
    }

    if (!params.keyId || !params.signature || !params.headers) {
      return null;
    }

    return {
      keyId: params.keyId,
      algorithm: params.algorithm || "rsa-sha256",
      headers: params.headers.split(" "),
      signature: params.signature,
    };
  } catch (error) {
    console.error("Error parsing signature header:", error);
    return null;
  }
}

/**
 * Generate SHA-256 digest for request body
 */
async function generateDigest(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(body);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const base64 = arrayBufferToBase64(hashBuffer);
  return `SHA-256=${base64}`;
}

/**
 * Verify digest header matches body
 */
export async function verifyDigest(c: Context, body: string): Promise<boolean> {
  const digestHeader = c.req.header("digest");
  if (!digestHeader) {
    console.error("Missing Digest header");
    return false;
  }

  const expectedDigest = await generateDigest(body);
  return digestHeader === expectedDigest;
}

/**
 * Convert ArrayBuffer to Base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generate headers for signed HTTP request
 *
 * @param method - HTTP method
 * @param targetUrl - Full target URL
 * @param body - Request body (for POST/PUT)
 * @param params - Signature parameters
 * @returns Headers object with Signature, Date, Digest, Host
 */
export async function generateSignedHeaders(
  method: string,
  targetUrl: string,
  body: string | null,
  params: SignatureParams
): Promise<Record<string, string>> {
  const url = new URL(targetUrl);
  const path = url.pathname + url.search;
  const host = url.host;
  const date = new Date().toUTCString();

  const headers: Record<string, string> = {
    Host: host,
    Date: date,
  };

  if (body) {
    const digest = await generateDigest(body);
    headers["Digest"] = digest;
  }

  const signature = await generateSignature(method, path, host, body, params);
  headers["Signature"] = signature;

  return headers;
}

export async function signRequest(
  request: Request,
  keyId: string,
  privateKeyPem: string,
): Promise<RequestInit> {
  const url = new URL(request.url);
  const body = request.body ? await request.clone().text() : null;
  const signature = await generateSignature(
    request.method || "POST",
    url.pathname + url.search,
    url.host,
    body,
    {
      keyId,
      privateKeyPem,
      headers: ["(request-target)", "host", "date", "digest"],
    },
  );
  const headers = new Headers(request.headers);
  headers.set("Signature", signature);
  headers.set("Date", new Date().toUTCString());
  headers.set("Host", url.host);
  if (body) {
    headers.set("Digest", await generateDigest(body));
  }
  return {
    method: request.method,
    headers,
    body,
  };
}