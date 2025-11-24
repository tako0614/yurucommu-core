/**
 * Remote Actor Fetching and Caching
 *
 * Fetches remote ActivityPub actors and caches them in the database
 */

import type { D1Database } from "@cloudflare/workers-types";
import { makeData } from "../server/data-factory";

export interface RemoteActor {
  id: string; // Actor URI
  type: string; // Person, Group, Service, etc.
  preferredUsername: string;
  name?: string;
  summary?: string;
  inbox: string;
  outbox?: string;
  followers?: string;
  following?: string;
  publicKey?: {
    id: string;
    owner: string;
    publicKeyPem: string;
  };
  icon?: {
    type: string;
    mediaType: string;
    url: string;
  };
  image?: {
    type: string;
    mediaType: string;
    url: string;
  };
  endpoints?: {
    sharedInbox?: string;
  };
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function extractHandle(actor: any, actorUri: string): string {
  const value = typeof actor?.preferredUsername === "string" ? actor.preferredUsername.trim() : "";
  if (value) return value;
  try {
    const url = new URL(actorUri);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : url.hostname.replace(/\./g, "_");
  } catch {
    return actorUri;
  }
}

function extractDisplayName(actor: any, fallback: string): string {
  const name = typeof actor?.name === "string" ? actor.name.trim() : "";
  return name || fallback;
}

function extractSummary(actor: any): string | null {
  if (!actor) return null;
  if (typeof actor.summary === "string") {
    return actor.summary;
  }
  if (actor.summary && typeof actor.summary === "object") {
    return (
      typeof actor.summary.value === "string"
        ? actor.summary.value
        : typeof actor.summary.content === "string"
        ? actor.summary.content
        : null
    );
  }
  return null;
}

function extractIconUrl(actor: any): string | null {
  const icon = actor?.icon;
  if (!icon) return null;
  if (typeof icon === "string") return icon;
  if (typeof icon === "object") {
    if (typeof icon.url === "string") return icon.url;
    if (typeof icon.href === "string") return icon.href;
  }
  return null;
}

function remoteActorToRecord(
  actorUri: string,
  actor: RemoteActor | Record<string, any>,
  domain: string,
) {
  const handle = extractHandle(actor, actorUri);
  const displayName = extractDisplayName(actor, handle);
  const summary = extractSummary(actor);
  const iconUrl = extractIconUrl(actor);
  const followersUrl = typeof (actor as any).followers === "string" ? (actor as any).followers : null;
  const followingUrl = typeof (actor as any).following === "string" ? (actor as any).following : null;
  const publicKeyPem =
    typeof (actor as any).publicKey?.publicKeyPem === "string"
      ? (actor as any).publicKey.publicKeyPem
      : "";
  const publicKeyId =
    typeof (actor as any).publicKey?.id === "string"
      ? (actor as any).publicKey.id
      : `${actorUri}#main-key`;

  return {
    id: actorUri,
    handle,
    domain,
    type: typeof (actor as any).type === "string" ? (actor as any).type : "Person",
    display_name: displayName,
    summary: summary,
    icon_url: iconUrl,
    inbox_url: (actor as any).inbox || actorUri,
    outbox_url: (actor as any).outbox || (actor as any).inbox || actorUri,
    followers_url: followersUrl,
    following_url: followingUrl,
    public_key_pem: publicKeyPem,
    public_key_id: publicKeyId,
  };
}

function mapRowToRemoteActor(row: any): RemoteActor {
  const preferredUsername = row.handle || row.id;
  const actor: RemoteActor = {
    id: row.id,
    type: row.type || "Person",
    preferredUsername,
    name: row.display_name || preferredUsername,
    summary: row.summary ?? undefined,
    inbox: row.inbox_url,
    outbox: row.outbox_url ?? undefined,
    followers: row.followers_url ?? undefined,
    following: row.following_url ?? undefined,
  };
  if (row.public_key_pem) {
    actor.publicKey = {
      id: row.public_key_id || `${row.id}#main-key`,
      owner: row.id,
      publicKeyPem: row.public_key_pem,
    };
  }
  if (row.icon_url) {
    actor.icon = {
      type: "Image",
      mediaType: "image/*",
      url: row.icon_url,
    };
  }
  return actor;
}

const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT_MS = 10000; // 10 seconds

/**
 * Fetch remote actor from their instance with DoS protection
 *
 * @param actorUri - Full URI of the actor (e.g., https://mastodon.social/users/alice)
 * @returns Remote actor object
 */
export async function fetchRemoteActor(
  actorUri: string,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch
): Promise<RemoteActor | null> {
  try {
    console.log(`Fetching remote actor: ${actorUri}`);

    // Create timeout controller
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetcher(actorUri, {
        headers: {
          Accept: "application/activity+json, application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\"",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`Failed to fetch actor ${actorUri}: ${response.status} ${response.statusText}`);
        return null;
      }

      // Check Content-Length header for early size validation
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > MAX_RESPONSE_SIZE) {
          console.error(`Actor response too large: ${size} bytes (max ${MAX_RESPONSE_SIZE})`);
          return null;
        }
      }

      // Read response with size limit
      const text = await response.text();
      if (text.length > MAX_RESPONSE_SIZE) {
        console.error(`Actor response body too large: ${text.length} bytes`);
        return null;
      }

      // Parse JSON with error handling
      let actor: any;
      try {
        actor = JSON.parse(text);
      } catch (parseError) {
        console.error(`Failed to parse actor JSON from ${actorUri}:`, parseError);
        return null;
      }

      // Validate required fields
      if (!actor || typeof actor !== 'object' || !actor.id || !actor.type || !actor.inbox) {
        console.error(`Invalid actor object from ${actorUri}:`, actor);
        return null;
      }

      return actor as RemoteActor;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.error(`Timeout fetching remote actor ${actorUri}`);
    } else {
      console.error(`Error fetching remote actor ${actorUri}:`, error);
    }
    return null;
  }
}

