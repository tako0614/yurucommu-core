import { computeDigestBytes } from "./digest";
import { signRsaSha256, verifyRsaSha256 } from "./crypto";

type SignatureParams = {
  keyId: string;
  algorithm?: string;
  headers?: string;
  signature: string;
};

function parseSignatureParams(value: string): SignatureParams | null {
  const trimmed = value.trim();
  const raw = trimmed.startsWith("Signature ") ? trimmed.slice("Signature ".length) : trimmed;

  const params: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k || rest.length === 0) continue;
    const v = rest.join("=").trim();
    params[k] = v.startsWith("\"") && v.endsWith("\"") ? v.slice(1, -1) : v;
  }

  if (!params.keyId || !params.signature) return null;
  return {
    keyId: params.keyId,
    algorithm: params.algorithm,
    headers: params.headers,
    signature: params.signature
  };
}

function getSignatureHeaderValue(request: Request): string | null {
  const signature = request.headers.get("Signature");
  if (signature) return signature;

  const authorization = request.headers.get("Authorization");
  if (authorization?.toLowerCase().startsWith("signature ")) return authorization;

  return null;
}

function getRequestTarget(request: Request): string {
  const url = new URL(request.url);
  return `${request.method.toLowerCase()} ${url.pathname}${url.search}`;
}

function getHost(request: Request): string {
  return request.headers.get("Host") ?? new URL(request.url).host;
}

function getRequiredHeaderValue(name: string, request: Request): string {
  const lower = name.toLowerCase();
  if (lower === "(request-target)") return getRequestTarget(request);
  if (lower === "host") return getHost(request);
  const value = request.headers.get(name) ?? request.headers.get(lower);
  if (value == null) throw new Error(`Missing required header for signature: ${name}`);
  return value;
}

function buildSigningString(headers: string[], request: Request): string {
  const lines: string[] = [];
  for (const headerName of headers) {
    const lower = headerName.toLowerCase();
    if (lower === "(request-target)") {
      lines.push(`(request-target): ${getRequestTarget(request)}`);
      continue;
    }
    const value = getRequiredHeaderValue(headerName, request);
    lines.push(`${lower}: ${value}`);
  }
  return lines.join("\n");
}

function methodAllowsBody(method: string): boolean {
  const upper = method.toUpperCase();
  return upper !== "GET" && upper !== "HEAD";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function signRequest(request: Request, privateKeyPem: string, keyId: string): Promise<Request> {
  const url = request.url;
  const method = request.method;
  const headers = new Headers(request.headers);

  if (!headers.get("Host")) {
    headers.set("Host", getHost(request));
  }

  if (!headers.get("Date")) {
    headers.set("Date", new Date().toUTCString());
  }

  const headerNames: string[] = ["(request-target)", "host", "date"];

  let bodyBytes: Uint8Array | undefined;
  if (methodAllowsBody(request.method)) {
    bodyBytes = new Uint8Array(await request.clone().arrayBuffer());
    if (!headers.get("Digest")) {
      headers.set("Digest", await computeDigestBytes(bodyBytes));
    }
    headerNames.push("digest");
  }

  const signingRequest = new Request(url, {
    method,
    headers,
    body: bodyBytes ? toArrayBuffer(bodyBytes) : undefined
  });

  const signingString = buildSigningString(headerNames, signingRequest);
  const signatureBase64 = await signRsaSha256(signingString, privateKeyPem);

  const signatureHeader = `keyId="${keyId}",algorithm="rsa-sha256",headers="${headerNames.join(" ")}",signature="${signatureBase64}"`;
  headers.set("Signature", signatureHeader);

  return new Request(url, {
    method,
    headers,
    body: bodyBytes ? toArrayBuffer(bodyBytes) : undefined,
    redirect: request.redirect,
    signal: request.signal
  });
}

export async function verifySignature(
  request: Request,
  fetchPublicKey: (keyId: string) => Promise<string>
): Promise<boolean> {
  const signatureValue = getSignatureHeaderValue(request);
  if (!signatureValue) return false;

  const params = parseSignatureParams(signatureValue);
  if (!params) return false;

  if (params.algorithm && params.algorithm.toLowerCase() !== "rsa-sha256") return false;

  const headerNames = (params.headers ?? "(request-target) host date").split(/\s+/).filter(Boolean);
  const signingString = buildSigningString(headerNames, request);
  const publicKeyPem = await fetchPublicKey(params.keyId);
  return await verifyRsaSha256(signingString, params.signature, publicKeyPem);
}
