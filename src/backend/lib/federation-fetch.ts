import {
  assertSafeRemoteUrlResolved,
  isTakosTestHostname,
  localSubstrateRemoteFetchesEnabled,
  nodeLookupAll,
  normalizeHostname,
  resolveRemoteHostnameIPs,
} from "./ssrf.ts";

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

// Upper bound on the body of any remote federation fetch (actor / object /
// WebFinger documents). These are small JSON documents in practice, so a
// couple of MiB is generous; the cap exists to stop a malicious or buggy
// remote from streaming a multi-GB / never-ending body into memory on the
// attacker-reachable, pre-auth fetchActorPublicKey hot path. Env-overridable
// for operators that federate with peers shipping unusually large actor docs.
const DEFAULT_MAX_FEDERATION_BODY_BYTES = 2 * 1024 * 1024;
const MAX_FEDERATION_BODY_BYTES_ENV = "YURUCOMMU_MAX_FEDERATION_BODY_BYTES";

function maxFederationBodyBytes(): number {
  const processEnv = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  const raw = processEnv?.[MAX_FEDERATION_BODY_BYTES_ENV];
  if (!raw) return DEFAULT_MAX_FEDERATION_BODY_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_FEDERATION_BODY_BYTES;
  }
  return Math.floor(parsed);
}

export class FederationBodyTooLargeError extends Error {
  constructor(
    public readonly url: string,
    public readonly limit: number,
  ) {
    super(`Remote federation response body exceeded ${limit} bytes: ${url}`);
    this.name = "FederationBodyTooLargeError";
  }
}

/**
 * Read `response`'s body fully into a byte buffer while enforcing a hard byte
 * cap and keeping the read under `signal` (so the request timeout still bounds
 * the body, not just the headers). Rejects early on an oversized Content-Length
 * and otherwise streams the body counting bytes, aborting once the cap is
 * exceeded.
 *
 * Mirrors the capped-reader discipline used elsewhere for tenant-influenced
 * fetches (e.g. the inbox MAX_PAYLOAD_BYTES guard and the node-postgres /
 * git-fetch capped readers).
 */
