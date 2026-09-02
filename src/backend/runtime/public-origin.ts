/**
 * The one absolute origin this instance is: `APP_URL`, or the one a request
 * established when the Host — not the deployer — chose it.
 *
 * Every federated identity this app mints is absolute. Actor ids, activity and
 * object ids, `inbox` / `outbox` / `followers` collections, the OIDC
 * `redirect_uri`, notification links, and the `.well-known` discovery documents
 * are all `${APP_URL}/…`, and a wrong one is not a broken page — it is a
 * permanent, federated wrong answer that remote servers have already cached.
 *
 * `APP_URL` is a plain variable, and on a wrapper host it cannot always be one.
 * A Takoform `WorkerEndpoint` allocates the Worker's public origin AFTER the
 * `WorkerVersion` that would have carried the variable is already immutable, so
 * the deployer does not know the value at apply time and there is no second
 * apply that could inject it. The origin exists, but only the Host knows it,
 * and the only place it is ever spoken is on the requests the Host routes here.
 *
 * So on the `portable` lane an unset `APP_URL` is answered by OBSERVING one
 * request and PINNING what it observed:
 *
 *   1. `APP_URL` is authoritative whenever it is set. It is used exactly as the
 *      operator wrote it and is never validated, cached, or persisted here —
 *      an operator who sets it has already decided, and this module has no
 *      standing to refuse a value the previous release accepted.
 *   2. Otherwise the origin PINNED IN KV wins, for every request and for
 *      background work alike. First writer wins: once a value is stored, no
 *      later request replaces it, whatever `Host` that request carried.
 *   3. Otherwise a request may establish it, from the request URL's own origin
 *      and from nothing else.
 *   4. Otherwise there is no origin, and background work refuses rather than
 *      minting `undefined/ap/users/alice`.
 *
 * WHAT IS TRUSTED. The request URL as the runtime delivers it, and only that.
 * Not `X-Forwarded-Host`, not `X-Forwarded-Proto`, not `Host` read out of the
 * headers — nothing a client can write. Both wrapper hosts route by hostname
 * and deliver the request they received on the Worker's own public endpoint:
 * Takoserver's managed Workers-for-Platforms gateway looks up a host route for
 * `new URL(request.url).hostname` and dispatches the SAME `Request` object, and
 * the self-host workerd router picks a service from a table keyed by hostname
 * and forwards unchanged. A hostname nobody published for this Worker is a 404
 * before any of this code runs, so the origin on the request is one the Host
 * assigned — which is exactly the value that could not be delivered as a var.
 *
 * WHY HTTPS. A public fediverse origin is https, and Takoserver's own
 * `WorkerEndpoint` can only ever assign an https origin. Requiring it here
 * means an http request cannot pin an origin that would then sign deliveries
 * and mint actor ids. Loopback http is the one exception, because `localhost`
 * is not routable and is the origin a developer actually serves on.
 *
 * A wrapper host that terminates TLS in FRONT of workerd and speaks plain http
 * to it therefore establishes nothing: `request.url` is `http://…` and the
 * derivation refuses. That deployment must set `APP_URL`, which it can, because
 * an operator who terminates TLS chose the hostname themselves. Refusing is the
 * point — the alternative is trusting a forwarded-proto header that the same
 * proxy may or may not be the only writer of.
 */

import type { Env, EnvVars } from "../types.ts";
import type { IKeyValueStore } from "./types.ts";

/**
 * Where the observed origin is pinned.
 *
 * The key is shared with the origin pin Yurucommu's own generated Worker entry
 * writes, so a deployment that pinned an origin under the product's
 * implementation keeps it when the product delegates to this one.
 */
export const CANONICAL_ORIGIN_KV_KEY =
  "__yurucommu/runtime/canonical-origin/v1";

/** No usable public origin, or a candidate that may not become one. */
export class PublicOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicOriginError";
  }
}

/**
 * Hostnames whose http origin is still trustworthy, because they are not
 * routable off the machine. `*.localhost` is included: RFC 6761 reserves the
 * whole tree for loopback, and a self-host Worker endpoint on a local Takoserver
 * is `<script>.localhost`.
 */
function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * Reduce a candidate to a bare origin, or refuse it.
 *
 * Refuses anything that is not just an origin — a path, a query, a fragment,
 * embedded credentials — because the value is concatenated with `/ap/users/…`
 * at hundreds of call sites and a stray path would silently produce a second,
 * parallel set of actor ids.
 */
export function canonicalPublicOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicOriginError(
      `"${value}" is not a URL and cannot be this instance's public origin.`,
    );
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/"
  ) {
    throw new PublicOriginError(
      `"${value}" is not a bare origin; this instance's public origin must ` +
        `carry no path, query, fragment, or credentials.`,
    );
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopbackHostname(url.hostname))
  ) {
    throw new PublicOriginError(
      `"${value}" is not an https origin. A public origin observed from a ` +
        `request must be https (loopback http is the only exception); set ` +
        `APP_URL explicitly when this Worker is served over plain http.`,
    );
  }
  return url.origin;
}