/**
 * Get or fetch remote actor, with caching
 *
 * @param actorUri - Full URI of the actor
 * @param env - Cloudflare Workers environment
 * @param forceRefresh - Force re-fetch even if cached
 * @returns Remote actor object
 */
export async function getOrFetchActor(
  actorUri: string,
  env: { DB: D1Database },
  forceRefresh = false,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch
): Promise<RemoteActor | null> {
  const db = makeData(env as any);

  try {
    // Check cache first
    if (!forceRefresh) {
      const cached = await db.findApActor(actorUri);
      if (cached) {
        const updatedAt = cached.last_fetched_at ?? cached.updated_at;
        const age = updatedAt ? Date.now() - updatedAt.getTime() : Number.POSITIVE_INFINITY;
        if (age < CACHE_TTL_MS) {
          console.log(`Using cached actor: ${actorUri}`);
          return mapRowToRemoteActor(cached);
        }
      }
    }

    // Fetch from remote
    const actor = await fetchRemoteActor(actorUri, fetcher);
    if (!actor) {
      return null;
    }

    // Extract instance domain
    const instanceDomain = new URL(actorUri).hostname;
    const now = new Date();
    const record = remoteActorToRecord(actorUri, actor, instanceDomain);

    await db.upsertApActor({
      ...record,
      created_at: now,
      updated_at: now,
      last_fetched_at: now,
    });

    console.log(`Cached remote actor: ${actorUri}`);
    return actor;
  } catch (error) {
    console.error(`Error in getOrFetchActor for ${actorUri}:`, error);
    return null;
  } finally {
    await db.disconnect();
  }
}

/**
 * Get public key for remote actor
 *
 * @param actorUri - Full URI of the actor
 * @param env - Cloudflare Workers environment
 * @returns Public key PEM or null
 */
export async function getActorPublicKey(actorUri: string, env: { DB: D1Database }): Promise<string | null> {
  const actor = await getOrFetchActor(actorUri, env);
  if (!actor || !actor.publicKey) {
    return null;
  }
  return actor.publicKey.publicKeyPem;
}

/**
 * Verify that an activity's actor matches the signature keyId owner
 *
 * @param activityActorUri - Actor URI from activity.actor
 * @param signatureKeyId - keyId from Signature header
 * @param env - Cloudflare Workers environment
 * @returns true if actor owns the key
 */