async function readBodyBytesWithCap(
  response: Response,
  url: string,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  // Short-circuit on an honest, oversized Content-Length before reading.
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > limit) {
      // Drain/cancel so the connection isn't left half-read.
      try {
        await response.body?.cancel();
      } catch {
        /* ignore cancel failures */
      }
      throw new FederationBodyTooLargeError(url, limit);
    }
  }

  // A consumed/absent body (e.g. 204) reads as empty bytes.
  if (!response.body) {
    return new Uint8Array(0);
  }

  if (signal.aborted) {
    try {
      await response.body.cancel();
    } catch {
      /* ignore */
    }
    throw signal.reason instanceof Error ? signal.reason : new Error("Aborted");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  const onAbort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel().catch(() => {});
          throw new FederationBodyTooLargeError(url, limit);
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    if (signal.aborted && !(err instanceof FederationBodyTooLargeError)) {
      throw signal.reason instanceof Error ? signal.reason : err;
    }
    throw err;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Wrap a `Response` so `.json()` / `.text()` (and the other body accessors)
 * read the body under a LIVE timeout + a hard size cap, instead of the raw
 * `Response` whose body read is unbounded once the headers arrive. The wrapper
 * delegates every non-body member (`ok`, `status`, `headers`, `url`, ...) to
 * the underlying response, so all callers keep their existing `res.ok` /
 * `res.status` / `res.json()` / `res.text()` usage with no signature churn.
 */
function wrapResponseWithCap(
  response: Response,
  url: string,
  timeout: number,
): Response {
  const limit = maxFederationBodyBytes();
  let bodyConsumed = false;

  const readBytes = async (): Promise<Uint8Array> => {
    if (bodyConsumed) {
      // Surface the native "Body already consumed" failure mode by reading the
      // (already-locked) underlying body.
      return new Uint8Array(await response.arrayBuffer());
    }
    bodyConsumed = true;
    // Fresh timeout covering ONLY the body read, so a slow/never-ending body
    // is bounded even though the headers already arrived.
    const bodyAbort = AbortSignal.timeout(timeout);
    try {
      return await readBodyBytesWithCap(response, url, limit, bodyAbort);
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(
          `Response body read timed out after ${
            timeout / 1000
          } seconds: ${url}`,
        );
      }
      throw err;
    }
  };

  const readText = async (): Promise<string> =>
    new TextDecoder().decode(await readBytes());

  return new Proxy(response, {
    get(target, prop, _receiver) {
      if (prop === "text") {
        return () => readText();
      }
      if (prop === "json") {
        return async () => JSON.parse(await readText());
      }
      if (prop === "arrayBuffer") {
        return async () => {
          const bytes = await readBytes();
          // Return a standalone ArrayBuffer copy (the merged buffer may be a
          // view into a larger allocation in some runtimes).
          return bytes.slice().buffer;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Response;
}

/**
 * Resolve a remote hostname using the SAME resolver `fetch` will use on this
 * runtime, so the SSRF validation in `assertSafeRemoteUrlResolved` is not
 * split from the resolution the actual connection performs.
 *
 * DNS-rebinding TOCTOU has two distinct vectors here:
 *
 *  1. Resolver split — validating via Cloudflare DoH while `fetch` connects
 *     using the host OS resolver. An attacker who controls authoritative DNS
 *     can deterministically serve a public IP to DoH and a private IP to the
 *     OS resolver. On a Bun/Node host, we close this deterministic split by
 *     validating with the host resolver instead of DoH, so validation and the
 *     connection both go through the
 *     host's configured DNS rather than two different trust domains. (This
 *     removes the resolver-split exploit; it does not by itself guarantee
 *     fetch reuses the identical IP — see vector 2.) On Workers `fetch`
 *     resolves at the edge with no host-OS resolver to diverge from, so DoH
 *     and the connection resolve in the same trust domain.
 *  2. Low-TTL flip — the record changes between validation and connection.
 *     Neither Workers' nor host `fetch` exposes a hook to pin the
 *     connection to an already-resolved IP, so we cannot eliminate this
 *     sub-resolution window through `fetch`; we minimize it by resolving
 *     immediately before the request with no other awaited work in between.
 */
async function resolveConnectionResolverIPs(
  hostname: string,
): Promise<string[]> {
  const processLike = (globalThis as { process?: unknown }).process;
  if (processLike) return await nodeLookupAll(hostname);
  return resolveRemoteHostnameIPs(hostname);
}

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
    // Validate using the resolver that `fetch` itself will use on this
    // runtime (closes the resolver-split rebinding vector — see
    // resolveConnectionResolverIPs). The local-substrate path keeps its own
    // resolver logic, so only override the remote-resolver default here.
    const parsed = new URL(url);
    const hostname = normalizeHostname(parsed.hostname);
    const allowLocalSubstrate = localSubstrateRemoteFetchesEnabled();
    const useConnectionResolver = !(
      allowLocalSubstrate && isTakosTestHostname(hostname)
    );

    await assertSafeRemoteUrlResolved(
      url,
      useConnectionResolver
        ? { remoteResolver: resolveConnectionResolverIPs }
        : {},
    );
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
        `Redirect not allowed from remote URL: ${url} -> ${response.headers.get(
          "location",
        )}`,
      );
    }
    // The headers-phase timer is cleared in `finally` below, but a raw
    // `Response` then reads its body with NO time bound and NO size bound — on
    // the attacker-reachable, pre-auth federation ingress (fetchActorPublicKey
    // runs on every inbound activity) a malicious remote can stream a
    // multi-GB / never-ending body and exhaust memory. Wrap the response so
    // `.json()` / `.text()` read the body under a fresh timeout and a hard
    // byte cap. Callers keep their `res.ok` / `res.status` / `res.json()` /
    // `res.text()` usage unchanged; paths that never touch the body (outbound
    // POST delivery) simply never trigger the capped read.
    return wrapResponseWithCap(response, url, timeout);
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
