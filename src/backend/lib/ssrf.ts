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
// fc/fd = unique-local; fe8/fe9/fea/feb = link-local; fec/fed/fee/fef =
// deprecated site-local; ff = multicast. Used ONLY as a textual fallback when
// the address cannot be expanded (the numeric classifier below is canonical).
const PRIVATE_IPV6_PREFIXES = [
  "fc",
  "fd",
  "fe8",
  "fe9",
  "fea",
  "feb",
  "fec",
  "fed",
  "fee",
  "fef",
  "ff",
];

/**
 * Expand an IPv6 textual address to its 8 numeric hextets, resolving `::`
 * compression and a trailing dotted-IPv4 tail (e.g. ::ffff:127.0.0.1 or
 * 64:ff9b::1.2.3.4). Returns null if `input` is not a well-formed IPv6 literal.
 * This canonicalization is what lets the classifier treat every encoding of an
 * embedded IPv4 (mapped hex/dotted, IPv4-compatible, NAT64, 6to4) uniformly.
 */
function expandIPv6(input: string): number[] | null {
  let s = input.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  if (s.length === 0) return null;

  // Fold a trailing dotted-IPv4 tail into two hex groups so the rest of the
  // parse is uniform regardless of the surrounding IPv6 prefix.
  if (s.includes(".")) {
    const m = s.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (!m) return null;
    const v4 = parseIPv4(m[2]);
    if (!v4) return null;
    const h1 = ((v4[0] << 8) | v4[1]).toString(16);
    const h2 = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${m[1]}${h1}:${h2}`;
  }

  const doubleIdx = s.indexOf("::");
  if (doubleIdx !== s.lastIndexOf("::")) return null; // at most one "::"

  const parseGroups = (str: string): number[] | null => {
    if (str === "") return [];
    const out: number[] = [];
    for (const g of str.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  let groups: number[];
  if (doubleIdx !== -1) {
    const head = parseGroups(s.slice(0, doubleIdx));
    const tail = parseGroups(s.slice(doubleIdx + 2));
    if (head === null || tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // "::" must stand for >= 1 zero group
    groups = [...head, ...new Array(missing).fill(0), ...tail];
  } else {
    const all = parseGroups(s);
    if (all === null) return null;
    groups = all;
  }
  return groups.length === 8 ? groups : null;
}

function embeddedV4IsPrivate(hi: number, lo: number): boolean {
  return isPrivateIPv4(
    `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`,
  );
}

function isPrivateIPv6(ipv6Raw: string): boolean {
  const g = expandIPv6(ipv6Raw);
  if (!g) {
    // Unparseable: fall back to the conservative textual checks so a form the
    // string matcher caught is never regressed.
    const s = ipv6Raw.toLowerCase().replace(/^\[|\]$/g, "");
    if (PRIVATE_IPV6_EXACT.includes(s)) return true;
    return PRIVATE_IPV6_PREFIXES.some((prefix) => s.startsWith(prefix));
  }

  const allZeroHigh =
    g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
  // :: (unspecified) and ::1 (loopback)
  if (allZeroHigh && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) {
    return true;
  }

  const hi8 = g[0] >> 8;
  if (hi8 === 0xfc || hi8 === 0xfd) return true; // fc00::/7 unique-local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if (hi8 === 0xff) return true; // ff00::/8 multicast

  // Embedded-IPv4 transition ranges — decode the embedded IPv4 and classify it,
  // so ::ffff:7f00:1, ::127.0.0.1, 64:ff9b::7f00:1 and 2002:7f00:1:: are all
  // recognized as 127.0.0.1 etc.
  if (allZeroHigh && g[5] === 0xffff) return embeddedV4IsPrivate(g[6], g[7]); // IPv4-mapped
  if (allZeroHigh && g[5] === 0) return embeddedV4IsPrivate(g[6], g[7]); // IPv4-compatible (::/96)
  if (g[0] === 0x64 && g[1] === 0xff9b) return embeddedV4IsPrivate(g[6], g[7]); // NAT64 64:ff9b::/96
  if (g[0] === 0x2002) return embeddedV4IsPrivate(g[1], g[2]); // 6to4 2002:V4::/16

  return false;
}

/**
 * True if `host` is a well-formed IPv4 or IPv6 literal. Used to reject
 * unparseable DNS RDATA before the private-IP classifier runs, so a malformed
 * or ambiguous resolved-IP string can never slip past as "not private".
 */
export function isWellFormedIp(host: string): boolean {
  if (parseIPv4(host)) return true;
  if (host.includes(":")) return expandIPv6(host) !== null;
  return false;
}

export function isPrivateIpAddress(host: string): boolean {
  if (isPrivateIPv4(host)) return true;
  if (host.includes(":")) return isPrivateIPv6(host);
  return false;
}

export function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function localSubstrateRemoteFetchesEnabled(): boolean {
  const processEnv = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  return isTruthyEnv(processEnv?.[LOCAL_SUBSTRATE_REMOTE_FETCH_ENV]);
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

  const json = (await response.json()) as {
    Answer?: Array<{ type?: number; data?: string }>;
  };

  return (json.Answer ?? []).filter(
    (answer): answer is { type: number; data: string } =>
      typeof answer.type === "number" && typeof answer.data === "string",
  );
}

export async function resolveRemoteHostnameIPs(
  hostname: string,
): Promise<string[]> {
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

export function isTakosTestHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "takos.test" || normalized.endsWith(".takos.test");
}

function isLocalSubstrateUrlShape(parsed: URL): boolean {
  return (
    parsed.protocol === "https:" &&
    (parsed.port === "" || parsed.port === "443")
  );
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
  const resolve =
    resolver ??
    (async (name: string, recordType: DnsRecordType): Promise<string[]> => {
      return await nodeLookupByRecordType(name, recordType);
    });

  const [aRecords, aaaaRecords] = await Promise.all([
    resolve(hostname, "A"),
    resolve(hostname, "AAAA"),
  ]);
  return [...aRecords, ...aaaaRecords];
}

/**
 * Resolve `url`'s hostname and assert every resolved IP is public (or, in
 * local-substrate mode, inside the local-substrate allowlist). On success
 * returns the validated IP set so callers can PIN the actual connection to
 * one of these exact IPs and avoid a second, independent DNS resolution.
 */
export async function assertSafeRemoteUrlResolved(
  url: string,
  options: RemoteUrlSafetyOptions = {},
): Promise<string[]> {
  if (!isSafeRemoteUrl(url)) {
    throw new Error(`Unsafe remote URL: ${url}`);
  }

  // isSafeRemoteUrl already validated the hostname is not blocked,
  // so we only need to verify resolved IPs are not private.
  const parsed = new URL(url);
  const hostname = normalizeHostname(parsed.hostname);
  const allowLocalSubstrate =
    options.allowLocalSubstrateRemoteFetches ??
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
    return resolvedIps;
  }

  const resolvedIps = await (
    options.remoteResolver ?? resolveRemoteHostnameIPs
  )(hostname);
  if (resolvedIps.length === 0) {
    throw new Error(`Failed to resolve hostname: ${hostname}`);
  }

  for (const ip of resolvedIps) {
    // Reject unparseable RDATA first: an IP string the classifier cannot parse
    // must NOT be allowed through as "not private" (fail closed).
    if (!isWellFormedIp(ip)) {
      throw new Error(`Hostname ${hostname} resolved to unparseable IP ${ip}`);
    }
    if (isPrivateIpAddress(ip)) {
      throw new Error(`Hostname ${hostname} resolved to private IP ${ip}`);
    }
  }

  return resolvedIps;
}

export async function nodeLookupAll(hostname: string): Promise<string[]> {
  const { lookup } = await import("node:dns/promises");
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
}

export async function nodeLookupByRecordType(
  hostname: string,
  recordType: DnsRecordType,
): Promise<string[]> {
  try {
    const { lookup } = await import("node:dns/promises");
    const records = await lookup(hostname, {
      all: true,
      family: recordType === "A" ? 4 : 6,
    });
    return records.map((record) => record.address);
  } catch {
    return [];
  }
}
