import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../types';
import type { Actor as PrismaActor } from '../../../generated/prisma';
import { activityApId, actorApId, generateId, isLocal, isSafeRemoteUrl, fetchWithTimeout } from '../../utils';
import { getInstanceActor } from './utils';
import type { Activity, RemoteActor } from './inbox-types';
import { getActivityObjectId } from './inbox-types';
import { handleGroupCreate, handleGroupFollow, handleGroupUndo } from './handlers/actorInboxHandlers';
import {
  handleAccept,
  handleAdd,
  handleAnnounce,
  handleBlock,
  handleCreate,
  handleDelete,
  handleFlag,
  handleFollow,
  handleMove,
  handleLike,
  handleRemove,
  handleReject,
  handleUndo,
  handleUpdate,
} from './handlers/userInboxHandlers';

type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

// Maximum allowed clock skew for HTTP signature validation (5 minutes)
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 512 * 1024;

// ---------------------------------------------------------------------------
// Signature parsing & verification
// ---------------------------------------------------------------------------

function parseSignatureHeader(signatureHeader: string): {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
} | null {
  const params: Record<string, string> = {};
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

async function fetchActorPublicKey(keyId: string, c: HonoContext): Promise<string | null> {
  if (!isSafeRemoteUrl(keyId)) {
    console.warn(`[HTTP Signature] Blocked unsafe keyId URL: ${keyId}`);
    return null;
  }

  const prisma = c.get('prisma');
  const actorUrl = keyId.includes('#') ? keyId.split('#')[0] : keyId;

  const cached = await prisma.actorCache.findUnique({
    where: { apId: actorUrl },
    select: { publicKeyPem: true },
  });

  if (cached?.publicKeyPem) {
    return cached.publicKeyPem;
  }

  try {
    const res = await fetchWithTimeout(actorUrl, {
      headers: { 'Accept': 'application/activity+json, application/ld+json' },
      timeout: 15000,
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

    // actorData.publicKey.publicKeyPem is guaranteed non-null by the guard above
    const narrowed = actorData as RemoteActor & { inbox: string; publicKey: { publicKeyPem: string } };

    if (actorData.id && actorData.inbox && isSafeRemoteUrl(actorData.id) && isSafeRemoteUrl(actorData.inbox)) {
      const cacheFields = buildActorCacheFields(narrowed);
      await prisma.actorCache.upsert({
        where: { apId: actorData.id },
        update: cacheFields,
        create: { apId: actorData.id, ...cacheFields },
      });
    }

    return narrowed.publicKey.publicKeyPem;
  } catch (e) {
    console.error(`[HTTP Signature] Error fetching actor:`, e);
    return null;
  }
}

async function verifyHttpSignature(
  c: HonoContext,
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

  if (!parsed.headers.includes('date')) {
    return { valid: false, error: 'date header must be included in signature' };
  }

  // Validate Date header timestamp (prevents replay attacks)
  const dateHeader = c.req.header('date');
  if (!dateHeader) {
    return { valid: false, error: 'Missing Date header required by signature' };
  }
  const requestDate = new Date(dateHeader);
  if (isNaN(requestDate.getTime())) {
    return { valid: false, error: 'Invalid Date header format' };
  }
  if (Math.abs(Date.now() - requestDate.getTime()) > MAX_SIGNATURE_AGE_MS) {
    return { valid: false, error: 'Request timestamp outside acceptable window' };
  }

  if (parsed.algorithm !== 'rsa-sha256') {
    return { valid: false, error: `Unsupported algorithm: ${parsed.algorithm}` };
  }

  if (!parsed.headers.includes('(request-target)')) {
    return { valid: false, error: '(request-target) must be signed' };
  }

  if (!parsed.headers.includes('digest')) {
    return { valid: false, error: 'digest header must be included in signature to ensure body integrity' };
  }

  // Build the signature string from headers
  const url = new URL(c.req.url);
  const signatureParts: string[] = [];

  for (const headerName of parsed.headers) {
    if (headerName === '(request-target)') {
      signatureParts.push(`(request-target): ${c.req.method.toLowerCase()} ${url.pathname}`);
      continue;
    }
    const headerValue = c.req.header(headerName);
    if (!headerValue) {
      return { valid: false, error: `Missing required header: ${headerName}` };
    }
    signatureParts.push(`${headerName}: ${headerValue}`);
  }

  const signatureString = signatureParts.join('\n');

  // Verify body digest
  const digestHeader = c.req.header('digest');
  if (!digestHeader) {
    return { valid: false, error: 'Digest header missing but required by signature' };
  }
  const bodyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const expectedDigest = `SHA-256=${btoa(String.fromCharCode(...new Uint8Array(bodyHash)))}`;
  if (digestHeader !== expectedDigest) {
    return { valid: false, error: 'Digest mismatch' };
  }

  // Fetch public key and verify
  const publicKeyPem = await fetchActorPublicKey(parsed.keyId, c);
  if (!publicKeyPem) {
    return { valid: false, error: 'Could not fetch public key' };
  }

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

// ---------------------------------------------------------------------------
// Shared inbox helpers
// ---------------------------------------------------------------------------

/**
 * Extract the actor URL from a keyId (strips the fragment, e.g. "#main-key").
 */
function signingActorFromKeyId(keyId: string | undefined): string | undefined {
  if (!keyId) return undefined;
  return keyId.includes('#') ? keyId.split('#')[0] : keyId;
}

/**
 * Returns true when the signing key and the activity actor belong to different
 * origins (domain-level key delegation is allowed).
 */
function isActorMismatch(signingActorUrl: string | undefined, actor: string): boolean {
  if (signingActorUrl === actor) return false;
  if (!signingActorUrl) return true;

  try {
    const signingDomain = new URL(signingActorUrl).hostname;
    const actorDomain = new URL(actor).hostname;
    if (signingDomain === actorDomain) {
      console.info(`[ActivityPub] Accepting key delegation: signing key ${signingActorUrl} for actor ${actor} (same domain: ${signingDomain})`);
      return false;
    }
  } catch {
    // Invalid URL, treat as mismatch
  }
  return true;
}

type ParsedActivity = {
  activity: Activity;
  activityId: string;
  actor: string;
  activityType: string;
  activityObjectId: string | null;
};

/**
 * Shared pipeline for both inbox endpoints: size check, signature verification,
 * JSON parse, field extraction, and actor-mismatch check. Returns either a
 * parsed result or a Response that should be returned immediately.
 */
async function verifyAndParseInbox(c: HonoContext, baseUrl: string): Promise<ParsedActivity | Response> {
  const contentLength = parseInt(c.req.header('content-length') || '0');
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return c.json({ error: 'Payload too large' }, 413);
  }

  const body = await c.req.text();

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

  if (!actor || !activityType) {
    return c.json({ error: 'Invalid activity' }, 400);
  }

  const signingActor = signingActorFromKeyId(signatureResult.keyId);
  if (isActorMismatch(signingActor, actor)) {
    console.warn(`[ActivityPub] Actor mismatch: activity actor ${actor} does not match signing key ${signingActor}`);
    return c.json({ error: 'Actor mismatch' }, 401);
  }

  return {
    activity,
    activityId,
    actor,
    activityType,
    activityObjectId: getActivityObjectId(activity),
  };
}

/**
 * Check for duplicate activity. Returns true (and sends 202) when the activity
 * already exists; otherwise stores it and returns false.
 */
async function deduplicateAndStoreActivity(
  c: HonoContext,
  { activityId, activityType, actor, activityObjectId, activity }: ParsedActivity
): Promise<Response | null> {
  const prisma = c.get('prisma');
  const rawJson = JSON.stringify(activity);

  const existing = await prisma.activity.findUnique({
    where: { apId: activityId },
    select: { rawJson: true },
  });

  if (existing) {
    if (existing.rawJson !== rawJson) {
      console.warn(`[ActivityPub] Duplicate activity ${activityId} received with different content`);
    }
    return c.body(null, 202);
  }

  await prisma.activity.create({
    data: {
      apId: activityId,
      type: activityType,
      actorApId: actor,
      objectApId: activityObjectId,
      rawJson,
      direction: 'inbound',
    },
  });

  return null;
}

// ---------------------------------------------------------------------------
// Remote actor caching
// ---------------------------------------------------------------------------

function buildActorCacheFields(actorData: RemoteActor & { inbox: string; publicKey: { publicKeyPem: string } }) {
  return {
    type: actorData.type || 'Person',
    preferredUsername: actorData.preferredUsername,
    name: actorData.name,
    summary: actorData.summary,
    iconUrl: actorData.icon?.url,
    inbox: actorData.inbox,
    publicKeyPem: actorData.publicKey.publicKeyPem,
    rawJson: JSON.stringify(actorData),
  };
}

async function cacheRemoteActor(c: HonoContext, actorApIdUrl: string, baseUrl: string): Promise<void> {
  if (isLocal(actorApIdUrl, baseUrl)) return;

  const prisma = c.get('prisma');

  const cached = await prisma.actorCache.findUnique({
    where: { apId: actorApIdUrl },
    select: { apId: true },
  });
  if (cached) return;

  if (!isSafeRemoteUrl(actorApIdUrl)) {
    console.warn(`[ActivityPub] Blocked unsafe actor fetch: ${actorApIdUrl}`);
    return;
  }

  try {
    const res = await fetchWithTimeout(actorApIdUrl, {
      headers: { 'Accept': 'application/activity+json, application/ld+json' },
      timeout: 15000,
    });
    if (!res.ok) return;

    const actorData = await res.json() as RemoteActor;

    if (actorData?.id !== actorApIdUrl) {
      console.warn(`[ActivityPub] Actor ID mismatch: fetched ${actorApIdUrl} but got id ${actorData?.id}`);
      return;
    }
    if (!actorData?.publicKey?.publicKeyPem) {
      console.warn(`[ActivityPub] Skipping actor cache for ${actorApIdUrl}: missing public key`);
      return;
    }
    if (!actorData.id || !actorData.inbox || !isSafeRemoteUrl(actorData.id) || !isSafeRemoteUrl(actorData.inbox)) {
      return;
    }

    // publicKey.publicKeyPem and inbox are guaranteed by guards above
    const narrowed = actorData as RemoteActor & { inbox: string; publicKey: { publicKeyPem: string } };
    await prisma.actorCache.create({
      data: { apId: actorData.id, ...buildActorCacheFields(narrowed) },
    });
  } catch (e) {
    console.error('Failed to cache remote actor:', e);
  }
}

// ---------------------------------------------------------------------------
// User inbox activity dispatch
// ---------------------------------------------------------------------------

type UserInboxHandler = {
  recipient: PrismaActor;
  actor: string;
  baseUrl: string;
};

async function dispatchUserActivity(
  c: HonoContext,
  activityType: string,
  activity: Activity,
  { recipient, actor, baseUrl }: UserInboxHandler
): Promise<void> {
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
      await handleAdd(c, activity, recipient, actor);
      break;
    case 'Remove':
      await handleRemove(c, activity, recipient, actor);
      break;
    case 'Block':
      await handleBlock(c, activity, recipient, actor);
      break;
    case 'Flag':
      await handleFlag(c, activity, actor);
      break;
    case 'Move':
      await handleMove(c, activity, actor);
      break;
    default:
      console.warn(`[ActivityPub] Unhandled activity type: ${activityType} from ${actor}`);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

ap.post('/ap/actor/inbox', async (c) => {
  const instanceActor = await getInstanceActor(c);
  const baseUrl = c.env.APP_URL;

  const result = await verifyAndParseInbox(c, baseUrl);
  if (result instanceof Response) return result;

  const duplicate = await deduplicateAndStoreActivity(c, result);
  if (duplicate) return duplicate;

  const { activity, activityType, actor } = result;

  switch (activityType) {
    case 'Follow':
      await handleGroupFollow(c, activity, instanceActor, actor, baseUrl, result.activityId);
      break;
    case 'Undo':
      await handleGroupUndo(c, activity, instanceActor);
      break;
    case 'Create':
      await handleGroupCreate(c, activity, instanceActor, actor, baseUrl);
      break;
  }

  return c.body(null, 202);
});

ap.post('/ap/users/:username/inbox', async (c) => {
  const prisma = c.get('prisma');
  const username = c.req.param('username');
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);

  const recipient = await prisma.actor.findUnique({ where: { apId } });
  if (!recipient) return c.json({ error: 'Actor not found' }, 404);

  const result = await verifyAndParseInbox(c, baseUrl);
  if (result instanceof Response) return result;

  const duplicate = await deduplicateAndStoreActivity(c, result);
  if (duplicate) return duplicate;

  const { activity, activityType, actor } = result;

  await cacheRemoteActor(c, actor, baseUrl);

  await dispatchUserActivity(c, activityType, activity, { recipient, actor, baseUrl });

  return c.body(null, 202);
});

export default ap;
