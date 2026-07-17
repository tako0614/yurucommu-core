/**
 * Wire-compatible subset of Takosumi's product-neutral notification pusher
 * contract. This package is independently published, so it intentionally does
 * not import Takosumi source at runtime.
 */

export const NOTIFICATION_PUSHER_REGISTRATION_PATH =
  "/api/notifications/pushers" as const;
export const MATRIX_PUSH_GATEWAY_NOTIFY_PATH =
  "/_matrix/push/v1/notify" as const;
export const MAX_NOTIFICATION_PUSHER_DATA_BYTES = 2 * 1024;
export const SOCIAL_NOTIFICATION_PRODUCTS = ["yurucommu", "yurume"] as const;

export type SocialNotificationProduct =
  (typeof SOCIAL_NOTIFICATION_PRODUCTS)[number];

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface NotificationPusher {
  readonly kind: "http";
  readonly app_id: string;
  readonly pushkey: string;
  readonly app_display_name?: string;
  readonly device_display_name?: string;
  readonly profile_tag?: string;
  readonly lang?: string;
  readonly data: JsonObject & {
    readonly url: string;
    readonly format?: "event_id_only" | "full";
  };
}

export interface ParsedNotificationPusherSetRequest {
  readonly product: SocialNotificationProduct;
  readonly scope: string | null;
  readonly pusher: NotificationPusher;
  readonly gatewayUrl: string;
  readonly storedData: JsonObject;
}

export interface ParsedNotificationPusherDeleteRequest {
  readonly product: SocialNotificationProduct;
  readonly scope: string | null;
  readonly appId: string;
  readonly pushkey: string;
}

export type NotificationPusherParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "BAD_REQUEST";
        readonly error: string;
        readonly field?: string;
      };
    };

export function parseNotificationPusherSetRequest(
  body: unknown,
): NotificationPusherParseResult<ParsedNotificationPusherSetRequest> {
  if (!isRecord(body)) return bad("body must be an object");
  const product = parseProduct(body.product);
  if (!product) {
    return bad("product must be yurucommu or yurume", "product");
  }
  const scope = parseOptionalIdentifier(body.scope);
  if (scope === undefined) return bad("scope is invalid", "scope");
  if (!isRecord(body.pusher)) return bad("pusher must be an object", "pusher");
  const pusher = body.pusher;
  if (pusher.kind !== "http") {
    return bad("pusher.kind must be http", "pusher.kind");
  }
  const appId = parseBoundedString(pusher.app_id, 255);
  if (!appId || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(appId)) {
    return bad("pusher.app_id is invalid", "pusher.app_id");
  }
  const pushkey = parseBoundedString(pusher.pushkey, 4096);
  if (!pushkey) return bad("pusher.pushkey is invalid", "pusher.pushkey");
  if (!isRecord(pusher.data)) {
    return bad("pusher.data must be an object", "pusher.data");
  }
  const gatewayUrl = normalizeGatewayUrl(pusher.data.url);
  if (!gatewayUrl) {
    return bad("pusher.data.url is invalid", "pusher.data.url");
  }
  if (
    pusher.data.format !== undefined &&
    pusher.data.format !== "event_id_only" &&
    pusher.data.format !== "full"
  ) {
    return bad("pusher.data.format is invalid", "pusher.data.format");
  }

  const clonedStoredData = cloneJsonObjectWithoutUrl(pusher.data);
  if (!clonedStoredData) {
    return bad("pusher.data must contain only bounded JSON", "pusher.data");
  }
  // The privacy-preserving wire mode is the contract default. Persist it
  // explicitly so legacy/partial clients cannot accidentally opt into the
  // metadata-bearing payload merely by omitting `format`.
  const storedData: JsonObject = {
    ...clonedStoredData,
    format: pusher.data.format === "full" ? "full" : "event_id_only",
  };
  if (
    utf8Bytes(JSON.stringify(storedData)) > MAX_NOTIFICATION_PUSHER_DATA_BYTES
  ) {
    return bad(
      `pusher.data must be at most ${MAX_NOTIFICATION_PUSHER_DATA_BYTES} bytes without url`,
      "pusher.data",
    );
  }

  const optional = {
    app_display_name: parseOptionalBoundedString(pusher.app_display_name, 255),
    device_display_name: parseOptionalBoundedString(
      pusher.device_display_name,
      255,
    ),
    profile_tag: parseOptionalBoundedString(pusher.profile_tag, 255),
    lang: parseOptionalBoundedString(pusher.lang, 64),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value === undefined)
      return bad(`pusher.${key} is invalid`, `pusher.${key}`);
  }

  return {
    ok: true,
    value: {
      product,
      scope,
      gatewayUrl,
      storedData,
      pusher: {
        kind: "http",
        app_id: appId,
        pushkey,
        ...(optional.app_display_name
          ? { app_display_name: optional.app_display_name }
          : {}),
        ...(optional.device_display_name
          ? { device_display_name: optional.device_display_name }
          : {}),
        ...(optional.profile_tag ? { profile_tag: optional.profile_tag } : {}),
        ...(optional.lang ? { lang: optional.lang } : {}),
        data: { ...storedData, url: gatewayUrl },
      },
    },
  };
}