export async function verifyActorOwnsKey(
  activityActorUri: string,
  signatureKeyId: string,
  env: { DB: D1Database },
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch
): Promise<boolean> {
  // Fetch actor
  const actor = await getOrFetchActor(activityActorUri, env, false, fetcher);
  if (!actor || !actor.publicKey) {
    console.error(`Actor ${activityActorUri} has no public key`);
    return false;
  }

  // Check if keyId matches actor's public key
  // KeyId format: https://mastodon.social/users/alice#main-key
  // Actor publicKey.id should match
  if (actor.publicKey.id !== signatureKeyId) {
    console.error(`Key ID mismatch: ${signatureKeyId} !== ${actor.publicKey.id}`);
    return false;
  }

  // Verify key owner matches actor
  if (actor.publicKey.owner !== actor.id) {
    console.error(`Key owner mismatch: ${actor.publicKey.owner} !== ${actor.id}`);
    return false;
  }

  return true;
}

/**
 * WebFinger lookup to discover actor URI
 *
 * @param account - Account in format "user@domain.com"
 * @param fetcher - Optional custom fetch function (e.g. for Service Bindings)
 * @returns Actor URI or null
 */
export async function webfingerLookup(
  account: string,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch
): Promise<string | null> {
  try {
    const [username, domain] = account.split("@");
    if (!username || !domain) {
      console.error(`[WebFinger] Invalid account format: "${account}" (expected "user@domain")`);
      return null;
    }

    const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=acct:${account}`;
    console.log(`[WebFinger] Lookup: ${webfingerUrl}`);

    const response = await fetcher(webfingerUrl, {
      headers: {
        Accept: "application/jrd+json",
      },
    });

    if (!response.ok) {
      console.error(`[WebFinger] Failed: ${response.status} ${response.statusText} for ${webfingerUrl}`);
      const text = await response.text().catch(() => "");
      if (text) {
        console.error(`[WebFinger] Response body: ${text.substring(0, 500)}`);
      }
      return null;
    }

    const data = await response.json() as any;
    console.log(`[WebFinger] Response data:`, JSON.stringify(data, null, 2));

    // Find self link with application/activity+json
    const selfLink = data?.links?.find(
      (link: any) => link.rel === "self" && link.type === "application/activity+json"
    );

    if (!selfLink || !selfLink.href) {
      console.error(`[WebFinger] No ActivityPub self link in response for ${account}`);
      console.error(`[WebFinger] Available links:`, data?.links);
      return null;
    }

    console.log(`[WebFinger] Found actor URI: ${selfLink.href}`);
    return selfLink.href;
  } catch (error) {
    console.error(`[WebFinger] Error for ${account}:`, error);
    return null;
  }
}

/**
 * Fetch remote object (Note, Article, etc.) from their instance
 *
 * @param objectUri - Full URI of the object
 * @returns Remote object
 */
export async function fetchRemoteObject(objectUri: string): Promise<any | null> {
  try {
    console.log(`Fetching remote object: ${objectUri}`);

    // Create timeout controller
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(objectUri, {
        headers: {
          Accept: "application/activity+json, application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\"",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`Failed to fetch object ${objectUri}: ${response.status} ${response.statusText}`);
        return null;
      }

      // Check Content-Length header for early size validation
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (size > MAX_RESPONSE_SIZE) {
          console.error(`Object response too large: ${size} bytes (max ${MAX_RESPONSE_SIZE})`);
          return null;
        }
      }

      // Read response with size limit
      const text = await response.text();
      if (text.length > MAX_RESPONSE_SIZE) {
        console.error(`Object response body too large: ${text.length} bytes`);
        return null;
      }

      // Parse JSON with error handling
      let object: any;
      try {
        object = JSON.parse(text);
      } catch (parseError) {
        console.error(`Failed to parse object JSON from ${objectUri}:`, parseError);
        return null;
      }

      // Validate required fields
      if (!object || typeof object !== 'object' || !object.id || !object.type) {
        console.error(`Invalid object from ${objectUri}:`, object);
        return null;
      }

      return object;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.error(`Timeout fetching remote object ${objectUri}`);
    } else {
      console.error(`Error fetching remote object ${objectUri}:`, error);
    }
    return null;
  }
}
