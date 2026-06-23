/**
 * OAuth Provider Configuration
 *
 * 環境変数に設定されたプロバイダーのみ有効になる
 * 複数のプロバイダーを自由に組み合わせ可能
 */

import type { Env } from "../types.ts";

export interface OAuthProvider {
  id: string;
  name: string;
  icon: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  // PKCE対応
  supportsPkce: boolean;
  // For OIDC providers (Takosumi Accounts): the issuer origin + JWKS endpoint,
  // used to verify the ID Token signature + claims in the login callback. Absent
  // for plain OAuth2 providers (e.g. X) that issue no OIDC ID Token.
  issuer?: string;
  jwksUrl?: string;
}

export interface AuthConfig {
  passwordEnabled: boolean;
  providers: OAuthProvider[];
}

function envValue(env: Env, key: keyof Env): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

export function getOidcIssuerUrl(env: Env): string | null {
  return (
    envValue(env, "OIDC_ISSUER_URL") ??
    envValue(env, "OAUTH_ISSUER_URL") ??
    envValue(env, "TAKOSUMI_ACCOUNTS_ISSUER_URL") ??
    null
  );
}

export function getOidcClientCredentials(env: Env): {
  clientId: string;
  clientSecret: string;
} {
  return {
    clientId:
      envValue(env, "OIDC_CLIENT_ID") ??
      envValue(env, "TAKOSUMI_ACCOUNTS_CLIENT_ID") ??
      "",
    clientSecret:
      envValue(env, "OIDC_CLIENT_SECRET") ??
      envValue(env, "TAKOSUMI_ACCOUNTS_CLIENT_SECRET") ??
      "",
  };
}

export function issuerEndpoint(issuer: string, path: string): string {
  return `${issuer.replace(/\/$/, "")}${path}`;
}

/**
 * 環境変数から有効な認証方法を取得
 */
export function getAuthConfig(env: Env): AuthConfig {
  const providers: OAuthProvider[] = [];

  // Google OAuth
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push({
      id: "google",
      name: "Google",
      icon: "/icons/google.svg",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
      scopes: ["openid", "profile", "email"],
      supportsPkce: true,
    });
  }

  // X (Twitter) OAuth 2.0
  if (env.X_CLIENT_ID && env.X_CLIENT_SECRET) {
    providers.push({
      id: "x",
      name: "X",
      icon: "/icons/x.svg",
      authorizeUrl: "https://twitter.com/i/oauth2/authorize",
      tokenUrl: "https://api.twitter.com/2/oauth2/token",
      userInfoUrl: "https://api.twitter.com/2/users/me",
      scopes: ["tweet.read", "users.read", "offline.access"],
      supportsPkce: true,
    });
  }

  // Takosumi Accounts OIDC. The client SECRET is optional: when Takosumi
  // materializes the OIDC client for an auto-provisioned Capsule it mints a
  // PUBLIC client (token_endpoint_auth_method "none", PKCE-only, no secret — the
  // service-graph resolve path can't deliver a confidential secret). A confidential
  // client (secret set) also works. Either way PKCE-S256 protects the exchange,
  // so issuer + client_id are sufficient to offer the provider.
  const oidcIssuer = getOidcIssuerUrl(env);
  const { clientId: oidcClientId } = getOidcClientCredentials(env);
  if (oidcIssuer && oidcClientId) {
    providers.push({
      id: "takos",
      name: "Takosumi Accounts",
      icon: "/icons/takos.svg",
      authorizeUrl: issuerEndpoint(oidcIssuer, "/oauth/authorize"),
      tokenUrl: issuerEndpoint(oidcIssuer, "/oauth/token"),
      userInfoUrl: issuerEndpoint(oidcIssuer, "/oauth/userinfo"),
      scopes: ["openid", "profile", "email"],
      supportsPkce: true,
      issuer: oidcIssuer.replace(/\/+$/, ""),
      jwksUrl: issuerEndpoint(oidcIssuer, "/oauth/jwks"),
    });
  }

  return {
    // A whitespace-only hash is treated as "disabled" (mirrors the login gate),
    // never as a one-character password.
    passwordEnabled: !!env.AUTH_PASSWORD_HASH?.trim(),
    providers,
  };
}

/**
 * プロバイダーIDからプロバイダー設定を取得
 */
export function getProvider(
  env: Env,
  providerId: string,
): OAuthProvider | null {
  const config = getAuthConfig(env);
  return config.providers.find((p) => p.id === providerId) || null;
}

