import { Hono } from "hono";
import type { TakosApp, AppEnv } from "@takos/app-sdk/server";
import { json, error, parseBody, parseQuery } from "@takos/app-sdk/server";
import { canonicalizeParticipants, computeParticipantsHash } from "@takos/platform/activitypub/chat";
import {
  generateOrderedCollection,
  generateOrderedCollectionPage,
  generateGroupActor,
  generateNoteObject,
  generatePersonActor,
  generateWebFinger,
} from "@takos/platform/activitypub/activitypub";
import { applyFederationPolicy } from "@takos/platform/activitypub/federation-policy";

// Import helpers from utils
import {
  createSystemCtx,
  activityPubJson,
  activityPubError,
  isPublicOrUnlisted,
  verifyInboxDigest,
  verifyInboxDateHeader,
  resolveFederationPolicy,
  RATE_LIMIT_MAX_REQUESTS,
  checkInboxRateLimit,
  isActivityDuplicate,
  verifyInboxSignature,
} from "./utils";

// Import AI routes (App layer AI actions)
import aiRouter from "./ai/routes.js";

const router = new Hono<{ Bindings: AppEnv }>();

router.get("/health", (c) => c.text("ok"));

const readCoreData = async <T,>(res: Response): Promise<T> => {
  const payload = (await res.json().catch(() => null)) as any;
  if (payload && typeof payload === "object" && payload.ok === true && "data" in payload) {
    return payload.data as T;
  }
  return payload as T;
};

// Mount AI routes (App layer AI actions)
router.route("/", aiRouter);

router.get("/.well-known/webfinger", async (c) => {
  const url = new URL(c.req.url);
  const resource = url.searchParams.get("resource")?.trim() ?? "";
  if (!resource) return error("Missing resource", 400);

  const domain = (c.env.instance.domain || url.host || "").toString().trim();
  const protocol = url.protocol.replace(":", "") || "https";

  const parseAcct = (acct: string): { handle: string; domain: string } | null => {
    const normalized = acct.startsWith("acct:") ? acct.slice("acct:".length) : acct;
    const parts = normalized.split("@").filter(Boolean);
    if (parts.length !== 2) return null;
    const handle = parts[0].replace(/^@+/, "").trim();
    const acctDomain = parts[1].trim();
    if (!handle || !acctDomain) return null;
    return { handle, domain: acctDomain };
  };

  let handle: string | null = null;
  const acct = resource.startsWith("acct:") ? parseAcct(resource) : null;
  if (acct) {
    if (acct.domain !== domain) return error("Not found", 404);
    handle = acct.handle;
  } else if (resource.startsWith("http://") || resource.startsWith("https://")) {
    try {
      const asUrl = new URL(resource);
      const match = asUrl.pathname.match(/^\/ap\/users\/([^/]+)(?:\/|$)/);
      if (match?.[1]) handle = match[1];
    } catch {
      // ignore
    }
  }

  if (!handle) return error("Invalid resource format", 400);
  if (typeof c.env.fetch !== "function") return error("Core fetch unavailable", 503);
  const userRes = await c.env.fetch(`/users/${encodeURIComponent(handle)}`);
  if (!userRes.ok) return error("Not found", userRes.status === 404 ? 404 : 503);
  const actor = await readCoreData<any>(userRes);
  if (!actor) return error("Not found", 404);

  const webfinger = generateWebFinger(handle, domain, protocol);
  const res = json(webfinger);
  res.headers.set("Content-Type", "application/jrd+json");
  res.headers.set("Cache-Control", "public, max-age=300, immutable");
  return res;
});

router.get("/.well-known/nodeinfo", (c) => {
  const url = new URL(c.req.url);
  const domain = (c.env.instance.domain || url.host || "").toString().trim();
  const protocol = url.protocol.replace(":", "") || "https";
  const baseUrl = `${protocol}://${domain}`;

  const res = json({
    links: [
      {
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.0",
        href: `${baseUrl}/nodeinfo/2.0`,
      },
    ],
  });
  res.headers.set("Content-Type", "application/json; charset=utf-8");
  res.headers.set("Cache-Control", "max-age=3600");
  return res;
});

router.get("/nodeinfo/2.0", async (c) => {
  let userCount = 0;
  let localPosts = 0;
  try {
    try {
      if (typeof c.env.fetch === "function") {
        const usersRes = await c.env.fetch("/users");
        if (usersRes.ok) {
          const data = await readCoreData<any>(usersRes);
          userCount = Number(data?.total ?? 0);
        }
        const objectsRes = await c.env.fetch("/objects");
        if (objectsRes.ok) {
          const data = await readCoreData<any>(objectsRes);
          localPosts = Number(data?.total ?? 0);
        }
      }
    } catch {
      // ignore
    }
    if (!Number.isFinite(userCount)) userCount = 0;
    if (!Number.isFinite(localPosts)) localPosts = 0;

    const openRegistrations = c.env.instance.openRegistrations;
    const nodeName = c.env.instance.name;
    const nodeDescription = c.env.instance.description;

    const res = json({
      version: "2.0",
      software: {
        name: "takos",
        version: "0.1.0",
      },
      protocols: ["activitypub"],
      services: {
        inbound: [],
        outbound: [],
      },
      openRegistrations,
      usage: {
        users: {
          total: userCount,
        },
        localPosts,
      },
      metadata: {
        nodeName,
        nodeDescription,
      },
    });
    res.headers.set("Content-Type", "application/json; charset=utf-8");
    res.headers.set("Cache-Control", "max-age=3600");
    return res;
  } catch (error) {
    console.warn("[default-app] nodeinfo generation failed", error);
    return error("Failed to generate nodeinfo", 500);
  }
});

router.get("/ap/users/:handle", async (c) => {
  const handle = c.req.param("handle");
  const accept = c.req.header("accept") || c.req.header("Accept") || "";
  const isActivityPub = accept.includes("application/activity+json") || accept.includes("application/ld+json");
  if (!isActivityPub) {
    return c.redirect(`/@${handle}`);
  }

  const url = new URL(c.req.url);
  const domain = (c.env.instance.domain || url.host || "").toString().trim();
  const protocol = url.protocol.replace(":", "") || "https";

  if (typeof c.env.fetch !== "function") return error("Core fetch unavailable", 503);
  const userRes = await c.env.fetch(`/users/${encodeURIComponent(handle)}`);
  if (!userRes.ok) return error("Not found", userRes.status === 404 ? 404 : 503);
  const actorProfile = await readCoreData<any>(userRes);
  if (!actorProfile) return error("Not found", 404);

  const publicKeyPem: string | undefined = undefined;
  const actor = generatePersonActor(actorProfile, domain, protocol, publicKeyPem);
  const res = json(actor);
  res.headers.set("Content-Type", "application/activity+json; charset=utf-8");
  return res;
});

