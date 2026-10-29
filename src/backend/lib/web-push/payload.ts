/**
 * Declarative Web Push message (WebKit, Safari 18.4+): a JSON payload that a
 * user agent can display without running a Service Worker. Browsers without
 * declarative support show the same fields from the app's Service Worker, and
 * Takosumi Mobile shows them natively.
 *
 * {"web_push": 8030, "notification": {"title", "navigate", ...}}
 */

import { utf8 } from "./bytes.ts";

export const DECLARATIVE_WEB_PUSH_MAGIC = 8030;
/**
 * Plaintext budget. Encryption adds 103 bytes and a relay may base64 the body
 * into an APNs/FCM message (~4 KB), so stay well under the 3993-byte limit.
 */
export const MAX_DECLARATIVE_WEB_PUSH_BYTES = 2048;

export interface DeclarativeWebPushNotification {
  readonly title: string;
  readonly navigate: string;
  readonly body?: string;
  readonly lang?: string;
  readonly tag?: string;
  /** Unsigned integer as a decimal string, as in WebKit's examples. */
  readonly app_badge?: string;
}

export interface DeclarativeWebPushMessage {
  readonly web_push: typeof DECLARATIVE_WEB_PUSH_MAGIC;
  readonly notification: DeclarativeWebPushNotification;
}

export interface DeclarativeWebPushInput {
  /** The app's own origin; `navigate` must stay on it. */
  readonly appOrigin: string;
  readonly title: string;
  /** Absolute URL or a path resolved against `appOrigin`. */
  readonly navigate: string;
  readonly body?: string;
  readonly lang?: string;
  readonly tag?: string;
  readonly appBadge?: number;
  readonly maxBytes?: number;
}

/**
 * Build the message and return it with its UTF-8 bytes. `navigate` falls back
 * to the app root when it would leave the app's origin; the body (then the
 * title) is shortened until the plaintext fits `maxBytes`.
 */
export function buildDeclarativeWebPushMessage(
  input: DeclarativeWebPushInput,
): {
  readonly message: DeclarativeWebPushMessage;
  readonly bytes: Uint8Array;
} {
  const origin = new URL(input.appOrigin).origin;
  const maxBytes = input.maxBytes ?? MAX_DECLARATIVE_WEB_PUSH_BYTES;
  const navigate = sameOriginUrl(input.navigate, origin);
  const lang = normalizeLanguageTag(input.lang);
  const tag = input.tag?.trim().slice(0, 64) || undefined;
  const appBadge =
    input.appBadge !== undefined &&
    Number.isSafeInteger(input.appBadge) &&
    input.appBadge >= 0
      ? String(input.appBadge)
      : undefined;

  let title = singleLine(input.title) || new URL(origin).hostname;
  let body = input.body ? singleLine(input.body) : undefined;
  for (;;) {
    const message: DeclarativeWebPushMessage = {
      web_push: DECLARATIVE_WEB_PUSH_MAGIC,
      notification: {
        title,
        navigate,
        ...(body ? { body } : {}),
        ...(lang ? { lang } : {}),
        ...(tag ? { tag } : {}),
        ...(appBadge !== undefined ? { app_badge: appBadge } : {}),
      },
    };
    const bytes = utf8(JSON.stringify(message));
    if (bytes.byteLength <= maxBytes) return { message, bytes };
    const excess = bytes.byteLength - maxBytes;
    if (body) {
      body = shorten(body, excess);
    } else if ([...title].length > 1) {
      title = shorten(title, excess) ?? [...title][0]!;
    } else {
      throw new Error("declarative web push message cannot fit the size limit");
    }
  }
}

function sameOriginUrl(value: string, origin: string): string {
  try {
    const url = new URL(value, `${origin}/`);
    if (url.origin === origin && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    // fall through
  }
  return `${origin}/`;
}

function normalizeLanguageTag(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(text)
    ? text
    : undefined;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Drop at least `excessBytes` of UTF-8 from the end (whole code points) and
 * add an ellipsis. Returns undefined when nothing meaningful remains.
 */
function shorten(value: string, excessBytes: number): string | undefined {
  const codePoints = [...value];
  let removed = 0;
  // The ellipsis itself costs 3 bytes.
  while (codePoints.length > 0 && removed < excessBytes + 3) {
    removed += utf8(codePoints.pop()!).byteLength;
  }
  const kept = codePoints.join("").trimEnd();
  return kept ? `${kept}…` : undefined;
}
