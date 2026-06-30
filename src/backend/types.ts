import type { Database } from "../db/index.ts";
import type {
  IKeyValueStore,
  IObjectStorage,
  IStaticAssets,
} from "./runtime/types.ts";
import type {
  DeliveryDlqMessageV1,
  DeliveryQueueMessageV1,
} from "./lib/delivery/types.ts";

/**
 * Environment Variables (common across all runtimes)
 */
export interface EnvVars {
  APP_URL: string;

  // Takos-specific endpoints are opt-in (fail-close by default).
  ENABLE_TAKOS_TOOLS?: string;

  // 認証設定（自由に組み合わせ可能）
  AUTH_PASSWORD_HASH?: string; // PBKDF2-hashed password
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  OIDC_ISSUER_URL?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OAUTH_ISSUER_URL?: string;
  TAKOSUMI_ACCOUNTS_ISSUER_URL?: string;
  TAKOSUMI_ACCOUNTS_CLIENT_ID?: string;
  TAKOSUMI_ACCOUNTS_CLIENT_SECRET?: string;
  // Pins the OIDC/OAuth subject allowed to take the single owner slot. When set,
  // only a first-login whose subject equals this value becomes `owner`; any other
  // first-login is refused. Prevents an owner-slot race on an OIDC-seeded Capsule.
  OIDC_OWNER_SUB?: string;
  TAKOSUMI_ACCOUNTS_OWNER_SUB?: string;
  // Comma-separated allowlist of OAuth/OIDC subjects permitted to auto-provision
  // a NON-owner (member) account. Empty/unset = member auto-provisioning is
  // CLOSED (single-user default): once the owner exists, no new external subject
  // can self-register a member just by completing the issuer's OAuth flow.
  OIDC_ALLOWED_SUBS?: string;
  TAKOS_URL?: string; // Optional Takos API base URL; not the OIDC issuer.
  AUTH_MODE?: string;
  ENCRYPTION_KEY?: string; // 32-byte hex key for encrypting sensitive data

  // Per-deployment salt mixed into the SHA-256 of the session id before it is
  // persisted as the session-row lookup key. The raw session id only ever
  // lives in the client cookie; a read-only DB leak cannot be replayed without
  // also recovering the raw id. Production deployments MUST set this to a
  // high-entropy value (see hashSessionId in lib/crypto.ts). When
  // YURUCOMMU_STRICT_READINESS is enabled and this is unset, the app warns.
  YURUCOMMU_SESSION_HASH_SALT?: string;

  // Shadow delivery probes (staging-only). Comma-separated hosts.
  DELIVERY_SHADOW_PROBE_HOSTS?: string;
  // 0.0-1.0 sampling rate for probes (default: 1.0)
  DELIVERY_SHADOW_PROBE_SAMPLE_RATE?: string;
  DELIVERY_QUEUE_NAME?: string;
  DELIVERY_DLQ_NAME?: string;
  YURUCOMMU_STRICT_READINESS?: string;
  YURUCOMMU_ENABLE_LOCAL_SUBSTRATE_REMOTE_FETCHES?: string;
  YURUCOMMU_ENABLE_LOCAL_DELIVERY_QUEUE?: string;
  // Software version advertised in NodeInfo (software.version). The build /
  // deploy pipeline should inject the real build version here; when unset the
  // app falls back to the YURUCOMMU_VERSION default constant.
  YURUCOMMU_SOFTWARE_VERSION?: string;

  // CSRF allowed origins (comma-separated). APP_URL の origin に加えて
  // 受け付ける追加 origin (= dev hostname (`https://yurucommu.test`) を
  // production-equivalent な strict CSRF check 経由で踏むため)。 未設定なら
  // 既存動作と同じ (= APP_URL 単一 origin のみ accept、 production 影響ゼロ)。
  CSRF_ALLOWED_ORIGINS?: string;

  // Declare the reverse-proxy type so the client-IP resolver trusts the right
  // forwarding header (opt-in; a worker fronted directly by a client cannot
  // spoof its own IP otherwise). Accepted values:
  //   "generic" — nginx / Caddy / Traefik: trust X-Forwarded-For (leftmost) /
  //               X-Real-IP, and IGNORE a client-settable CF-Connecting-IP.
  //   "cf"      — a Cloudflare front (incl. cloudflared tunnel): trust
  //               CF-Connecting-IP.
  //   "true" / "1" — legacy alias: behaves like "generic" but keeps a
  //               CF-Connecting-IP fallback for back-compat.
  // The genuine Cloudflare edge (unspoofable request.cf) always trusts
  // CF-Connecting-IP with no opt-in.
  TAKOS_TRUST_PROXY?: string;
}

/**
 * Application Environment
 *
 * Uses the runtime-neutral `I*` contracts. The Cloudflare worker entry
 * wraps the native `D1Database` / `R2Bucket` / `KVNamespace` / `Fetcher`
 * bindings with the adapters in `runtime/cloudflare.ts` before handing
 * the Env to Hono. The local runtime compatibility classes already
 * implement these contracts directly.
 *
 * `DB_INSTANCE` is the drizzle wrapper that the app calls; it is built
 * by each runtime entry point (Cloudflare `fetch`, local server, or
 * runtime-specific wrappers).
 */
export type Env = {
  DB_INSTANCE: Database;
  MEDIA?: IObjectStorage;
  KV: IKeyValueStore;
  ASSETS?: IStaticAssets;
  DELIVERY_QUEUE?: Queue<DeliveryQueueMessageV1>;
  DELIVERY_DLQ?: Queue<DeliveryDlqMessageV1>;
} & EnvVars;

export type Variables = {
  actor: Actor | null;
  db: Database;
  oauthToken?: { sub: string; scope: string; client_id: string };
};

// Local actor (Person)
export interface Actor {
  ap_id: string; // Primary key: https://domain/ap/users/username
  type: string;
  preferred_username: string;
  name: string | null;
  summary: string | null;
  icon_url: string | null;
  header_url: string | null;
  inbox: string;
  outbox: string;
  followers_url: string;
  following_url: string;
  public_key_pem: string;
  private_key_pem: string;
  takos_user_id: string | null;
  follower_count: number;
  following_count: number;
  post_count: number;
  is_private: number;
  role: "owner" | "moderator" | "member";
  created_at: string;
}

// Re-export Hono types for route files
export type { Context } from "hono";
