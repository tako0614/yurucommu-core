import { logger } from "./lib/logger.ts";

const utilsLog = logger.child({ component: "utils" });

export function safeJsonParse<T>(
  json: string | null | undefined,
  defaultValue: T,
): T {
  if (!json) return defaultValue;
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    // MEDIUM FIX: Log the error for debugging
    utilsLog.warn("safeJsonParse failed", {
      event: "utils.json.parse_failed",
      error: err,
    });
    return defaultValue;
  }
}

export function parseLimit(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

export function parseOffset(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), max);
}

export function generateId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

export function getDomain(apId: string): string {
  return new URL(apId).host;
}

export function isLocal(apId: string, baseUrl: string): boolean {
  return apId.startsWith(baseUrl);
}

export function formatUsername(apId: string): string {
  const url = new URL(apId);
  const match = apId.match(/\/users\/([^\/]+)$/);
  if (match) {
    return `${match[1]}@${url.host}`;
  }
  return apId;
}

const HOSTNAME_PATTERN = /^[a-z0-9.-]+$/i;
const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
// DoH lookups gate every outbound federation request. A stalled DoH call
// would let an unreachable upstream hang inbox/delivery loops, so cap each
// lookup at 5s.
const DOH_TIMEOUT_MS = 5_000;
const LOCAL_SUBSTRATE_REMOTE_FETCH_ENV =
  "YURUCOMMU_ENABLE_LOCAL_SUBSTRATE_REMOTE_FETCHES";

type DnsRecordType = "A" | "AAAA";

export type RemoteUrlSafetyOptions = {
  allowLocalSubstrateRemoteFetches?: boolean;
  localResolver?: (
    hostname: string,
    recordType: DnsRecordType,
  ) => Promise<string[]>;
  remoteResolver?: (hostname: string) => Promise<string[]>;
};

function parseIPv4(hostname: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return null;
  }
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

const PRIVATE_IPV6_EXACT = ["::1", "0:0:0:0:0:0:0:1", "::", "0:0:0:0:0:0:0:0"];
const PRIVATE_IPV6_PREFIXES = ["fc", "fd", "fe8", "fe9", "fea", "feb", "ff"];

function isPrivateIPv6(ipv6Raw: string): boolean {
  const ipv6 = ipv6Raw.toLowerCase().replace(/^\[|\]$/g, "");

  if (PRIVATE_IPV6_EXACT.includes(ipv6)) return true;
  if (PRIVATE_IPV6_PREFIXES.some((prefix) => ipv6.startsWith(prefix))) {
    return true;
  }

  const mappedIpv4 = ipv6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedIpv4) return isPrivateIPv4(mappedIpv4[1]);

  return false;
}

function isPrivateIpAddress(host: string): boolean {
  if (isPrivateIPv4(host)) return true;
  if (host.includes(":")) return isPrivateIPv6(host);
  return false;
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function localSubstrateRemoteFetchesEnabled(): boolean {
  if (typeof Deno === "undefined") return false;
  try {
    return isTruthyEnv(Deno.env.get(LOCAL_SUBSTRATE_REMOTE_FETCH_ENV));
  } catch {
    return false;
  }
}

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
];

function isBlockedHostname(hostname: string): boolean {
  const lower = normalizeHostname(hostname);
  if (lower === "localhost") return true;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return true;
  }
  return isPrivateIpAddress(lower);
}