router.get("/ap/users/:handle/outbox", async (c) => {
  const handle = c.req.param("handle");
  const url = new URL(c.req.url);
  const domain = (c.env.instance.domain || url.host || "").toString().trim();
  const protocol = url.protocol.replace(":", "") || "https";
  const outboxUrl = `${protocol}://${domain}/ap/users/${handle}/outbox`;
  const query = parseQuery(c.req.raw);
  const pageRaw = query.page;

  if (typeof c.env.fetch !== "function") return activityPubError("Core fetch unavailable", 503);
  const userRes = await c.env.fetch(`/users/${encodeURIComponent(handle)}`);
  if (!userRes.ok) return activityPubError("Not found", 404);
  const actor = await readCoreData<any>(userRes);
  const actorId = actor?.id ?? handle;

  const limit = 20;
  const maxPage = 1000;
  const pageNum = pageRaw ? Math.max(1, Math.min(maxPage, parseInt(pageRaw, 10) || 1)) : 0;
  const offset = pageNum > 0 ? (pageNum - 1) * limit : 0;
  const visibility = "public,unlisted";

  const objectsUrl = new URL("/objects", `${protocol}://${domain}`);
  objectsUrl.searchParams.set("actor", String(actorId));
  objectsUrl.searchParams.set("visibility", visibility);
  objectsUrl.searchParams.set("limit", String(pageNum > 0 ? limit : 1));
  objectsUrl.searchParams.set("offset", String(offset));

  const objectsRes = await c.env.fetch(objectsUrl.pathname + objectsUrl.search);
  if (!objectsRes.ok) return activityPubError("Failed to load outbox", 500);
  const objectsPayload = await readCoreData<any>(objectsRes);
  const items = Array.isArray(objectsPayload?.items) ? objectsPayload.items : [];
  const totalItems = Number(objectsPayload?.total ?? items.length) || 0;

  if (!pageRaw) {
    const collection = generateOrderedCollection(outboxUrl, totalItems, `${outboxUrl}?page=1`);
    const res = json(collection);
    res.headers.set("Content-Type", "application/activity+json; charset=utf-8");
    return res;
  }

  const orderedItems = items
    .filter((obj: any) => isPublicOrUnlisted(obj))
    .map((obj: any) => generateNoteObject(obj, { id: actorId }, domain, protocol));

  const collectionPage = generateOrderedCollectionPage(
    `${outboxUrl}?page=${pageNum}`,
    outboxUrl,
    orderedItems,
    totalItems,
    offset,
    orderedItems.length === limit ? `${outboxUrl}?page=${pageNum + 1}` : undefined,
    pageNum > 1 ? `${outboxUrl}?page=${pageNum - 1}` : undefined,
  );
  const res = json(collectionPage);
  res.headers.set("Content-Type", "application/activity+json; charset=utf-8");
  return res;
});

router.post("/ap/inbox", async (c) => {
  const bodyText = await c.req.text();
  let activity: any;
  try {
    activity = JSON.parse(bodyText);
  } catch {
    return activityPubError("invalid JSON", 400);
  }

  const actorId = typeof activity?.actor === "string" ? activity.actor : activity?.actor?.id;
  if (!actorId) return activityPubError("missing actor", 400);

  if (isActivityDuplicate(activity.id)) {
    return activityPubJson({}, 202);
  }

  const rateLimit = checkInboxRateLimit(actorId);
  if (!rateLimit.allowed) {
    const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
    const res = activityPubError("rate limit exceeded", 429);
    res.headers.set("Retry-After", String(retryAfter));
    res.headers.set("X-RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
    res.headers.set("X-RateLimit-Remaining", "0");
    res.headers.set("X-RateLimit-Reset", String(Math.floor(rateLimit.resetAt / 1000)));
    return res;
  }

  const federationDecision = applyFederationPolicy(actorId, resolveFederationPolicy(c.env));
  if (!federationDecision.allowed) return activityPubError("federation blocked", 403);

  if (!verifyInboxDateHeader(c.req.header("date") ?? c.req.header("Date") ?? null)) {
    return activityPubError("invalid or missing Date header", 401);
  }

  const digestOk = await verifyInboxDigest(bodyText, c.req.header("digest") ?? c.req.header("Digest") ?? null);
  if (!digestOk) return activityPubError("digest verification failed", 403);

  const requestForSignature = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers: c.req.raw.headers,
    body: bodyText,
  });
  const signatureOk = await verifyInboxSignature(c.env, requestForSignature, actorId);
  if (!signatureOk) return activityPubError("signature verification failed", 403);

  const url = new URL(c.req.url);
  const instanceDomain = (c.env.instance.domain || url.host || "").toString().trim();
  const recipients = new Set<string>();

  const addToRecipients = (field: any) => {
    if (!field) return;
    const targets = Array.isArray(field) ? field : [field];
    for (const target of targets) {
      if (typeof target !== "string") continue;
      try {
        const parsed = new URL(target);
        if (parsed.hostname !== instanceDomain) continue;
        const match = parsed.pathname.match(/^\/ap\/users\/([a-z0-9_]{3,32})$/);
        if (match?.[1]) recipients.add(match[1]);
      } catch {
        // ignore
      }
    }
  };

  addToRecipients(activity.to);
  addToRecipients(activity.cc);
  addToRecipients(activity.audience);

  const activityId = activity.id || crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const ttlSeconds = 7 * 24 * 60 * 60;

  const enqueue = async (handle: string) => {
    const queueId = crypto.randomUUID();
    await c.env.storage.set(
      `ap:inbox:${handle}:${queueId}`,
      {
        queue_id: queueId,
        local_handle: handle,
        remote_actor_id: actorId,
        activity_id: activityId,
        activity_type: activity.type,
        activity_json: activity,
        created_at: createdAt,
        status: "pending",
      },
      { expirationTtl: ttlSeconds },
    );
  };

  if (recipients.size === 0) {
    const type = Array.isArray(activity.type) ? activity.type[0] : activity.type;
    const objectType = Array.isArray(activity.object?.type) ? activity.object.type[0] : activity.object?.type;
    const isPublic = (field: any) => {
      const list = Array.isArray(field) ? field : [field];
      return list.includes("https://www.w3.org/ns/activitystreams#Public");
    };

    if (type === "Create" && objectType === "Note" && (isPublic(activity.to) || isPublic(activity.cc) || isPublic(activity.audience))) {
      await enqueue("__public__").catch(() => {});
    }

    return activityPubJson({}, 202);
  }

  await Promise.all(Array.from(recipients).map((handle) => enqueue(handle).catch(() => {})));
  return activityPubJson({}, 202);
});

router.post("/ap/users/:handle/inbox", async (c) => {
  const handle = c.req.param("handle");
  if (typeof c.env.fetch !== "function") return activityPubError("Core fetch unavailable", 503);
  const userRes = await c.env.fetch(`/users/${encodeURIComponent(handle)}`);
  if (!userRes.ok) return activityPubError("user not found", 404);

  const bodyText = await c.req.text();
  let activity: any;
  try {
    activity = JSON.parse(bodyText);
  } catch {
    return activityPubError("invalid JSON", 400);
  }

  const actorId = typeof activity?.actor === "string" ? activity.actor : activity?.actor?.id;
  if (!actorId) return activityPubError("missing actor", 400);

  if (isActivityDuplicate(activity.id)) {
    return activityPubJson({}, 202);
  }

  const rateLimit = checkInboxRateLimit(actorId);
  if (!rateLimit.allowed) {
    const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
    const res = activityPubError("rate limit exceeded", 429);
    res.headers.set("Retry-After", String(retryAfter));
    res.headers.set("X-RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
    res.headers.set("X-RateLimit-Remaining", "0");
    res.headers.set("X-RateLimit-Reset", String(Math.floor(rateLimit.resetAt / 1000)));
    return res;
  }

  const federationDecision = applyFederationPolicy(actorId, resolveFederationPolicy(c.env));
  if (!federationDecision.allowed) return activityPubError("federation blocked", 403);

  if (!verifyInboxDateHeader(c.req.header("date") ?? c.req.header("Date") ?? null)) {
    return activityPubError("invalid or missing Date header", 401);
  }

  const digestOk = await verifyInboxDigest(bodyText, c.req.header("digest") ?? c.req.header("Digest") ?? null);
  if (!digestOk) return activityPubError("digest verification failed", 403);

  const requestForSignature = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers: c.req.raw.headers,
    body: bodyText,
  });
  const signatureOk = await verifyInboxSignature(c.env, requestForSignature, actorId);
  if (!signatureOk) return activityPubError("signature verification failed", 403);

  const activityId = activity.id || crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const ttlSeconds = 7 * 24 * 60 * 60;
  const queueId = crypto.randomUUID();

  await c.env.storage.set(
    `ap:inbox:${handle}:${queueId}`,
    {
      queue_id: queueId,
      local_handle: handle,
      remote_actor_id: actorId,
      activity_id: activityId,
      activity_type: activity.type,
      activity_json: activity,
      created_at: createdAt,
      status: "pending",
    },
    { expirationTtl: ttlSeconds },
  );

  return activityPubJson({}, 202);
});

