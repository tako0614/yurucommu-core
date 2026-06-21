// AP / WebFinger responses must carry the correct Content-Type. Hono's
// `c.json()` force-sets `application/json` and CLOBBERS any `Content-Type`
// header set before it — so an ActivityPub document served via `c.json()`
// reaches a remote (Mastodon et al.) as `application/json`, which strict
// consumers REJECT (`Request` only accepts `application/activity+json` /
// `application/ld+json`), breaking inbound federation: a remote cannot resolve
// this actor/object/collection. These helpers serialize manually and set the
// spec content type via `c.body()`, which does not override it.

// Minimal structural shape of the Hono context we touch, so this stays
// decoupled from a route's specific Bindings/Variables typing.
interface ApResponseContext {
  header(name: string, value: string): void;
  body(data: string): Response;
}

const AP_CONTENT_TYPE = "application/activity+json";
const JRD_CONTENT_TYPE = "application/jrd+json";

/** Serialize `body` as an ActivityStreams document (`application/activity+json`). */
export function activityJson(c: ApResponseContext, body: unknown): Response {
  c.header("Content-Type", AP_CONTENT_TYPE);
  return c.body(JSON.stringify(body));
}

/** Serialize `body` as a WebFinger JRD document (`application/jrd+json`). */
export function jrdJson(c: ApResponseContext, body: unknown): Response {
  c.header("Content-Type", JRD_CONTENT_TYPE);
  return c.body(JSON.stringify(body));
}
