/**
 * ActivityPub structural validators.
 *
 * Network ingress from arbitrary fediverse servers is untyped JSON. This
 * module narrows `unknown` into the shapes Yurucommu expects, throwing a
 * typed {@link ActivityPubContractError} with a field path on contract
 * violations so callers can log + reject rather than panic on `undefined`
 * field access deep in handler code.
 *
 * Rules:
 * - ActivityPub is lenient about extension fields; parsers accept unknown
 *   extra fields and copy through only the keys we care about.
 * - Required-but-wrong-type fields fail closed.
 * - Optional fields that are present but malformed are dropped silently
 *   (treated as absent) rather than rejecting the whole document.
 */

/** Error thrown when a remote ActivityPub document violates our contract. */
export class ActivityPubContractError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`[ActivityPub contract] ${path}: ${message}`);
    this.name = "ActivityPubContractError";
    this.path = path;
  }
}

// ---------------------------------------------------------------------------
// Generic JSON helpers
// ---------------------------------------------------------------------------

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  return asString(record[key]);
}

function getRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isJsonRecord(value) ? value : undefined;
}

function getStringArray(
  record: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string") result.push(item);
  }
  return result;
}

// AS2 permits `type` to be a single string OR an array (e.g. yurucommu's own
// stories emit `type: ["Story", "Note"]`). Preserve both shapes so the
// array-aware downstream classifiers (isStoryType / isActorTypeUpdate /
// typeIncludes) actually receive the array instead of a collapsed `undefined`.
function getStringOrStringArray(
  record: Record<string, unknown>,
  key: string,
): string | string[] | undefined {
  const value = record[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const result = value.filter((v): v is string => typeof v === "string");
    return result.length > 0 ? result : undefined;
  }
  return undefined;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isJsonRecord(value)) {
    throw new ActivityPubContractError(
      path,
      `expected JSON object, got ${value === null ? "null" : typeof value}`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Remote Actor
// ---------------------------------------------------------------------------

export interface RemoteActorDocument {
  id: string;
  type?: string;
  preferredUsername?: string;
  name?: string;
  summary?: string;
  icon?: { url?: string };
  inbox?: string;
  outbox?: string;
  followers?: string;
  following?: string;
  endpoints?: { sharedInbox?: string };
  publicKey?: { id?: string; publicKeyPem?: string };
}

function parseIcon(
  record: Record<string, unknown>,
): { url?: string } | undefined {
  const icon = getRecord(record, "icon");
  if (!icon) return undefined;
  const url = getString(icon, "url");
  return url ? { url } : {};
}

function parsePublicKey(
  record: Record<string, unknown>,
): { id?: string; publicKeyPem?: string } | undefined {
  const publicKey = getRecord(record, "publicKey");
  if (!publicKey) return undefined;
  return {
    id: getString(publicKey, "id"),
    publicKeyPem: getString(publicKey, "publicKeyPem"),
  };
}

function parseEndpoints(
  record: Record<string, unknown>,
): { sharedInbox?: string } | undefined {
  const endpoints = getRecord(record, "endpoints");
  if (!endpoints) return undefined;
  const sharedInbox = getString(endpoints, "sharedInbox");
  return sharedInbox ? { sharedInbox } : {};
}

/**
 * Narrow an `unknown` (typically a `await res.json()` result from a remote
 * actor endpoint) into a {@link RemoteActorDocument}. Throws
 * {@link ActivityPubContractError} if `id` is missing/non-string. Other
 * fields are best-effort: optional fields with wrong types are dropped.
 */
export function parseRemoteActor(
  value: unknown,
  path = "$",
): RemoteActorDocument {
  const record = requireRecord(value, path);
  const id = getString(record, "id");
  if (!id) {
    throw new ActivityPubContractError(
      `${path}.id`,
      "actor must have a string id",
    );
  }
  return {
    id,
    type: getString(record, "type"),
    preferredUsername: getString(record, "preferredUsername"),
    name: getString(record, "name"),
    summary: getString(record, "summary"),
    icon: parseIcon(record),
    inbox: getString(record, "inbox"),
    outbox: getString(record, "outbox"),
    followers: getString(record, "followers"),
    following: getString(record, "following"),
    endpoints: parseEndpoints(record),
    publicKey: parsePublicKey(record),
  };
}

/**
 * Like {@link parseRemoteActor} but returns `null` instead of throwing.
 * Useful for best-effort caches where a malformed response should be
 * skipped silently.
 */
export function tryParseRemoteActor(
  value: unknown,
): RemoteActorDocument | null {
  try {
    return parseRemoteActor(value);
  } catch (e) {
    if (e instanceof ActivityPubContractError) return null;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Activity envelope
// ---------------------------------------------------------------------------

export interface ActivityObjectDocument {
  id?: string;
  type?: string | string[];
  object?: string;
  inReplyTo?: string;
  to?: string[];
  cc?: string[];
  conversation?: string;
  content?: string;
  summary?: string | null;
  attachment?: unknown;
  overlays?: unknown;
  endTime?: string;
  displayDuration?: string;
  published?: string;
  room?: string;
}

export interface ActivityDocument {
  id?: string;
  type?: string;
  actor?: string;
  object?: string | ActivityObjectDocument;
  target?: string | ActivityObjectDocument;
  room?: string;
}

function parseActivityObjectFields(
  record: Record<string, unknown>,
): ActivityObjectDocument {
  const summaryRaw = record["summary"];
  return {
    id: getString(record, "id"),
    type: getStringOrStringArray(record, "type"),
    object: getString(record, "object"),
    inReplyTo: getString(record, "inReplyTo"),
    to: getStringArray(record, "to"),
    cc: getStringArray(record, "cc"),
    conversation: getString(record, "conversation"),
    content: getString(record, "content"),
    summary:
      typeof summaryRaw === "string"
        ? summaryRaw
        : summaryRaw === null
          ? null
          : undefined,
    attachment: record["attachment"],
    overlays: record["overlays"],
    endTime: getString(record, "endTime"),
    displayDuration: getString(record, "displayDuration"),
    published: getString(record, "published"),
    room: getString(record, "room"),
  };
}

function parseActivityObjectOrIri(
  value: unknown,
): string | ActivityObjectDocument | undefined {
  if (typeof value === "string") return value;
  if (isJsonRecord(value)) return parseActivityObjectFields(value);
  return undefined;
}

/**
 * Narrow an `unknown` (an already-`JSON.parse`d inbox body) into an
 * {@link ActivityDocument}. Throws if the value is not a JSON object.
 * Callers are expected to enforce required activity fields (`type`,
 * `actor`) separately, since the legitimate set of required fields
 * varies by activity type.
 */
export function parseActivity(value: unknown, path = "$"): ActivityDocument {
  const record = requireRecord(value, path);
  return {
    id: getString(record, "id"),
    type: getString(record, "type"),
    actor: getString(record, "actor"),
    object: parseActivityObjectOrIri(record["object"]),
    target: parseActivityObjectOrIri(record["target"]),
    room: getString(record, "room"),
  };
}

// ---------------------------------------------------------------------------
// WebFinger
// ---------------------------------------------------------------------------

export interface WebFingerLinkDocument {
  rel?: string;
  type?: string;
  href?: string;
}

export interface WebFingerDocument {
  links?: WebFingerLinkDocument[];
}

/**
 * Narrow an `unknown` from a `.well-known/webfinger` response into
 * {@link WebFingerDocument}. Links with non-string fields are dropped.
 */
export function parseWebFinger(value: unknown, path = "$"): WebFingerDocument {
  const record = requireRecord(value, path);
  const rawLinks = record["links"];
  if (!Array.isArray(rawLinks)) return {};
  const links: WebFingerLinkDocument[] = [];
  for (const link of rawLinks) {
    if (!isJsonRecord(link)) continue;
    links.push({
      rel: getString(link, "rel"),
      type: getString(link, "type"),
      href: getString(link, "href"),
    });
  }
  return { links };
}