router.get("/ap/objects/:id", async (c) => {
  const objectParam = c.req.param("id");
  const url = new URL(c.req.url);
  const domain = (c.env.instance.domain || url.host || "").toString().trim();
  const protocol = url.protocol.replace(":", "") || "https";
  if (typeof c.env.fetch !== "function") return activityPubError("Core fetch unavailable", 503);
  const objRes = await c.env.fetch(`/objects/${encodeURIComponent(objectParam)}`);
  if (!objRes.ok) return activityPubError("object not found", 404);
  const obj = await readCoreData<any>(objRes);
  if (!obj) return activityPubError("object not found", 404);

  const visibility = String(obj.visibility || "").toLowerCase();
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
  if ((visibility === "direct" || visibility === "private") && !authHeader) {
    return activityPubError("Forbidden", 403);
  }

  const content =
    typeof obj.content === "string"
      ? obj.content
      : typeof obj.text === "string"
        ? obj.text
        : "";
  const note = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: obj.type || "Note",
    id: `${protocol}://${domain}/ap/objects/${objectParam}`,
    attributedTo: obj.actor,
    content,
    published: obj.published ?? obj.created_at ?? undefined,
  };
  return activityPubJson(note);
});

router.get("/ap/users/:handle/followers", async (c) => {
  const handle = c.req.param("handle");
  const url = new URL(c.req.url);
  const domain = (c.env.instance.domain || url.host || "").toString().trim();
  const protocol = url.protocol.replace(":", "") || "https";
  const followersUrl = `${protocol}://${domain}/ap/users/${handle}/followers`;
  if (typeof c.env.fetch !== "function") return activityPubError("Core fetch unavailable", 503);

  const followersRes = await c.env.fetch(`/users/${encodeURIComponent(handle)}/followers`);
  if (!followersRes.ok) return activityPubError("Not found", 404);
  const followers = await readCoreData<any[]>(followersRes);
  const orderedItems = (followers || []).map((actor: any) =>
    actor?.handle ? `${protocol}://${domain}/ap/users/${actor.handle}` : actor?.id ?? null,
  ).filter(Boolean);
  return activityPubJson(generateOrderedCollection(followersUrl, orderedItems.length, `${followersUrl}?page=1`));
});

router.get("/ap/users/:handle/following", async (c) => {
  const handle = c.req.param("handle");
  const url = new URL(c.req.url);
  const domain = (c.env.instance.domain || url.host || "").toString().trim();
  const protocol = url.protocol.replace(":", "") || "https";
  const followingUrl = `${protocol}://${domain}/ap/users/${handle}/following`;
  if (typeof c.env.fetch !== "function") return activityPubError("Core fetch unavailable", 503);

  const followingRes = await c.env.fetch(`/users/${encodeURIComponent(handle)}/following`);
  if (!followingRes.ok) return activityPubError("Not found", 404);
  const following = await readCoreData<any[]>(followingRes);
  const orderedItems = (following || []).map((actor: any) =>
    actor?.handle ? `${protocol}://${domain}/ap/users/${actor.handle}` : actor?.id ?? null,
  ).filter(Boolean);
  return activityPubJson(generateOrderedCollection(followingUrl, orderedItems.length, `${followingUrl}?page=1`));
});

router.get("/ap/groups/:id", async (c) => {
  const accept = c.req.header("accept") || c.req.header("Accept") || "";
  const isActivityPub = accept.includes("application/activity+json") || accept.includes("application/ld+json");
  if (!isActivityPub) return c.redirect(`/communities/${c.req.param("id")}`);

  const id = c.req.param("id");
  const url = new URL(c.req.url);
  const domain = (c.env.instance.domain || url.host || "").toString().trim();
  const protocol = url.protocol.replace(":", "") || "https";
  if (typeof c.env.fetch !== "function") return activityPubError("Core fetch unavailable", 503);

  const communityRes = await c.env.fetch(`/communities/${encodeURIComponent(id)}`);
  if (!communityRes.ok) return activityPubError("community not found", 404);
  const community = await readCoreData<any>(communityRes);
  if (!community) return activityPubError("community not found", 404);

  const ownerHandle =
    community.owner_id ||
    community.created_by ||
    (community as any).createdBy ||
    (community as any).ownerId ||
    id;

  const groupActor = generateGroupActor(community, ownerHandle, domain, protocol);
  return activityPubJson(groupActor);
});

const parsePagination = (query: Record<string, string>, defaults = { limit: 20, offset: 0 }) => {
  const limit = Math.min(
    100,
    Math.max(1, parseInt(query.limit || `${defaults.limit}`, 10)),
  );
  const offset = Math.max(0, parseInt(query.offset || `${defaults.offset}`, 10));
  const cursor = query.cursor || (offset ? String(offset) : undefined);
  return { limit, offset, cursor };
};

const blockListKey = (userId: string) => `block:${userId}:list`;
const muteListKey = (userId: string) => `mute:${userId}:list`;

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : String(item).trim())).filter(Boolean);
};

const loadAppList = async (env: AppEnv, key: string): Promise<string[]> => {
  const value = await env.storage.get<unknown>(key);
  return normalizeStringList(value);
};

const saveAppList = async (env: AppEnv, key: string, ids: string[]): Promise<void> => {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const entry of ids) {
    const normalized = (entry || "").toString().trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  await env.storage.set(key, unique);
};

type CommunitySettings = {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  icon?: string;
  visibility: "public" | "private";
  owner_id: string;
  created_at: string;
  members_count: number;
};

type CommunityMember = {
  user_id: string;
  role: "owner" | "moderator" | "member";
  joined_at: string;
  status?: "active" | "pending";
  nickname?: string;
};

type CommunityChannel = {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  order: number;
  created_at: string;
};

type CommunityChannels = { channels: CommunityChannel[] };

type CommunityRoles = {
  roles: Array<{
    id: string;
    name: string;
    permissions: string[];
    color?: string;
  }>;
};

const COMMUNITY_INDEX_KEY = "community:index";

const communitySettingsKey = (communityId: string) => `community:${communityId}:settings`;
const communityChannelsKey = (communityId: string) => `community:${communityId}:channels`;
const communityRolesKey = (communityId: string) => `community:${communityId}:roles`;
const communityMemberKey = (communityId: string, userId: string) => `community:${communityId}:members:${userId}`;
const communityMembershipIndexKey = (userId: string) => `community:user:${userId}:memberships`;
const communityChannelMessagesKey = (communityId: string, channelId: string) =>
  `community:${communityId}:channels:${channelId}:messages`;

const loadCommunityIndex = async (env: AppEnv): Promise<string[]> => {
  const value = await env.storage.get<unknown>(COMMUNITY_INDEX_KEY);
  const ids = normalizeStringList(value);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  return unique;
};

const saveCommunityIndex = async (env: AppEnv, ids: string[]): Promise<void> => {
  await env.storage.set(COMMUNITY_INDEX_KEY, ids);
};

const slugify = (input: string): string => {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
};

const ensureAuthUserId = (env: AppEnv): string => {
  if (!env.auth?.userId) throw new Error("Unauthorized");
  return env.auth.userId;
};

const loadCommunitySettings = async (env: AppEnv, communityId: string): Promise<CommunitySettings | null> => {
  const settings = await env.storage.get<CommunitySettings>(communitySettingsKey(communityId));
  return settings ?? null;
};

const loadCommunityChannels = async (env: AppEnv, communityId: string): Promise<CommunityChannels> => {
  const stored = await env.storage.get<CommunityChannels>(communityChannelsKey(communityId));
  if (stored && Array.isArray((stored as any).channels)) return stored;
  return { channels: [] };
};

const saveCommunityChannels = async (env: AppEnv, communityId: string, channels: CommunityChannels): Promise<void> => {
  await env.storage.set(communityChannelsKey(communityId), channels);
};

const loadCommunityMember = async (
  env: AppEnv,
  communityId: string,
  userId: string,
): Promise<CommunityMember | null> => {
  const member = await env.storage.get<CommunityMember>(communityMemberKey(communityId, userId));
  return member ?? null;
};

