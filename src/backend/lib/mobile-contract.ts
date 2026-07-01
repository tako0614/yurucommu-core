export const MOBILE_PUSH_REGISTRATION_PATH =
  "/api/mobile/push-registrations" as const;

export type MobileProductKind = "yurucommu";

export interface MobilePushHostRegistrationRequest {
  readonly product: MobileProductKind;
  readonly token: string;
  readonly environment?: string;
  readonly host_url?: string | null;
}

export interface ParsedMobilePushHostRegistrationRequest {
  readonly product: MobileProductKind;
  readonly token: string;
  readonly environment: string;
  readonly hostUrl: string | null;
}

export interface MobilePushHostRegistration {
  readonly id: string;
  readonly product: MobileProductKind;
  readonly environment: string;
  readonly host_url: string | null;
  readonly registered_at: string;
  readonly last_seen_at: string;
}

export interface MobilePushHostUnregistrationResponse {
  readonly unregistered: true;
}

export interface MobilePushHostRegistrationParseError {
  readonly code: "BAD_REQUEST";
  readonly error: string;
  readonly field?: keyof MobilePushHostRegistrationRequest;
}

export type MobilePushHostRegistrationParseResult =
  | {
      readonly ok: true;
      readonly value: ParsedMobilePushHostRegistrationRequest;
    }
  | {
      readonly ok: false;
      readonly error: MobilePushHostRegistrationParseError;
    };

export function parseMobilePushHostRegistrationRequest(
  body: unknown,
): MobilePushHostRegistrationParseResult {
  if (!isRecord(body)) {
    return badRequest("body must be an object");
  }

  if (body.product !== "yurucommu") {
    return badRequest("product must be yurucommu", "product");
  }

  const token = parseNonEmptyString(body.token);
  if (!token || token.length > 4096) {
    return badRequest("token is invalid", "token");
  }

  const environment =
    body.environment == null
      ? "production"
      : parseShortIdentifier(body.environment);
  if (!environment) {
    return badRequest("environment is invalid", "environment");
  }

  const hostUrl = parseOptionalHttpUrl(body.host_url);
  if (hostUrl === undefined) {
    return badRequest("host_url is invalid", "host_url");
  }

  return {
    ok: true,
    value: {
      product: "yurucommu",
      token,
      environment,
      hostUrl,
    },
  };
}

function badRequest(
  error: string,
  field?: keyof MobilePushHostRegistrationRequest,
): MobilePushHostRegistrationParseResult {
  return { ok: false, error: { code: "BAD_REQUEST", error, field } };
}

function parseShortIdentifier(value: unknown): string | null {
  const text = parseNonEmptyString(value);
  if (!text || text.length > 64) return null;
  return /^[a-z0-9._:-]+$/i.test(text) ? text : null;
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalHttpUrl(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
