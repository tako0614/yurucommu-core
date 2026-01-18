import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables, Actor } from '../../types';
import { activityApId, actorApId, generateId, isLocal, isSafeRemoteUrl } from '../../utils';
import { getInstanceActor } from './utils';
import type { Activity, RemoteActor } from './inbox-types';
import { getActivityObjectId } from './inbox-types';
import { handleGroupCreate, handleGroupFollow, handleGroupUndo } from './handlers/actorInboxHandlers';
import {
  handleAccept,
  handleAnnounce,
  handleCreate,
  handleDelete,
  handleFollow,
  handleLike,
  handleReject,
  handleUndo,
  handleUpdate,
} from './handlers/userInboxHandlers';

/**
 * Parse the HTTP Signature header into its components
 */
function parseSignatureHeader(signatureHeader: string): {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
} | null {
  const params: Record<string, string> = {};
  // Match key="value" pairs, handling escaped quotes
  const regex = /(\w+)="([^"]+)"/g;
  let match;
  while ((match = regex.exec(signatureHeader)) !== null) {
    params[match[1]] = match[2];
  }

  if (!params.keyId || !params.signature || !params.headers) {
    return null;
  }

  return {
    keyId: params.keyId,
    algorithm: params.algorithm || 'rsa-sha256',
    headers: params.headers.split(' '),
    signature: params.signature,
  };
}

/**
 * Fetch actor's public key from keyId URL
 */
async function fetchActorPublicKey(
  keyId: string,
  c: Context<{ Bindings: Env; Variables: Variables }>
): Promise<string | null> {
  if (!isSafeRemoteUrl(keyId)) {
    console.warn(`[HTTP Signature] Blocked unsafe keyId URL: ${keyId}`);
    return null;
  }

  // Extract actor URL from keyId (usually format: "https://example.com/users/name#main-key")
  const actorUrl = keyId.includes('#') ? keyId.split('#')[0] : keyId;

  // Check cache first
  const cached = await c.env.DB.prepare(
    'SELECT public_key_pem FROM actor_cache WHERE ap_id = ?'
  ).bind(actorUrl).first<{ public_key_pem: string }>();

  if (cached?.public_key_pem) {
    return cached.public_key_pem;
  }

  // Fetch actor document
  try {
    const res = await fetch(actorUrl, {
      headers: { 'Accept': 'application/activity+json, application/ld+json' },
    });

    if (!res.ok) {
      console.warn(`[HTTP Signature] Failed to fetch actor: ${res.status}`);
      return null;
    }

    const actorData = await res.json() as RemoteActor;
    if (!actorData?.publicKey?.publicKeyPem) {
      console.warn(`[HTTP Signature] Actor has no public key`);
      return null;
    }

    // Cache the actor for future requests
    if (actorData.id && actorData.inbox && isSafeRemoteUrl(actorData.id) && isSafeRemoteUrl(actorData.inbox)) {
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO actor_cache (ap_id, type, preferred_username, name, summary, icon_url, inbox, public_key_pem, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        actorData.id,
        actorData.type,
        actorData.preferredUsername,
        actorData.name,
        actorData.summary,
        actorData.icon?.url,
        actorData.inbox,
        actorData.publicKey.publicKeyPem,
        JSON.stringify(actorData)
      ).run();
    }

    return actorData.publicKey.publicKeyPem;
  } catch (e) {
    console.error(`[HTTP Signature] Error fetching actor:`, e);
    return null;
  }
}

/**
 * Verify HTTP Signature on incoming ActivityPub request
 */