const requireCommunityRole = async (
  env: AppEnv,
  communityId: string,
  allowed: Array<CommunityMember["role"]>,
): Promise<CommunityMember> => {
  const userId = ensureAuthUserId(env);
  const member = await loadCommunityMember(env, communityId, userId);
  if (!member) throw new Error("Forbidden");
  if (!allowed.includes(member.role)) throw new Error("Forbidden");
  return member;
};

const addMembershipIndex = async (env: AppEnv, userId: string, communityId: string): Promise<void> => {
  const existing = await env.storage.get<unknown>(communityMembershipIndexKey(userId));
  const ids = normalizeStringList(existing);
  if (!ids.includes(communityId)) {
    ids.push(communityId);
    await env.storage.set(communityMembershipIndexKey(userId), ids);
  }
};

const removeMembershipIndex = async (env: AppEnv, userId: string, communityId: string): Promise<void> => {
  const existing = await env.storage.get<unknown>(communityMembershipIndexKey(userId));
  const ids = normalizeStringList(existing).filter((id) => id !== communityId);
  await env.storage.set(communityMembershipIndexKey(userId), ids);
};

const toList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((v) => v?.toString?.() ?? "").filter(Boolean);
  if (typeof value === "string") return [value];
  if (value === null || value === undefined) return [];
  return [String(value)];
};

type DmThread = {
  id: string;
  participants: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastMessageId?: string;
};

type DmThreadRef = { threadId: string; updatedAt: string };

type DmReadState = { messageId?: string; readAt: string };

const dmThreadKey = (threadId: string) => `dm:thread:${threadId}`;
const dmUserThreadsKey = (userId: string) => `dm:user:${userId}:threads`;
const dmReadKey = (threadId: string) => `dm:read:${threadId}`;

const getThreadContextId = (threadId: string) => `dm:${threadId}`;

const normalizeThreadIdFromContext = (context: unknown): string => {
  if (typeof context !== "string") return "";
  return context.startsWith("dm:") ? context.slice(3) : context;
};

const parseMaybeJson = <T,>(value: unknown): T | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
};

const loadDmThreadRefs = async (env: AppEnv, userId: string): Promise<DmThreadRef[]> => {
  const raw = await env.storage.get<unknown>(dmUserThreadsKey(userId));
  const parsed = parseMaybeJson<any>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry: any) => ({
      threadId: String(entry?.threadId ?? entry?.thread_id ?? ""),
      updatedAt: String(entry?.updatedAt ?? entry?.updated_at ?? ""),
    }))
    .filter((entry) => entry.threadId && entry.updatedAt);
};

const saveDmThreadRefs = async (env: AppEnv, userId: string, refs: DmThreadRef[]) => {
  await env.storage.set(dmUserThreadsKey(userId), refs);
};

const bumpDmThreadRef = async (env: AppEnv, userId: string, threadId: string, updatedAt: string) => {
  const existing = await loadDmThreadRefs(env, userId);
  const filtered = existing.filter((t) => t.threadId !== threadId);
  filtered.unshift({ threadId, updatedAt });
  await saveDmThreadRefs(env, userId, filtered);
};

const loadDmThread = async (env: AppEnv, threadId: string): Promise<DmThread | null> => {
  const raw = await env.storage.get<unknown>(dmThreadKey(threadId));
  const parsed = parseMaybeJson<any>(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const participants = Array.isArray(parsed.participants) ? parsed.participants.map(String).filter(Boolean) : [];
  if (participants.length < 2) return null;
  const createdAt = String(parsed.createdAt ?? parsed.created_at ?? "");
  const updatedAt = String(parsed.updatedAt ?? parsed.updated_at ?? "");
  const createdBy = String(parsed.createdBy ?? parsed.created_by ?? "");
  if (!createdAt || !updatedAt || !createdBy) return null;
  return {
    id: String(parsed.id ?? threadId),
    participants: canonicalizeParticipants(participants),
    createdBy,
    createdAt,
    updatedAt,
    lastMessageId: parsed.lastMessageId ? String(parsed.lastMessageId) : undefined,
  };
};

const saveDmThread = async (env: AppEnv, thread: DmThread): Promise<void> => {
  await env.storage.set(dmThreadKey(thread.id), thread);
};

const fetchThreadObjects = async (env: AppEnv, threadId: string): Promise<any[]> => {
  const [primary, fallback] = await Promise.all([
    env.fetch(`/objects/thread/${encodeURIComponent(getThreadContextId(threadId))}`),
    env.fetch(`/objects/thread/${encodeURIComponent(threadId)}`),
  ]);

  const primaryItems = primary.ok ? await readCoreData<any[]>(primary) : [];
  const fallbackItems = fallback.ok ? await readCoreData<any[]>(fallback) : [];

  if (!primaryItems.length) return fallbackItems;
  if (!fallbackItems.length) return primaryItems;

  const seen = new Set<string>();
  const combined: any[] = [];
  for (const item of [...fallbackItems, ...primaryItems]) {
    const id = String(item?.local_id ?? item?.id ?? "");
    const key = id || JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(item);
  }
  combined.sort((a, b) => String(a?.published ?? "").localeCompare(String(b?.published ?? "")));
  return combined;
};

const resolveParticipantId = async (env: AppEnv, identifier: string): Promise<string> => {
  const trimmed = identifier.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) return trimmed;
  const res = await env.fetch(`/users/${encodeURIComponent(trimmed)}`);
  if (!res.ok) return trimmed;
  const user = await readCoreData<any>(res);
  return String(user?.id ?? trimmed);
};

const participantsFromObject = (obj: any): string[] => {
  const declared = toList(obj["takos:participants"]);
  const all = [
    obj.actor,
    ...toList(obj.to),
    ...toList(obj.cc),
    ...toList(obj.bto),
    ...toList(obj.bcc),
    ...declared,
  ].filter(Boolean);
  return canonicalizeParticipants(all);
};

const threadFromObject = (obj: any): { participants: string[]; threadId: string } => {
  const participants = participantsFromObject(obj);
  const threadId = normalizeThreadIdFromContext(obj.context) || computeParticipantsHash(participants);
  return { participants, threadId };
};

const filterMessagesForUser = (objectsInThread: any[], userId: string): any[] => {
  return objectsInThread.filter((obj) => {
    const participants = participantsFromObject(obj);
    if (!participants.includes(userId)) return false;
    const draft = Boolean(obj["takos:draft"] ?? obj.draft);
    if (draft && obj.actor !== userId) return false;
    const recipients = new Set([
      ...toList(obj.to),
      ...toList(obj.bto),
      ...toList(obj.bcc),
      obj.actor,
    ]);
    return recipients.has(userId) || obj.actor === userId;
  });
};

const toDmMessage = (obj: any) => {
  const { threadId } = threadFromObject(obj);
  return {
    id: obj.local_id ?? obj.id ?? "",
    thread_id: threadId,
    sender_actor_uri: obj.actor,
    content: obj.content ?? "",
    created_at: obj.published ?? new Date().toISOString(),
    media: (obj.attachment || []).map((att: any) => ({
      id: att.url,
      url: att.url,
      type: att.type || "Document",
    })),
    in_reply_to: obj.inReplyTo ?? obj.in_reply_to ?? null,
    draft: Boolean(obj["takos:draft"] ?? obj.draft ?? false),
  };
};