export function isSafeRemoteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    if (!HOSTNAME_PATTERN.test(parsed.hostname)) return false;
    if (!parsed.hostname.includes(".")) return false;
    if (isBlockedHostname(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function normalizeRemoteDomain(domain: string): string | null {
  const trimmed = domain.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(`https://${trimmed}`);
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    const hostname = parsed.hostname;
    if (!HOSTNAME_PATTERN.test(hostname)) return null;
    if (!hostname.includes(".")) return null;
    if (isBlockedHostname(hostname)) return null;
    return parsed.host;
  } catch {
    return null;
  }
}

async function dohResolve(
  hostname: string,
  type: "A" | "AAAA" | "CNAME",
): Promise<Array<{ type: number; data: string }>> {
  const response = await fetch(
    `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`,
    {
      headers: { Accept: "application/dns-json" },
      redirect: "manual",
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new Error(`DoH lookup failed (${response.status})`);
  }

  const json = await response.json() as {
    Answer?: Array<{ type?: number; data?: string }>;
  };

  return (json.Answer ?? [])
    .filter((answer): answer is { type: number; data: string } =>
      typeof answer.type === "number" && typeof answer.data === "string"
    );
}

async function resolveRemoteHostnameIPs(hostname: string): Promise<string[]> {
  const visited = new Set<string>();
  const ips = new Set<string>();

  async function walk(name: string, depth: number): Promise<void> {
    if (depth > 10) {
      throw new Error("DNS resolution exceeded max depth");
    }

    const normalized = normalizeHostname(name);
    if (visited.has(normalized)) return;
    visited.add(normalized);

    const [aAnswers, aaaaAnswers, cnameAnswers] = await Promise.all([
      dohResolve(normalized, "A"),
      dohResolve(normalized, "AAAA"),
      dohResolve(normalized, "CNAME"),
    ]);

    // type 1 = A record, type 28 = AAAA record
    for (const answer of [...aAnswers, ...aaaaAnswers]) {
      if (answer.type === 1 || answer.type === 28) ips.add(answer.data);
    }

    for (const answer of cnameAnswers) {
      if (answer.type === 5) await walk(answer.data, depth + 1);
    }
  }

  await walk(hostname, 0);
  return Array.from(ips);
}

function isTakosTestHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "takos.test" || normalized.endsWith(".takos.test");
}

function isLocalSubstrateUrlShape(parsed: URL): boolean {
  return parsed.protocol === "https:" &&
    (parsed.port === "" || parsed.port === "443");
}

function isAllowedLocalSubstrateIp(ip: string): boolean {
  const parts = parseIPv4(ip);
  if (!parts) return false;
  const [a, b, c, d] = parts;
  if (a === 127 && b === 0 && c === 0 && d === 1) return true;
  return a === 172 && b >= 16 && b <= 31;
}

async function resolveLocalSubstrateHostnameIPs(
  hostname: string,
  resolver?: RemoteUrlSafetyOptions["localResolver"],
): Promise<string[]> {
  const resolve = resolver ??
    (async (name: string, recordType: DnsRecordType): Promise<string[]> => {
      if (typeof Deno === "undefined" || !Deno.resolveDns) {
        throw new Error("Local DNS resolver unavailable");
      }
      try {
        return await Deno.resolveDns(name, recordType);
      } catch {
        return [];
      }
    });

  const [aRecords, aaaaRecords] = await Promise.all([
    resolve(hostname, "A"),
    resolve(hostname, "AAAA"),
  ]);
  return [...aRecords, ...aaaaRecords];
}

export async function assertSafeRemoteUrlResolved(
  url: string,
  options: RemoteUrlSafetyOptions = {},
): Promise<void> {
  if (!isSafeRemoteUrl(url)) {
    throw new Error(`Unsafe remote URL: ${url}`);
  }

  // isSafeRemoteUrl already validated the hostname is not blocked,
  // so we only need to verify resolved IPs are not private.
  const parsed = new URL(url);
  const hostname = normalizeHostname(parsed.hostname);
  const allowLocalSubstrate = options.allowLocalSubstrateRemoteFetches ??
    localSubstrateRemoteFetchesEnabled();

  if (allowLocalSubstrate && isTakosTestHostname(hostname)) {
    if (!isLocalSubstrateUrlShape(parsed)) {
      throw new Error(`Unsafe local-substrate remote URL: ${url}`);
    }
    const resolvedIps = await resolveLocalSubstrateHostnameIPs(
      hostname,
      options.localResolver,
    );
    if (resolvedIps.length === 0) {
      throw new Error(`Failed to resolve hostname: ${hostname}`);
    }
    for (const ip of resolvedIps) {
      if (!isAllowedLocalSubstrateIp(ip)) {
        throw new Error(
          `Hostname ${hostname} resolved outside local-substrate allowlist: ${ip}`,
        );
      }
    }
    return;
  }

  const resolvedIps =
    await (options.remoteResolver ?? resolveRemoteHostnameIPs)(
      hostname,
    );
  if (resolvedIps.length === 0) {
    throw new Error(`Failed to resolve hostname: ${hostname}`);
  }

  for (const ip of resolvedIps) {
    if (isPrivateIpAddress(ip)) {
      throw new Error(`Hostname ${hostname} resolved to private IP ${ip}`);
    }
  }
}

const RSA_ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function wrapPem(label: string, base64: string): string {
  const lines = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

export async function generateKeyPair(): Promise<
  { publicKeyPem: string; privateKeyPem: string }
> {
  const keyPair = await crypto.subtle.generateKey(
    {
      ...RSA_ALGORITHM,
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );

  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.exportKey("spki", keyPair.publicKey),
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  ]);

  return {
    publicKeyPem: wrapPem("PUBLIC KEY", bufferToBase64(publicKey)),
    privateKeyPem: wrapPem("PRIVATE KEY", bufferToBase64(privateKey)),
  };
}

export async function signRequest(
  privateKeyPem: string,
  keyId: string,
  method: string,
  url: string,
  body?: string,
): Promise<Record<string, string>> {
  const urlObj = new URL(url);
  const date = new Date().toUTCString();
  const digest = body
    ? `SHA-256=${
      bufferToBase64(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
      )
    }`
    : undefined;

  const signedHeaders = digest
    ? "(request-target) host date digest"
    : "(request-target) host date";
  let signatureString =
    `(request-target): ${method.toLowerCase()} ${urlObj.pathname}\nhost: ${urlObj.host}\ndate: ${date}`;
  if (digest) signatureString += `\ndigest: ${digest}`;

  const pemContents = privateKeyPem.replace(/-----[^-]+-----/g, "").replace(
    /\s/g,
    "",
  );
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    RSA_ALGORITHM,
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signatureString),
  );
  const signature = bufferToBase64(signatureBuffer);

  const headers: Record<string, string> = {
    "Date": date,
    "Host": urlObj.host,
    "Signature":
      `keyId="${keyId}",algorithm="rsa-sha256",headers="${signedHeaders}",signature="${signature}"`,
  };
  if (digest) headers["Digest"] = digest;

  return headers;
}

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number; skipSafetyCheck?: boolean } = {},
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
      redirect: "manual", // Prevent redirect-based SSRF bypassing DNS safety checks
    });
    // Reject redirects to prevent SSRF via open redirects on remote servers
    if (response.status >= 300 && response.status < 400) {
      throw new Error(
        `Redirect not allowed from remote URL: ${url} -> ${
          response.headers.get("location")
        }`,
      );
    }
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Request timed out after ${timeout / 1000} seconds: ${url}`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