/**
 * 既知のプロバイダーID 集合。 caller boundary は `string` で受けるが、
 * switch では narrowed union で exhaustive に分岐する。
 */
export type ProviderId = "google" | "x" | "takos";

// Upper bound for the userinfo fetch so a hung provider can't stall login.
const USERINFO_FETCH_TIMEOUT_MS = 10_000;

const KNOWN_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "google",
  "x",
  "takos",
]);

function isKnownProviderId(value: string): value is ProviderId {
  return KNOWN_PROVIDER_IDS.has(value as ProviderId);
}

function assertNeverProvider(x: never): never {
  throw new Error(`Unhandled provider id: ${JSON.stringify(x)}`);
}

/**
 * プロバイダーIDからクライアント認証情報を取得
 */
export function getClientCredentials(
  env: Env,
  providerId: string,
): { clientId: string; clientSecret: string } {
  if (!isKnownProviderId(providerId)) {
    return { clientId: "", clientSecret: "" };
  }
  switch (providerId) {
    case "google":
      return {
        clientId: env.GOOGLE_CLIENT_ID || "",
        clientSecret: env.GOOGLE_CLIENT_SECRET || "",
      };
    case "x":
      return {
        clientId: env.X_CLIENT_ID || "",
        clientSecret: env.X_CLIENT_SECRET || "",
      };
    case "takos":
      return getOidcClientCredentials(env);
    default:
      return assertNeverProvider(providerId);
  }
}

/**
 * ユーザー情報を正規化
 */
export interface NormalizedUserInfo {
  id: string;
  name: string;
  email?: string;
  picture?: string;
  username?: string;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getObject(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isJsonObject(value) ? value : undefined;
}

function parseGoogleUserInfo(
  data: Record<string, unknown>,
): NormalizedUserInfo {
  const id = getString(data, "id");
  const name = getString(data, "name");
  if (!id || !name) {
    throw new Error("Google userinfo response missing required fields");
  }
  return {
    id,
    name,
    email: getString(data, "email"),
    picture: getString(data, "picture"),
  };
}

function parseXUserInfo(data: Record<string, unknown>): NormalizedUserInfo {
  const inner = getObject(data, "data");
  if (!inner) {
    throw new Error("X userinfo response missing data field");
  }
  const id = getString(inner, "id");
  const name = getString(inner, "name");
  const username = getString(inner, "username");
  if (!id || !name || !username) {
    throw new Error("X userinfo response missing required fields");
  }
  return {
    id,
    name,
    username,
    picture: getString(inner, "profile_image_url"),
  };
}

function parseTakosUserInfo(data: Record<string, unknown>): NormalizedUserInfo {
  const user = getObject(data, "user");
  const id = user ? getString(user, "id") : undefined;
  const sub = getString(data, "sub");
  const resolvedId = id ?? sub;
  const userName = user ? getString(user, "name") : undefined;
  const topName = getString(data, "name");
  const resolvedName = userName ?? topName ?? resolvedId;
  if (!resolvedId || !resolvedName) {
    throw new Error("Takosumi Accounts userinfo response missing subject");
  }
  return {
    id: resolvedId,
    name: resolvedName,
    email:
      (user ? getString(user, "email") : undefined) ?? getString(data, "email"),
    picture:
      (user ? getString(user, "picture") : undefined) ??
      getString(data, "picture"),
  };
}

export async function fetchUserInfo(
  provider: OAuthProvider,
  accessToken: string,
): Promise<NormalizedUserInfo> {
  const url =
    provider.id === "x"
      ? `${provider.userInfoUrl}?user.fields=profile_image_url`
      : provider.userInfoUrl;

  // Bound the userinfo fetch (and its body read) so a hung provider can't stall
  // the login request; the timer stays armed through res.json(). Mirrors the
  // token-exchange and fetchJwks timeouts.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USERINFO_FETCH_TIMEOUT_MS);
  let raw: unknown;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch user info: ${res.status}`);
    }
    raw = await res.json();
  } finally {
    clearTimeout(timer);
  }
  if (!isJsonObject(raw)) {
    throw new Error(`Invalid userinfo response from provider: ${provider.id}`);
  }

  switch (provider.id) {
    case "google":
      return parseGoogleUserInfo(raw);
    case "x":
      return parseXUserInfo(raw);
    case "takos":
      return parseTakosUserInfo(raw);
    default:
      throw new Error(`Unknown provider: ${provider.id}`);
  }
}