router.get("/timeline/home", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const query = parseQuery(c.req.raw);
  const { limit, cursor } = parsePagination(query, { limit: 50, offset: 0 });

  const followingUrl = new URL("/users/me/following", c.req.url);
  followingUrl.searchParams.set("limit", "1000");
  followingUrl.searchParams.set("offset", "0");
  const followingRes = await c.env.fetch(followingUrl.pathname + followingUrl.search);
  if (!followingRes.ok) return error("Failed to load following list", followingRes.status);
  const following = await readCoreData<any[]>(followingRes);
  const actorIds = new Set<string>([c.env.auth.userId]);
  for (const entry of following || []) {
    const id = (entry?.id ?? entry?.user_id ?? entry?.actor_id ?? "").toString().trim();
    if (id) actorIds.add(id);
  }

  const blockedIds = await loadAppList(c.env, blockListKey(c.env.auth.userId));
  const mutedIds = await loadAppList(c.env, muteListKey(c.env.auth.userId));
  const excluded = new Set([...blockedIds, ...mutedIds]);
  excluded.delete(c.env.auth.userId);
  for (const id of excluded) {
    actorIds.delete(id);
  }

  const url = new URL("/objects/timeline", c.req.url);
  url.searchParams.set("types", "Note,Article,Question");
  url.searchParams.set("visibility", "public,unlisted,followers,community");
  url.searchParams.set("actors", Array.from(actorIds).join(","));
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await c.env.fetch(url.pathname + url.search);
  if (!res.ok) return error("Failed to load timeline", res.status);
  const page = await readCoreData<any>(res);
  return json(page);
});

router.get("/blocks", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const ids = await loadAppList(c.env, blockListKey(c.env.auth.userId));
  return json({ ids });
});

router.post("/blocks", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const targetId = String(body.targetId ?? body.target_id ?? "").trim();
  if (!targetId) return error("targetId is required", 400);
  if (targetId === c.env.auth.userId) return error("Cannot block yourself", 400);

  const ids = await loadAppList(c.env, blockListKey(c.env.auth.userId));
  if (!ids.includes(targetId)) {
    ids.push(targetId);
    await saveAppList(c.env, blockListKey(c.env.auth.userId), ids);
  }

  // Create Block object via Core ObjectService for ActivityPub federation
  // Core will handle delivering Block activity to remote instance
  try {
    await c.env.fetch("/-/api/objects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "Block",
        object: targetId,
        visibility: "direct",
        to: [targetId],
      }),
    });
  } catch (err) {
    // Log but don't fail - KV is the source of truth for UI filtering
    console.warn("Failed to create Block object for ActivityPub:", err);
  }

  return json({ ids });
});

router.delete("/blocks/:targetId", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const targetId = c.req.param("targetId");
  const ids = await loadAppList(c.env, blockListKey(c.env.auth.userId));
  const next = ids.filter((id) => id !== targetId);
  await saveAppList(c.env, blockListKey(c.env.auth.userId), next);

  // Find and delete Block object (Core will send Undo Block activity)
  try {
    // Query for Block objects targeting this user
    const res = await c.env.fetch(`/-/api/objects?type=Block&limit=50`);
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as any;
      const objects = data?.data?.items ?? data?.items ?? [];
      for (const obj of objects) {
        if (obj.object === targetId || obj["takos:object"] === targetId) {
          // Delete the Block object - Core handles Undo activity
          await c.env.fetch(`/-/api/objects/${encodeURIComponent(obj.id)}`, {
            method: "DELETE",
          });
          break;
        }
      }
    }
  } catch (err) {
    console.warn("Failed to delete Block object:", err);
  }

  return json({ ids: next });
});

router.get("/mutes", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const ids = await loadAppList(c.env, muteListKey(c.env.auth.userId));
  return json({ ids });
});

router.post("/mutes", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const targetId = String(body.targetId ?? body.target_id ?? "").trim();
  if (!targetId) return error("targetId is required", 400);
  if (targetId === c.env.auth.userId) return error("Cannot mute yourself", 400);
  const ids = await loadAppList(c.env, muteListKey(c.env.auth.userId));
  if (!ids.includes(targetId)) {
    ids.push(targetId);
    await saveAppList(c.env, muteListKey(c.env.auth.userId), ids);
  }
  return json({ ids });
});

router.delete("/mutes/:targetId", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const targetId = c.req.param("targetId");
  const ids = await loadAppList(c.env, muteListKey(c.env.auth.userId));
  const next = ids.filter((id) => id !== targetId);
  await saveAppList(c.env, muteListKey(c.env.auth.userId), next);
  return json({ ids: next });
});