export function parseNotificationPusherDeleteRequest(
  body: unknown,
): NotificationPusherParseResult<ParsedNotificationPusherDeleteRequest> {
  if (!isRecord(body)) return bad("body must be an object");
  const product = parseProduct(body.product);
  if (!product) {
    return bad("product must be yurucommu or yurume", "product");
  }
  const scope = parseOptionalIdentifier(body.scope);
  if (scope === undefined) return bad("scope is invalid", "scope");
  const appId = parseBoundedString(body.app_id, 255);
  if (!appId || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(appId)) {
    return bad("app_id is invalid", "app_id");
  }
  const pushkey = parseBoundedString(body.pushkey, 4096);
  if (!pushkey) return bad("pushkey is invalid", "pushkey");
  return { ok: true, value: { product, scope, appId, pushkey } };
}

export function normalizeGatewayUrl(value: unknown): string | null {
  const text = parseBoundedString(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.username || url.password || url.hash) return null;
    if (url.protocol === "https:") {
      if (url.port && url.port !== "443") return null;
      if (!isPublicHttpsHostname(url.hostname)) return null;
      return url.toString();
    }
    if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isLoopbackGatewayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function parseProduct(value: unknown): SocialNotificationProduct | null {
  return SOCIAL_NOTIFICATION_PRODUCTS.includes(
    value as SocialNotificationProduct,
  )
    ? (value as SocialNotificationProduct)
    : null;
}

function parseOptionalIdentifier(value: unknown): string | null | undefined {
  if (value == null) return null;
  const text = parseBoundedString(value, 128);
  if (!text || !/^[A-Za-z0-9._:-]+$/.test(text)) return undefined;
  return text;
}

function parseOptionalBoundedString(
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value == null) return null;
  return parseBoundedString(value, maxLength) ?? undefined;
}

function parseBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

function cloneJsonObjectWithoutUrl(
  value: Record<string, unknown>,
): JsonObject | null {
  const clone = Object.create(null) as JsonObject;
  const budget = { entries: 0 };
  for (const [key, item] of Object.entries(value)) {
    if (key === "url") continue;
    if (utf8Bytes(key) > 128) return null;
    const parsed = cloneJson(item, 1, budget);
    if (parsed === undefined) return null;
    clone[key] = parsed;
  }
  return clone;
}

function cloneJson(
  value: unknown,
  depth: number,
  budget: { entries: number },
): JsonValue | undefined {
  if (depth > 8 || budget.entries++ >= 64) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    return utf8Bytes(value) <= 1024 ? value : undefined;
  }
  if (Array.isArray(value)) {
    if (value.length > 64) return undefined;
    const result: JsonValue[] = [];
    for (const item of value) {
      const parsed = cloneJson(item, depth + 1, budget);
      if (parsed === undefined) return undefined;
      result.push(parsed);
    }
    return result;
  }
  if (!isRecord(value)) return undefined;
  const result = Object.create(null) as JsonObject;
  for (const [key, item] of Object.entries(value)) {
    if (utf8Bytes(key) > 128) return undefined;
    const parsed = cloneJson(item, depth + 1, budget);
    if (parsed === undefined) return undefined;
    result[key] = parsed;
  }
  return result;
}

function bad<T>(
  error: string,
  field?: string,
): NotificationPusherParseResult<T> {
  return { ok: false, error: { code: "BAD_REQUEST", error, field } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1"
  ) {
    return true;
  }
  const octets = normalized.split(".").map(Number);
  return (
    octets.length === 4 &&
    octets.every(
      (part) => Number.isInteger(part) && part >= 0 && part <= 255,
    ) &&
    octets[0] === 127
  );
}

function isPublicHttpsHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !normalized.includes(".") ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home") ||
    normalized.endsWith(".lan")
  ) {
    return false;
  }

  const ipv4 = normalized.split(".").map(Number);
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return false;
  }

  // Any colon denotes an IPv6 literal. Reject local/private/non-routable IPv6
  // and public literals alike for v1; operators should use an allowlisted DNS
  // name so HTTPS identity remains meaningful.
  return !normalized.includes(":");
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