/** `APP_URL` exactly as the operator set it, or null when it is not set. */
export function configuredAppUrl(env: Partial<EnvVars>): string | null {
  const raw = typeof env.APP_URL === "string" ? env.APP_URL.trim() : "";
  return raw.length > 0 ? raw : null;
}

/**
 * The origin this isolate has already established.
 *
 * Cached because the alternative is a KV read on the hot path of every single
 * request, and because the value cannot legitimately change: first writer wins,
 * so a second read can only ever return what the first one did. An operator who
 * deliberately re-pins a different origin (see {@link resetObservedPublicOrigin})
 * is served the new value by isolates started after the change.
 */
let observedPublicOrigin: string | null = null;

/** Forget this isolate's observation. Tests, and an operator-driven re-pin. */
export function resetObservedPublicOrigin(): void {
  observedPublicOrigin = null;
}

/** What this isolate has observed so far, without touching KV. */
export function peekObservedPublicOrigin(): string | null {
  return observedPublicOrigin;
}

type PublicOriginEnv = Partial<EnvVars> & { KV?: IKeyValueStore };

function requireKv(env: PublicOriginEnv): IKeyValueStore {
  if (!env.KV) {
    throw new PublicOriginError(
      "KV is not bound, so this instance's public origin can be neither read " +
        "nor pinned. Bind KV, or set APP_URL.",
    );
  }
  return env.KV;
}

async function readPinnedOrigin(kv: IKeyValueStore): Promise<string | null> {
  const stored = await kv.get(CANONICAL_ORIGIN_KV_KEY);
  if (stored === null) return null;
  // A stored value that no longer canonicalizes is a refusal, never a silent
  // fallback to the current request: it means somebody wrote the key by hand.
  return canonicalPublicOrigin(stored);
}

/**
 * Establish this instance's public origin from one request, once.
 *
 * CONSISTENCY. The pin lives in KV, the one store both lanes always have (`DB`
 * is equally present, but the origin is needed by the readiness probe and by
 * queue work that must not open a transaction to learn its own name). KV is
 * eventually consistent and has no compare-and-swap, so "first writer wins" is
 * enforced by reading before writing and then READING BACK: an isolate that
 * finds a different origin on the read-back lost the race and refuses this
 * request rather than serving two identities. The next request reads the
 * winner's value through the ordinary stored-value path. A read-back that has
 * not converged yet (null) is treated as our own write, because we wrote it.
 */
export async function establishRequestPublicOrigin(
  env: PublicOriginEnv,
  request: Request,
): Promise<string> {
  if (observedPublicOrigin !== null) return observedPublicOrigin;

  const kv = requireKv(env);
  const pinned = await readPinnedOrigin(kv);
  if (pinned !== null) {
    observedPublicOrigin = pinned;
    return pinned;
  }

  const requestOrigin = canonicalPublicOrigin(new URL(request.url).origin);
  await kv.put(CANONICAL_ORIGIN_KV_KEY, requestOrigin);
  const readback = await kv.get(CANONICAL_ORIGIN_KV_KEY);
  if (readback !== null && canonicalPublicOrigin(readback) !== requestOrigin) {
    throw new PublicOriginError(
      `this instance's public origin was concurrently pinned to ` +
        `"${readback}" while this request was establishing ` +
        `"${requestOrigin}". The pinned origin stands; retry.`,
    );
  }
  observedPublicOrigin = requestOrigin;
  return requestOrigin;
}

/**
 * The public origin for work that has no request to read it from.
 *
 * Queue consumers sign federation deliveries and address them from this
 * instance's actor ids; there is no request in scope and nothing to derive one
 * from. `APP_URL` first, then the pinned origin, then a refusal — never a
 * guess, and never `undefined` concatenated into an actor id.
 */
export async function requireBackgroundPublicOrigin(
  env: PublicOriginEnv,
): Promise<string> {
  const configured = configuredAppUrl(env);
  if (configured !== null) return configured;
  if (observedPublicOrigin !== null) return observedPublicOrigin;

  const pinned = await readPinnedOrigin(requireKv(env));
  if (pinned === null) {
    throw new PublicOriginError(
      "this instance's public origin has not been observed yet: APP_URL is " +
        "unset and no request has pinned an origin. Serve one request on the " +
        "Worker's public endpoint before background delivery can address " +
        "anything.",
    );
  }
  observedPublicOrigin = pinned;
  return pinned;
}

/**
 * The env background work should run with: `APP_URL` present, or a refusal.
 *
 * Returned as a copy rather than by mutating the caller's bindings, so the same
 * `env` may be handed to several handlers without one of them rewriting what
 * the others read.
 */
export async function withRequiredBackgroundPublicOrigin(
  env: Env,
): Promise<Env> {
  if (configuredAppUrl(env) !== null) return env;
  return { ...env, APP_URL: await requireBackgroundPublicOrigin(env) };
}