router.get("/communities", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const query = parseQuery(c.req.raw);
  const { limit, offset } = parsePagination(query, { limit: 20, offset: 0 });
  const q = String(query.q ?? "").trim().toLowerCase();
  const ids = await loadCommunityIndex(c.env);
  const settingsList: CommunitySettings[] = [];
  for (const id of ids) {
    const settings = await loadCommunitySettings(c.env, id);
    if (!settings) continue;
    if (q) {
      const hay = `${settings.name} ${settings.display_name} ${settings.description ?? ""}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    settingsList.push(settings);
  }
  const slice = settingsList.slice(offset, offset + limit);
  const communities = await Promise.all(
    slice.map(async (settings) => {
      const member = await loadCommunityMember(c.env, settings.id, c.env.auth!.userId).catch(() => null);
      return {
        id: settings.id,
        name: settings.name,
        display_name: settings.display_name,
        description: settings.description ?? "",
        icon: settings.icon,
        visibility: settings.visibility,
        owner_id: settings.owner_id,
        created_at: settings.created_at,
        members_count: settings.members_count,
        is_member: !!member,
        role: member?.role ?? null,
      };
    }),
  );
  return json({ communities, next_offset: communities.length < limit ? null : offset + communities.length });
});

router.post("/communities", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const rawName = String(body.name ?? body.id ?? "").trim();
  if (!rawName) return error("name is required", 400);
  const displayName = String(body.display_name ?? body.displayName ?? rawName).trim();
  const description = typeof body.description === "string" ? body.description : undefined;
  const icon = typeof body.icon_url === "string" ? body.icon_url : typeof body.icon === "string" ? body.icon : undefined;
  const visibility: "public" | "private" = body.visibility === "public" ? "public" : "private";

  const baseId = slugify(rawName) || crypto.randomUUID();
  let communityId = baseId;
  for (let i = 0; i < 5; i++) {
    const existing = await c.env.storage.get<unknown>(communitySettingsKey(communityId));
    if (!existing) break;
    communityId = `${baseId}-${crypto.randomUUID().slice(0, 6)}`;
  }
  const now = new Date().toISOString();
  const settings: CommunitySettings = {
    id: communityId,
    name: rawName,
    display_name: displayName,
    description,
    icon,
    visibility,
    owner_id: c.env.auth.userId,
    created_at: now,
    members_count: 1,
  };
  await c.env.storage.set(communitySettingsKey(communityId), settings);

  const defaultChannels: CommunityChannels = {
    channels: [
      {
        id: crypto.randomUUID(),
        name: "general",
        description: "General",
        isDefault: true,
        order: 0,
        created_at: now,
      },
    ],
  };
  await c.env.storage.set(communityChannelsKey(communityId), defaultChannels);

  const roles: CommunityRoles = {
    roles: [
      { id: "owner", name: "Owner", permissions: ["community.update", "channel.manage", "member.manage"] },
      { id: "moderator", name: "Moderator", permissions: ["channel.manage", "member.manage"] },
      { id: "member", name: "Member", permissions: [] },
    ],
  };
  await c.env.storage.set(communityRolesKey(communityId), roles);

  const member: CommunityMember = { user_id: c.env.auth.userId, role: "owner", joined_at: now, status: "active" };
  await c.env.storage.set(communityMemberKey(communityId, c.env.auth.userId), member);
  await addMembershipIndex(c.env, c.env.auth.userId, communityId);

  const ids = await loadCommunityIndex(c.env);
  if (!ids.includes(communityId)) {
    ids.unshift(communityId);
    await saveCommunityIndex(c.env, ids);
  }

  return json(
    {
      id: settings.id,
      name: settings.name,
      display_name: settings.display_name,
      description: settings.description ?? "",
      icon: settings.icon,
      visibility: settings.visibility,
      owner_id: settings.owner_id,
      created_at: settings.created_at,
      members_count: settings.members_count,
      is_member: true,
      role: "owner",
    },
    { status: 201 },
  );
});

router.get("/communities/:id", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const settings = await loadCommunitySettings(c.env, id);
  if (!settings) return error("community not found", 404);
  const member = await loadCommunityMember(c.env, id, c.env.auth.userId).catch(() => null);
  const membersKeys = await c.env.storage.list(`community:${id}:members:`);
  const members = await Promise.all(
    membersKeys.map(async (keySuffix) => {
      const userId = keySuffix.split(":").pop() ?? "";
      const m = await c.env.storage.get<CommunityMember>(communityMemberKey(id, userId));
      if (!m) return null;
      const userRes = await c.env.fetch(`/users/${encodeURIComponent(userId)}`).catch(() => null);
      const user = userRes && userRes.ok ? await readCoreData<any>(userRes) : null;
      return {
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        status: m.status ?? "active",
        nickname: m.nickname ?? null,
        user: user
          ? {
              id: user.id,
              display_name: user.display_name ?? user.name ?? "",
              avatar_url: user.avatar_url ?? user.avatar ?? undefined,
              handle: user.handle ?? user.id,
            }
          : { id: m.user_id },
      };
    }),
  );
  return json({
    id: settings.id,
    name: settings.name,
    display_name: settings.display_name,
    description: settings.description ?? "",
    icon: settings.icon,
    visibility: settings.visibility,
    owner_id: settings.owner_id,
    created_at: settings.created_at,
    members_count: settings.members_count,
    is_member: !!member,
    role: member?.role ?? null,
    members: members.filter(Boolean),
  });
});

router.patch("/communities/:id", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  await requireCommunityRole(c.env, id, ["owner"]);
  const settings = await loadCommunitySettings(c.env, id);
  if (!settings) return error("community not found", 404);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const next: CommunitySettings = {
    ...settings,
    display_name: typeof body.display_name === "string" ? body.display_name : settings.display_name,
    description: typeof body.description === "string" ? body.description : settings.description,
    icon:
      typeof body.icon_url === "string"
        ? body.icon_url
        : typeof body.icon === "string"
          ? body.icon
          : settings.icon,
    visibility:
      body.visibility === "public" ? "public" : body.visibility === "private" ? "private" : settings.visibility,
  };
  await c.env.storage.set(communitySettingsKey(id), next);
  const member = await loadCommunityMember(c.env, id, c.env.auth.userId).catch(() => null);
  return json({
    id: next.id,
    name: next.name,
    display_name: next.display_name,
    description: next.description ?? "",
    icon: next.icon,
    visibility: next.visibility,
    owner_id: next.owner_id,
    created_at: next.created_at,
    members_count: next.members_count,
    is_member: !!member,
    role: member?.role ?? null,
  });
});

router.get("/communities/:id/channels", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const settings = await loadCommunitySettings(c.env, id);
  if (!settings) return error("community not found", 404);
  const channels = await loadCommunityChannels(c.env, id);
  return json(
    channels.channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      description: ch.description ?? "",
      created_at: ch.created_at,
      is_default: ch.isDefault,
      order: ch.order,
    })),
  );
});

router.post("/communities/:id/channels", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const settings = await loadCommunitySettings(c.env, id);
  if (!settings) return error("community not found", 404);
  await requireCommunityRole(c.env, id, ["owner", "moderator"]);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return error("name is required", 400);
  const description = typeof body.description === "string" ? body.description : undefined;
  const channels = await loadCommunityChannels(c.env, id);
  const now = new Date().toISOString();
  const channel: CommunityChannel = {
    id: crypto.randomUUID(),
    name,
    description,
    isDefault: false,
    order: channels.channels.length ? Math.max(...channels.channels.map((c) => c.order)) + 1 : 1,
    created_at: now,
  };
  channels.channels.push(channel);
  await saveCommunityChannels(c.env, id, channels);
  return json(
    {
      id: channel.id,
      name: channel.name,
      description: channel.description ?? "",
      created_at: channel.created_at,
    },
    { status: 201 },
  );
});

router.patch("/communities/:id/channels/:channelId", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  await requireCommunityRole(c.env, id, ["owner", "moderator"]);
  const channels = await loadCommunityChannels(c.env, id);
  const channelId = c.req.param("channelId");
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const idx = channels.channels.findIndex((ch) => ch.id === channelId);
  if (idx < 0) return error("channel not found", 404);
  const existing = channels.channels[idx];
  const next: CommunityChannel = {
    ...existing,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name,
    description: typeof body.description === "string" ? body.description : existing.description,
  };
  channels.channels[idx] = next;
  await saveCommunityChannels(c.env, id, channels);
  return json({ id: next.id, name: next.name, description: next.description ?? "", created_at: next.created_at });
});

router.delete("/communities/:id/channels/:channelId", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  await requireCommunityRole(c.env, id, ["owner", "moderator"]);
  const channels = await loadCommunityChannels(c.env, id);
  const channelId = c.req.param("channelId");
  const target = channels.channels.find((ch) => ch.id === channelId);
  if (!target) return error("channel not found", 404);
  if (target.isDefault) return error("default channel cannot be deleted", 400);
  channels.channels = channels.channels.filter((ch) => ch.id !== channelId);
  await saveCommunityChannels(c.env, id, channels);
  return json({ deleted: true });
});

router.post("/communities/:id/join", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const settings = await loadCommunitySettings(c.env, id);
  if (!settings) return error("community not found", 404);
  const now = new Date().toISOString();
  const existing = await loadCommunityMember(c.env, id, c.env.auth.userId);
  if (!existing) {
    const member: CommunityMember = { user_id: c.env.auth.userId, role: "member", joined_at: now, status: "active" };
    await c.env.storage.set(communityMemberKey(id, c.env.auth.userId), member);
    await addMembershipIndex(c.env, c.env.auth.userId, id);
    await c.env.storage.set(communitySettingsKey(id), { ...settings, members_count: settings.members_count + 1 });
  }
  return json({ community_id: id, joined: true });
});

router.post("/communities/:id/leave", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const settings = await loadCommunitySettings(c.env, id);
  if (!settings) return error("community not found", 404);
  const existing = await loadCommunityMember(c.env, id, c.env.auth.userId);
  if (existing?.role === "owner") return error("owner cannot leave community", 400);
  if (existing) {
    await c.env.storage.delete(communityMemberKey(id, c.env.auth.userId));
    await removeMembershipIndex(c.env, c.env.auth.userId, id);
    const nextCount = Math.max(0, settings.members_count - 1);
    await c.env.storage.set(communitySettingsKey(id), { ...settings, members_count: nextCount });
  }
  return json({ community_id: id, left: true });
});

router.get("/communities/:id/members", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const settings = await loadCommunitySettings(c.env, id);
  if (!settings) return error("community not found", 404);
  const keys = await c.env.storage.list(`community:${id}:members:`);
  const members = await Promise.all(
    keys.map(async (suffix) => {
      const userId = suffix.split(":").pop() ?? "";
      const m = await loadCommunityMember(c.env, id, userId);
      if (!m) return null;
      const userRes = await c.env.fetch(`/users/${encodeURIComponent(userId)}`).catch(() => null);
      const user = userRes && userRes.ok ? await readCoreData<any>(userRes) : null;
      return {
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        status: m.status ?? "active",
        nickname: m.nickname ?? null,
        user: user
          ? {
              id: user.id,
              display_name: user.display_name ?? user.name ?? "",
              avatar_url: user.avatar_url ?? user.avatar ?? undefined,
              handle: user.handle ?? user.id,
            }
          : { id: m.user_id },
      };
    }),
  );
  return json(members.filter(Boolean));
});

router.post("/communities/:id/direct-invites", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  await requireCommunityRole(c.env, id, ["owner", "moderator"]);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const ids: string[] = Array.isArray(body.user_ids)
    ? body.user_ids
    : body.user_id
      ? [String(body.user_id)]
      : [];
  return json(ids.map((userId) => ({ id: userId, status: "sent" })), { status: 201 });
});

router.get("/me/communities", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const ids = await c.env.storage.get<unknown>(communityMembershipIndexKey(c.env.auth.userId));
  const memberships = normalizeStringList(ids);
  const communities = await Promise.all(
    memberships.map(async (communityId) => {
      const settings = await loadCommunitySettings(c.env, communityId);
      if (!settings) return null;
      const member = await loadCommunityMember(c.env, communityId, c.env.auth!.userId).catch(() => null);
      return {
        id: settings.id,
        name: settings.name,
        display_name: settings.display_name,
        description: settings.description ?? "",
        icon: settings.icon,
        visibility: settings.visibility,
        owner_id: settings.owner_id,
        created_at: settings.created_at,
        members_count: settings.members_count,
        is_member: !!member,
        role: member?.role ?? null,
      };
    }),
  );
  return json({ communities: communities.filter(Boolean) });
});

router.get("/communities/:id/channels/:channelId/messages", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const channelId = c.req.param("channelId");
  const query = parseQuery(c.req.raw);
  const { limit } = parsePagination(query, { limit: 50, offset: 0 });
  const stored = await c.env.storage.get<any>(communityChannelMessagesKey(id, channelId));
  const messages = Array.isArray(stored) ? stored : [];
  return json(messages.slice(-limit));
});

router.post("/communities/:id/channels/:channelId/messages", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const channelId = c.req.param("channelId");
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const content = String(body.content ?? "").trim();
  if (!content) return error("content is required", 400);
  const existing = await c.env.storage.get<any>(communityChannelMessagesKey(id, channelId));
  const messages = Array.isArray(existing) ? existing : [];
  const createdAt = new Date().toISOString();
  const message = {
    id: crypto.randomUUID(),
    community_id: id,
    channel_id: channelId,
    content,
    author_id: c.env.auth.userId,
    created_at: createdAt,
    in_reply_to: body.in_reply_to ?? body.inReplyTo ?? null,
  };
  messages.push(message);
  const next = messages.slice(-200);
  await c.env.storage.set(communityChannelMessagesKey(id, channelId), next);
  return json({ activity: message }, { status: 201 });
});

const migrateThreadsFromObjects = async (env: AppEnv, userId: string, limit: number) => {
  const url = new URL("/objects", "https://local.invalid");
  url.searchParams.set("visibility", "direct");
  url.searchParams.set("include_direct", "true");
  url.searchParams.set("participant", userId);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("cursor", "0");
  url.searchParams.set("order", "desc");
  const res = await env.fetch(url.pathname + url.search);
  if (!res.ok) return;

  const page = await readCoreData<any>(res);
  const contexts = new Map<string, any>();
  for (const item of page.items || []) {
    const { threadId, participants } = threadFromObject(item);
    if (!threadId || participants.length < 2) continue;
    const draft = Boolean(item["takos:draft"] ?? item.draft);
    if (draft && item.actor !== userId) continue;
    const existing = contexts.get(threadId);
    if (!existing || (existing.published || "").localeCompare(item.published || "") < 0) {
      contexts.set(threadId, item);
    }
  }

  const now = new Date().toISOString();
  const refs: DmThreadRef[] = [];
  for (const [threadId, obj] of contexts.entries()) {
    const { participants } = threadFromObject(obj);
    const existing = await loadDmThread(env, threadId);
    const createdAt = existing?.createdAt ?? now;
    const createdBy = existing?.createdBy ?? userId;
    const updatedAt = String(obj.published ?? now);
    const thread: DmThread = {
      id: threadId,
      participants,
      createdAt,
      createdBy,
      updatedAt,
      lastMessageId: obj.local_id ?? obj.id ?? undefined,
    };
    await saveDmThread(env, thread);
    refs.push({ threadId, updatedAt });
  }

  if (refs.length) {
    refs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await saveDmThreadRefs(env, userId, refs);
  }
};

// DM APIs implemented in App layer using /objects endpoints + App State (KV).
router.get("/dm/threads", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const userId = ensureAuthUserId(c.env);
  const query = parseQuery(c.req.raw);
  const { limit, offset } = parsePagination(query, { limit: 20, offset: 0 });

  let refs = await loadDmThreadRefs(c.env, userId);
  if (!refs.length) {
    await migrateThreadsFromObjects(c.env, userId, Math.max(1, (limit + offset) * 25));
    refs = await loadDmThreadRefs(c.env, userId);
  }

  refs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const slice = refs.slice(offset, offset + limit);

  const threads = [];
  for (const ref of slice) {
    const threadId = ref.threadId;
    const thread = await loadDmThread(c.env, threadId);
    const objects = await fetchThreadObjects(c.env, threadId);
    const visible = filterMessagesForUser(objects, userId);
    const latest = visible[visible.length - 1] ?? null;
    const readStateRaw = await c.env.storage.get<unknown>(dmReadKey(threadId));
    const readState = parseMaybeJson<DmReadState>(readStateRaw);
    const participants =
      thread?.participants?.length
        ? thread.participants
        : objects.length
          ? threadFromObject(objects[0]).participants
          : [];

    if (!thread && participants.length >= 2) {
      const now = new Date().toISOString();
      await saveDmThread(c.env, {
        id: threadId,
        participants,
        createdBy: userId,
        createdAt: now,
        updatedAt: ref.updatedAt || now,
        lastMessageId: latest ? String(latest.local_id ?? latest.id ?? "") || undefined : undefined,
      });
    }

    threads.push({
      id: threadId,
      participants,
      created_at: ref.updatedAt,
      latest_message: latest ? toDmMessage(latest) : null,
      read_at: readState?.readAt ?? null,
      read_message_id: readState?.messageId ?? null,
    });
  }

  return json({ threads, next_offset: threads.length < limit ? null : offset + threads.length });
});

router.get("/dm/threads/:threadId/messages", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const userId = ensureAuthUserId(c.env);
  const query = parseQuery(c.req.raw);
  const { limit, offset } = parsePagination(query, { limit: 50, offset: 0 });
  const threadId = c.req.param("threadId");
  const thread = await loadDmThread(c.env, threadId);
  if (thread && !thread.participants.includes(userId)) return error("Forbidden", 403);

  const messages = await fetchThreadObjects(c.env, threadId);
  if (!thread && messages.length) {
    const inferred = participantsFromObject(messages[0]);
    if (inferred.length && !inferred.includes(userId)) return error("Forbidden", 403);
  }
  if (!messages.length && !thread) return error("Thread not found", 404);

  const filtered = filterMessagesForUser(messages, userId);
  const sliced = filtered.slice(offset, offset + limit);
  return json({
    messages: sliced.map(toDmMessage),
    next_offset: sliced.length < limit ? null : offset + sliced.length,
  });
});

router.get("/dm/with/:handle", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const userId = ensureAuthUserId(c.env);
  const otherRaw = c.req.param("handle");
  const other = await resolveParticipantId(c.env, otherRaw);
  const participants = canonicalizeParticipants([other, userId].filter(Boolean));
  const threadId = computeParticipantsHash(participants);
  const now = new Date().toISOString();
  const existing = await loadDmThread(c.env, threadId);
  if (!existing) {
    await saveDmThread(c.env, {
      id: threadId,
      participants,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await bumpDmThreadRef(c.env, userId, threadId, now);
  }

  const messages = await fetchThreadObjects(c.env, threadId);
  const visible = filterMessagesForUser(messages, userId);
  return json({ threadId, participants, messages: visible.map(toDmMessage) });
});

router.post("/dm/send", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const userId = ensureAuthUserId(c.env);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const content = String(body.content ?? "").trim();
  if (!content) return error("content is required", 400);
  const threadIdParam = String(body.thread_id ?? body.threadId ?? "").trim() || undefined;
  const participantsRaw = Array.isArray(body.recipients)
    ? body.recipients
    : body.recipient
      ? [body.recipient]
      : Array.isArray(body.participants)
        ? body.participants
        : [];

  const resolvedParticipants = await Promise.all(
    participantsRaw.map((p: any) => resolveParticipantId(c.env, String(p ?? ""))),
  );
  const participants = canonicalizeParticipants([...resolvedParticipants, userId].filter(Boolean));
  if (participants.length < 2) return error("At least one other participant is required", 400);

  const threadId = threadIdParam || computeParticipantsHash(participants);
  const now = new Date().toISOString();

  const existingThread = await loadDmThread(c.env, threadId);
  const thread: DmThread = existingThread ?? {
    id: threadId,
    participants,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  if (!thread.participants.includes(userId)) return error("Forbidden", 403);

  const recipients = body.draft ? [userId] : thread.participants.filter((p) => p !== userId);
  const apObject = {
    type: "Note",
    content,
    visibility: "direct",
    to: recipients,
    cc: [],
    bto: [],
    bcc: [],
    inReplyTo: body.in_reply_to ?? body.inReplyTo ?? null,
    context: getThreadContextId(threadId),
    "takos:participants": thread.participants,
    "takos:draft": Boolean(body.draft),
    attachment: Array.isArray(body.media_ids)
      ? body.media_ids.map((url: string) => ({ type: "Document", url }))
      : undefined,
  };
  const res = await c.env.fetch("/objects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apObject),
  });
  if (!res.ok) return error("Failed to send message", res.status);
  const created = await readCoreData<any>(res);
  const updatedAt = String(created?.published ?? now);
  thread.updatedAt = updatedAt;
  thread.lastMessageId = created.local_id ?? created.id ?? undefined;
  await saveDmThread(c.env, thread);
  await bumpDmThreadRef(c.env, userId, threadId, updatedAt);
  return json(toDmMessage(created), { status: 201 });
});

router.post("/dm/threads/:threadId/read", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const userId = ensureAuthUserId(c.env);
  const threadId = c.req.param("threadId");
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const thread = await loadDmThread(c.env, threadId);
  if (thread && !thread.participants.includes(userId)) return error("Forbidden", 403);
  if (!thread) {
    const messages = await fetchThreadObjects(c.env, threadId);
    if (!messages.length) return error("Thread not found", 404);
    const inferred = participantsFromObject(messages[0]);
    if (inferred.length && !inferred.includes(userId)) return error("Forbidden", 403);
  }
  const readAt = new Date().toISOString();
  const messageIdRaw = body.message_id ?? body.messageId ?? null;
  const state: DmReadState = { messageId: messageIdRaw ? String(messageIdRaw) : undefined, readAt };
  await c.env.storage.set(dmReadKey(threadId), state);
  return json({ thread_id: threadId, message_id: state.messageId ?? null, read_at: readAt });
});

router.delete("/dm/messages/:messageId", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const messageId = c.req.param("messageId");
  const existingRes = await c.env.fetch(`/objects/${encodeURIComponent(messageId)}`);
  if (!existingRes.ok) return error("Message not found", 404);
  const existing = await readCoreData<any>(existingRes);
  if (existing.actor !== c.env.auth.userId) return error("Only the sender can delete this message", 403);
  const res = await c.env.fetch(`/objects/${encodeURIComponent(messageId)}`, { method: "DELETE" });
  if (!res.ok) return error("Failed to delete message", res.status);
  return json({ deleted: true });
});

// Story APIs implemented in App layer using /objects endpoints.
router.post("/stories", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  const visibleToFriends = body.visible_to_friends === undefined ? true : !!body.visible_to_friends;
  const apObject = {
    type: "Note",
    content: "",
    visibility: visibleToFriends ? "followers" : "public",
    context: body.community_id ?? null,
    "takos:story": {
      items,
      expiresAt: body.expires_at ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  };
  const res = await c.env.fetch("/objects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apObject),
  });
  if (!res.ok) return error("Failed to create story", res.status);
  const created = await readCoreData<any>(res);
  return json(created, { status: 201 });
});

router.post("/communities/:id/stories", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  const apObject = {
    type: "Note",
    content: "",
    visibility: "community",
    context: c.req.param("id"),
    "takos:story": {
      items,
      expiresAt: body.expires_at ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  };
  const res = await c.env.fetch("/objects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apObject),
  });
  if (!res.ok) return error("Failed to create story", res.status);
  const created = await readCoreData<any>(res);
  return json(created, { status: 201 });
});

router.get("/stories", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const query = parseQuery(c.req.raw);
  const { limit, cursor } = parsePagination(query, { limit: 20, offset: 0 });
  const url = new URL("/objects/timeline", c.req.url);
  url.searchParams.set("type", "Note");
  url.searchParams.set("visibility", "public,followers,community");
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);
  if (query.community_id) url.searchParams.set("community_id", query.community_id);
  const res = await c.env.fetch(url.pathname + url.search);
  if (!res.ok) return error("Failed to list stories", res.status);
  const page = await readCoreData<any>(res);
  const stories = (page.items || []).filter((o: any) => !!o["takos:story"]);
  return json({ stories, next_cursor: page.nextCursor ?? null });
});

router.get("/communities/:id/stories", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const url = new URL(c.req.url);
  url.searchParams.set("community_id", c.req.param("id"));
  return router.fetch(new Request(url.toString(), { method: "GET" }), c.env);
});

router.get("/stories/:id", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const res = await c.env.fetch(`/objects/${encodeURIComponent(id)}`);
  if (!res.ok) return error("story not found", 404);
  const obj = await readCoreData<any>(res);
  if (!obj["takos:story"]) return error("story not found", 404);
  return json(obj);
});

router.patch("/stories/:id", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const body = await parseBody<any>(c.req.raw).catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : undefined;
  const audience: "all" | "community" | undefined =
    body.audience === "community" ? "community" : body.audience === "all" ? "all" : undefined;
  const visibleToFriends: boolean | undefined =
    body.visible_to_friends === undefined ? undefined : !!body.visible_to_friends;

  const existingRes = await c.env.fetch(`/objects/${encodeURIComponent(id)}`);
  if (!existingRes.ok) return error("story not found", 404);
  const existing = await readCoreData<any>(existingRes);
  if (!existing?.["takos:story"]) return error("story not found", 404);
  if (existing.actor !== c.env.auth.userId) return error("Only the author can update this story", 403);

  const nextVisibility =
    audience === "community"
      ? "community"
      : audience === "all"
        ? visibleToFriends === false
          ? "public"
          : "followers"
        : undefined;
  const nextContext = audience === "all" ? null : undefined;

  const story = existing["takos:story"] ?? {};
  const update: Record<string, unknown> = {
    ...(nextVisibility ? { visibility: nextVisibility } : {}),
    ...(nextContext !== undefined ? { context: nextContext } : {}),
    "takos:story": {
      ...story,
      ...(items ? { items } : {}),
    },
  };

  const res = await c.env.fetch(`/objects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!res.ok) return error("Failed to update story", res.status);
  const updated = await readCoreData<any>(res);
  if (!updated?.["takos:story"]) return error("Failed to update story", 500);
  return json(updated);
});