async function verifyHttpSignature(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  body: string
): Promise<{ valid: boolean; keyId?: string; error?: string }> {
  const signatureHeader = c.req.header('Signature');
  if (!signatureHeader) {
    return { valid: false, error: 'Missing Signature header' };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return { valid: false, error: 'Invalid Signature header format' };
  }

  // Only support rsa-sha256
  if (parsed.algorithm !== 'rsa-sha256') {
    return { valid: false, error: `Unsupported algorithm: ${parsed.algorithm}` };
  }

  // Build the signature string from headers
  const url = new URL(c.req.url);
  const signatureParts: string[] = [];

  for (const headerName of parsed.headers) {
    if (headerName === '(request-target)') {
      signatureParts.push(`(request-target): ${c.req.method.toLowerCase()} ${url.pathname}`);
    } else {
      const headerValue = c.req.header(headerName);
      if (!headerValue) {
        return { valid: false, error: `Missing required header: ${headerName}` };
      }
      signatureParts.push(`${headerName}: ${headerValue}`);
    }
  }

  const signatureString = signatureParts.join('\n');

  // Verify digest if present
  if (parsed.headers.includes('digest')) {
    const digestHeader = c.req.header('digest');
    if (!digestHeader) {
      return { valid: false, error: 'Digest header missing but required by signature' };
    }

    // Calculate expected digest
    const bodyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const expectedDigest = `SHA-256=${btoa(String.fromCharCode(...new Uint8Array(bodyHash)))}`;

    if (digestHeader !== expectedDigest) {
      return { valid: false, error: 'Digest mismatch' };
    }
  }

  // Fetch public key
  const publicKeyPem = await fetchActorPublicKey(parsed.keyId, c);
  if (!publicKeyPem) {
    return { valid: false, error: 'Could not fetch public key' };
  }

  // Import public key and verify signature
  try {
    const pemContents = publicKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    const binaryKey = Uint8Array.from(atob(pemContents), ch => ch.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      binaryKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signatureBytes = Uint8Array.from(atob(parsed.signature), ch => ch.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureBytes,
      new TextEncoder().encode(signatureString)
    );

    if (!valid) {
      return { valid: false, error: 'Signature verification failed' };
    }

    return { valid: true, keyId: parsed.keyId };
  } catch (e) {
    console.error('[HTTP Signature] Verification error:', e);
    return { valid: false, error: 'Signature verification error' };
  }
}

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

ap.post('/ap/actor/inbox', async (c) => {
  const instanceActor = await getInstanceActor(c);
  const baseUrl = c.env.APP_URL;

  // Get raw body for signature verification
  const body = await c.req.text();

  // Verify HTTP signature
  const signatureResult = await verifyHttpSignature(c, body);
  if (!signatureResult.valid) {
    console.warn(`[ActivityPub] Signature verification failed: ${signatureResult.error}`);
    return c.json({ error: 'Signature verification failed' }, 401);
  }

  let activity: Activity;
  try {
    activity = JSON.parse(body) as Activity;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const activityId = typeof activity.id === 'string' ? activity.id : activityApId(baseUrl, generateId());
  const actor = typeof activity.actor === 'string' ? activity.actor : null;
  const activityType = typeof activity.type === 'string' ? activity.type : null;
  const activityObjectId = getActivityObjectId(activity);

  if (!actor || !activityType) {
    return c.json({ error: 'Invalid activity' }, 400);
  }

  // Verify that the signature's keyId matches the activity's actor
  // The keyId is typically in the format "https://example.com/users/name#main-key"
  const signingActorUrl = signatureResult.keyId?.includes('#')
    ? signatureResult.keyId.split('#')[0]
    : signatureResult.keyId;
  if (signingActorUrl !== actor) {
    console.warn(`[ActivityPub] Actor mismatch: activity actor ${actor} does not match signing key ${signingActorUrl}`);
    return c.json({ error: 'Actor mismatch' }, 401);
  }

  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
    VALUES (?, ?, ?, ?, ?, 'inbound')
  `).bind(activityId, activityType, actor, activityObjectId, JSON.stringify(activity)).run();

  switch (activityType) {
    case 'Follow':
      await handleGroupFollow(c, activity, instanceActor, actor, baseUrl, activityId);
      break;
    case 'Undo':
      await handleGroupUndo(c, activity, instanceActor);
      break;
    case 'Create':
      await handleGroupCreate(c, activity, instanceActor, actor, baseUrl);
      break;
    default:
      // Unhandled activity types are silently ignored
  }

  return c.json({ success: true });
});

// Inbox - Receive Activities
// ============================================================

ap.post('/ap/users/:username/inbox', async (c) => {
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  // Get the recipient actor
  const recipient = await c.env.DB.prepare(
    'SELECT ap_id, private_key_pem FROM actors WHERE ap_id = ?'
  ).bind(apId).first<Actor>();

  if (!recipient) return c.json({ error: 'Actor not found' }, 404);

  // Get raw body for signature verification
  const body = await c.req.text();

  // Verify HTTP signature
  const signatureResult = await verifyHttpSignature(c, body);
  if (!signatureResult.valid) {
    console.warn(`[ActivityPub] Signature verification failed for ${username}: ${signatureResult.error}`);
    return c.json({ error: 'Signature verification failed' }, 401);
  }

  let activity: Activity;
  try {
    activity = JSON.parse(body) as Activity;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const activityId = typeof activity.id === 'string' ? activity.id : activityApId(baseUrl, generateId());
  const actor = typeof activity.actor === 'string' ? activity.actor : null;
  const activityType = typeof activity.type === 'string' ? activity.type : null;
  const activityObjectId = getActivityObjectId(activity);

  if (!actor || !activityType) {
    return c.json({ error: 'Invalid activity' }, 400);
  }

  // Verify that the signature's keyId matches the activity's actor
  // The keyId is typically in the format "https://example.com/users/name#main-key"
  const signingActorUrl = signatureResult.keyId?.includes('#')
    ? signatureResult.keyId.split('#')[0]
    : signatureResult.keyId;
  if (signingActorUrl !== actor) {
    console.warn(`[ActivityPub] Actor mismatch: activity actor ${actor} does not match signing key ${signingActorUrl}`);
    return c.json({ error: 'Actor mismatch' }, 401);
  }

  // Store activity
  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
    VALUES (?, ?, ?, ?, ?, 'inbound')
  `).bind(activityId, activityType, actor, activityObjectId, JSON.stringify(activity)).run();

  // Cache remote actor if not already cached
  if (!isLocal(actor, baseUrl)) {
    const cached = await c.env.DB.prepare('SELECT ap_id FROM actor_cache WHERE ap_id = ?').bind(actor).first();
    if (!cached) {
      try {
        if (!isSafeRemoteUrl(actor)) {
          console.warn(`[ActivityPub] Blocked unsafe actor fetch: ${actor}`);
        } else {
          const res = await fetch(actor, {
            headers: { 'Accept': 'application/activity+json, application/ld+json' }
          });
          if (res.ok) {
            const actorData = await res.json() as RemoteActor;
            if (
              actorData?.id &&
              actorData?.inbox &&
              isSafeRemoteUrl(actorData.id) &&
              isSafeRemoteUrl(actorData.inbox)
            ) {
              await c.env.DB.prepare(`
                INSERT INTO actor_cache (ap_id, type, preferred_username, name, summary, icon_url, inbox, public_key_pem, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).bind(
                actorData.id,
                actorData.type,
                actorData.preferredUsername,
                actorData.name,
                actorData.summary,
                actorData.icon?.url,
                actorData.inbox,
                actorData.publicKey?.publicKeyPem,
                JSON.stringify(actorData)
              ).run();
            }
          }
        }
      } catch (e) {
        console.error('Failed to cache remote actor:', e);
      }
    }
  }

  // Handle different activity types
  switch (activityType) {
    case 'Follow':
      await handleFollow(c, activity, recipient, actor, baseUrl);
      break;
    case 'Accept':
      await handleAccept(c, activity);
      break;
    case 'Undo':
      await handleUndo(c, activity, recipient, actor, baseUrl);
      break;
    case 'Like':
      await handleLike(c, activity, recipient, actor, baseUrl);
      break;
    case 'Create':
      await handleCreate(c, activity, recipient, actor, baseUrl);
      break;
    case 'Delete':
      await handleDelete(c, activity);
      break;
    case 'Announce':
      await handleAnnounce(c, activity, recipient, actor, baseUrl);
      break;
    case 'Update':
      await handleUpdate(c, activity, actor);
      break;
    case 'Reject':
      await handleReject(c, activity);
      break;
    case 'Add':
    case 'Remove':
    case 'Block':
    case 'Flag':
    case 'Move':
      // Known but unsupported activity types - silently acknowledge
      break;
    default:
      // Log unknown activity types for debugging (production: remove or use proper logging)
      if (activityType) {
        console.warn(`[ActivityPub] Unhandled activity type: ${activityType} from ${actor}`);
      }
  }

  return c.json({ success: true });
});

export default ap;