router.delete("/stories/:id", async (c) => {
  if (!c.env.auth) return error("Unauthorized", 401);
  const id = c.req.param("id");
  const existingRes = await c.env.fetch(`/objects/${encodeURIComponent(id)}`);
  if (!existingRes.ok) return error("story not found", 404);
  const existing = (await existingRes.json().catch(() => null)) as any;
  if (!existing?.["takos:story"]) return error("story not found", 404);
  if (existing.actor !== c.env.auth.userId) return error("Only the author can delete this story", 403);
  const res = await c.env.fetch(`/objects/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return error("Failed to delete story", res.status);
  return json({ deleted: true });
});

const app: TakosApp = {
  fetch: router.fetch,
  scheduled: async (event: ScheduledEvent, env: AppEnv, _ctx: ExecutionContext) => {
    if (!event?.cron) return;

    // Every 5 minutes: delivery + inbox queue processing
    if (event.cron === "*/5 * * * *") {
      console.warn("[default-app] scheduled workers are not enabled in this runtime");
      return;
    }

    // Daily cleanup (prune inbox/delivery/rate-limit/actor cache tables)
    if (event.cron === "0 2 * * *" || event.cron === "0 4 * * 0") {
      console.warn("[default-app] scheduled workers are not enabled in this runtime");
    }
  },
};

export default app;

export { PostCard, type Post } from "./components/PostCard.js";
export {
  HomeScreen,
  ProfileScreen,
  ProfileEditScreen,
  NotificationsScreen,
  SettingsScreen,
  OnboardingScreen,
} from "./screens/index.js";
