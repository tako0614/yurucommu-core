import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import {
  ACTIVITYSTREAMS_CONTEXT,
  SECURITY_CONTEXT,
  fail,
  generateNoteObject,
  generatePersonActor,
  getActivityUri,
  getActorUri,
  parseActorUri,
  nowISO,
  ok,
  releaseStore,
  requireInstanceDomain,
  uuid,
  wrapInCreateActivity,
} from "@takos/platform/server";
import { makeData } from "../data";
import { auth } from "../middleware/auth";

type ExportOptions = {
  format: "json" | "activitypub";
  includeDm: boolean;
  includeMedia: boolean;
};

type ArtifactRef = {
  key: string;
  url: string;
  contentType: string;
};

type BaseUserData = {
  profile: any;
  posts: any[];
  friends: any[];
  reactions: any[];
  bookmarks: any[];
};

type CorePayload = {
  payload: any;
  counts: {
    posts: number;
    friends: number;
    reactions: number;
    bookmarks: number;
  };
};

type DmBundleResult = {
  json: any | null;
  activitypub: any | null;
  counts: { dmThreads: number; dmMessages: number };
};

type MediaBundleResult = {
  json: any | null;
  activitypub: any | null;
  counts: { media: number };
};

const MEDIA_CACHE_CONTROL = "private, max-age=0, no-store";
const DEFAULT_EXPORT_MAX_ATTEMPTS = 3;
const EXPORT_RETRY_BASE_DELAY_MS = 60_000;
const EXPORT_RETRY_MAX_DELAY_MS = 30 * 60_000;
const EXPORT_BATCH_SIZE = 5;

const exportsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const isUrl = (value: string) =>
  typeof value === "string" &&
  (value.startsWith("http://") || value.startsWith("https://"));

const dedupeStrings = (values: Array<string | null | undefined>): string[] => {
  const set = new Set(
    values
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean),
  );
  return Array.from(set);
};

function parseActorHandle(value: string): { handle: string; domain?: string } | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed.replace(/^@+/, "");
  const parts = withoutPrefix.split("@");
  if (parts.length >= 2) {
    const handle = (parts.shift() || "").trim();
    const domain = parts.join("@").trim();
    if (handle && domain) {
      return { handle: handle.toLowerCase(), domain: domain.toLowerCase() };
    }
  }

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/ap\/users\/([a-z0-9_]{3,20})\/?$/i);
    if (match) {
      return { handle: match[1].toLowerCase(), domain: url.hostname.toLowerCase() };
    }
  } catch {
    // ignore parse errors
  }

  if (/^[a-z0-9_]{3,}$/i.test(trimmed)) {
    return { handle: trimmed.toLowerCase() };
  }

  return null;
}

function resolveActorRef(
  input: any,
  instanceDomain: string,
  aliases: string[] = [],
): { id: string; aliases: string[] } | null {
  const candidates: string[] = [];

  if (typeof input === "string") {
    candidates.push(input);
  } else if (input) {
    for (const key of ["actor", "actor_id", "user_id", "handle", "id", "addressee_id"]) {
      const value = (input as any)[key];
      if (typeof value === "string") {
        candidates.push(value);
      }
    }
  }

  for (const alias of aliases) {
    if (typeof alias === "string") {
      candidates.push(alias);
    }
  }

  const normalized = candidates.map((v) => v.trim()).filter(Boolean);
  if (!normalized.length) return null;

  const aliasSet = new Set(normalized);

  const urlCandidate = normalized.find((v) => isUrl(v));
  if (urlCandidate) {
    aliasSet.add(urlCandidate);
    return { id: urlCandidate, aliases: Array.from(aliasSet) };
  }

  for (const candidate of normalized) {
    const parsed = parseActorHandle(candidate);
    if (parsed?.handle && parsed.domain) {
      const id = `https://${parsed.domain}/ap/users/${parsed.handle}`;
      aliasSet.add(id);
      return { id, aliases: Array.from(aliasSet) };
    }
  }

  for (const candidate of normalized) {
    const parsed = parseActorHandle(candidate);
    if (parsed?.handle) {
      const domain = parsed.domain || instanceDomain;
      const id = getActorUri(parsed.handle, domain);
      aliasSet.add(id);
      return { id, aliases: Array.from(aliasSet) };
    }
  }

  return null;
}

function resolveObjectRef(input: any, instanceDomain: string): string | null {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return null;
  if (isUrl(raw)) return raw;
  const normalized = raw.startsWith("/") ? raw.slice(1) : raw;
  const path = normalized.startsWith("ap/objects/") ? normalized : `ap/objects/${normalized}`;
  return `https://${instanceDomain}/${path}`;
}

function buildActivityUriForActor(actorId: string, activityId: string, instanceDomain: string): string {
  const parsed = parseActorUri(actorId, instanceDomain);
  if (parsed?.domain) {
    return `https://${parsed.domain}/ap/activities/${activityId}`;
  }
  try {
    const url = new URL(actorId);
    if (url.hostname) {
      return `https://${url.hostname}/ap/activities/${activityId}`;
    }
  } catch {
    // ignore parse errors and fall back to instance domain
  }
  return `https://${instanceDomain}/ap/activities/${activityId}`;
}

function parseExportOptions(body: any): ExportOptions {
  const format = body?.format === "activitypub" ? "activitypub" : "json";
  const includeDm = Boolean(
    body?.include_dm ?? body?.includeDm ?? body?.dm ?? false,
  );
  const includeMedia = Boolean(
    body?.include_media ?? body?.includeMedia ?? body?.media ?? false,
  );
  return { format, includeDm, includeMedia };
}

function parseStoredOptions(request: any): Pick<ExportOptions, "includeDm" | "includeMedia"> {
  try {
    const parsed = JSON.parse(request?.result_json || "{}");
    const options = parsed?.options || parsed?.requested_options || parsed;
    return {
      includeDm: Boolean(options?.include_dm ?? options?.includeDm ?? false),
      includeMedia: Boolean(options?.include_media ?? options?.includeMedia ?? false),
    };
  } catch {
    return { includeDm: false, includeMedia: false };
  }
}

function normalizeAttempts(request: any): { attempts: number; maxAttempts: number } {
  const attempts = Math.max(0, Number(request?.attempt_count ?? 0));
  const maxAttemptsRaw = request?.max_attempts ?? DEFAULT_EXPORT_MAX_ATTEMPTS;
  const maxAttempts = Math.max(1, Number(maxAttemptsRaw) || DEFAULT_EXPORT_MAX_ATTEMPTS);
  return { attempts, maxAttempts };
}

function computeRetryDelayMs(attemptCount: number): number {
  if (attemptCount <= 0) return 0;
  const exponent = Math.max(0, attemptCount - 1);
  const delay = EXPORT_RETRY_BASE_DELAY_MS * 2 ** exponent;
  return Math.min(EXPORT_RETRY_MAX_DELAY_MS, delay);
}

function toDateMs(value: any): number | null {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function shouldBackoff(request: any): { wait: boolean; retryAt?: string } {
  const { attempts } = normalizeAttempts(request);
  if (attempts <= 0) return { wait: false };
  const lastAttemptMs = toDateMs(request?.processed_at);
  if (!lastAttemptMs) return { wait: false };
  const retryDelay = computeRetryDelayMs(attempts);
  const retryAtMs = lastAttemptMs + retryDelay;
  if (Date.now() < retryAtMs) {
    return { wait: true, retryAt: new Date(retryAtMs).toISOString() };
  }
  return { wait: false };
}

function isAdminUser(user: any, env: Bindings): boolean {
  return !!env.AUTH_USERNAME && user?.id === env.AUTH_USERNAME;
}

async function loadBaseUserData(
  store: ReturnType<typeof makeData>,
  userId: string,
): Promise<BaseUserData> {
  const profile = await store.getUser(userId);
  if (!profile) {
    throw new Error("user not found");
  }
  const posts = await store.listPostsByAuthors([userId], true);
  const friends = await store.listFriends(userId);
  const reactions = store.listReactionsByUser
    ? await store.listReactionsByUser(userId)
    : [];
  const bookmarks = store.listBookmarksByUser
    ? await store.listBookmarksByUser(userId)
    : [];
  return { profile, posts, friends, reactions, bookmarks };
}

function buildCoreJsonPayload(data: BaseUserData): CorePayload {
  return {
    payload: {
      generated_at: nowISO(),
      profile: data.profile,
      posts: data.posts,
      friends: data.friends,
      reactions: data.reactions,
      bookmarks: data.bookmarks,
    },
    counts: {
      posts: data.posts.length,
      friends: data.friends.length,
      reactions: data.reactions.length,
      bookmarks: data.bookmarks.length,
    },
  };
}

function buildCoreActivityPubPayload(
  data: BaseUserData,
  instanceDomain: string,
): CorePayload {
  const actor = generatePersonActor(data.profile, instanceDomain);
  const activities = (data.posts || []).map((post: any) => {
    const note = generateNoteObject(post, data.profile, instanceDomain);
    const activityId = post.ap_activity_id ||
      getActivityUri(data.profile.id, post.id, instanceDomain);
    return wrapInCreateActivity(note, actor.id, activityId);
  });
  const friendActors = dedupeStrings(
    (data.friends || []).map((friend: any) =>
      resolveActorRef(
        friend?.addressee_id ?? friend?.id ?? friend?.handle,
        instanceDomain,
        Array.isArray(friend?.addressee_aliases) ? friend.addressee_aliases : [],
      )?.id
    ),
  );

  const reactions = (data.reactions || []).map((reaction: any) => {
    const actorRef = resolveActorRef(reaction?.user_id ?? actor.id, instanceDomain);
    const reactionActor = actorRef?.id ?? actor.id;
    const activityId = reaction?.ap_activity_id ||
      buildActivityUriForActor(reactionActor, reaction?.id || uuid(), instanceDomain);
    const object = resolveObjectRef(
      (reaction as any)?.ap_object_id ||
        (reaction as any)?.post_ap_object_id ||
        reaction?.post_id,
      instanceDomain,
    ) || reaction?.post_id;
    return {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Like",
      id: activityId,
      actor: reactionActor,
      object,
      name: reaction?.emoji || undefined,
      published: reaction?.created_at || undefined,
    };
  });

  const bookmarks = (data.bookmarks || []).map((bookmark: any) => {
    const object = resolveObjectRef(
      (bookmark as any)?.ap_object_id ||
        (bookmark as any)?.post_ap_object_id ||
        bookmark?.post_id,
      instanceDomain,
    ) || bookmark?.post_id;
    const activityId = buildActivityUriForActor(
      actor.id,
      bookmark?.id || uuid(),
      instanceDomain,
    );
    return {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Bookmark",
      id: activityId,
      actor: actor.id,
      object,
      published: bookmark?.created_at || undefined,
    };
  });

  const objectRefs = dedupeStrings([
    ...activities.map((activity: any) =>
      activity?.object && typeof activity.object === "object"
        ? (activity.object as any).id
        : null
    ),
    ...reactions.map((reaction: any) =>
      typeof reaction.object === "string" ? reaction.object : null
    ),
    ...bookmarks.map((bookmark: any) =>
      typeof bookmark.object === "string" ? bookmark.object : null
    ),
  ]);

  const actorRefs = dedupeStrings([
    actor.id,
    ...friendActors,
    ...reactions.map((reaction: any) => reaction.actor as string),
    ...bookmarks.map((bookmark: any) => bookmark.actor as string),
  ]);

  return {
    payload: {
      "@context": [ACTIVITYSTREAMS_CONTEXT, SECURITY_CONTEXT],
      generated_at: nowISO(),
      actor,
      outbox: activities,
      friends: friendActors,
      reactions,
      bookmarks,
      references: {
        actors: actorRefs,
        objects: objectRefs,
      },
    },
    counts: {
      posts: data.posts.length,
      friends: data.friends.length,
      reactions: reactions.length,
      bookmarks: bookmarks.length,
    },
  };
}

function parseParticipants(input: any): string[] {
  if (Array.isArray(input)) {
    return input.map((p) => String(p || "").trim()).filter(Boolean);
  }
  try {
    const parsed = JSON.parse(input || "[]");
    if (Array.isArray(parsed)) {
      return parsed.map((p) => String(p || "").trim()).filter(Boolean);
    }
  } catch {
    // ignore
  }
  return [];
}

const buildThreadUri = (instanceDomain: string, threadId: string) =>
  `https://${instanceDomain}/ap/dm/${threadId}`;

function buildDmActivity(
  message: any,
  participants: string[],
  threadUri: string,
  instanceDomain: string,
) {
  if (message?.raw_activity_json) {
    try {
      return JSON.parse(message.raw_activity_json);
    } catch {
      // ignore and fall back to synthetic activity
    }
  }
  const actorRef = resolveActorRef(message?.author_id, instanceDomain);
  const actor = actorRef?.id || message?.author_id || participants[0] || threadUri;
  const published = message?.created_at || nowISO();
  const activityId = message?.ap_activity_id ||
    `${threadUri}/activities/${message?.id || uuid()}`;
  const objectId = message?.id
    ? `${threadUri}/messages/${message.id}`
    : `${threadUri}/messages/${uuid()}`;
  return {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    id: activityId,
    type: "Create",
    actor,
    to: participants,
    cc: participants,
    published,
    object: {
      type: "Note",
      id: objectId,
      attributedTo: actor,
      content: message?.content_html || "",
      context: threadUri,
      published,
      to: participants,
      cc: participants,
    },
  };
}

async function collectDmBundles(
  store: ReturnType<typeof makeData>,
  userId: string,
  instanceDomain: string,
): Promise<DmBundleResult> {
  if (!store.listAllDmThreads || !store.listDmMessages) {
    return { json: null, activitypub: null, counts: { dmThreads: 0, dmMessages: 0 } };
  }
  const actorUri = getActorUri(userId, instanceDomain);
  const aliases = new Set<string>([
    userId,
    actorUri,
    `@${userId}@${instanceDomain}`,
  ]);
  const threads = await store.listAllDmThreads();
  const relevantThreads = (threads || []).filter((thread: any) => {
    const participants = parseParticipants(thread?.participants_json);
    const resolved = dedupeStrings(
      participants.map((p) => resolveActorRef(p, instanceDomain)?.id ?? p),
    );
    return resolved.some((p) => aliases.has(p) || p.endsWith(`/${userId}`));
  });

  const jsonThreads: any[] = [];
  const apThreads: any[] = [];
  let messageCount = 0;

  for (const thread of relevantThreads) {
    const rawParticipants = parseParticipants(thread?.participants_json);
    const participants = dedupeStrings(
      rawParticipants.map((p) => resolveActorRef(p, instanceDomain)?.id ?? p),
    );
    const rawMessages = await store.listDmMessages(thread.id, 0);
    const messages = [...(rawMessages || [])].sort(
      (a: any, b: any) =>
        new Date(a?.created_at || 0).getTime() -
        new Date(b?.created_at || 0).getTime(),
    );
    messageCount += messages.length;

    jsonThreads.push({
      id: thread.id,
      participants,
      raw_participants: rawParticipants,
      created_at: thread.created_at,
      messages: messages.map((msg: any) => ({
        id: msg.id,
        author_id: msg.author_id,
        actor: resolveActorRef(msg.author_id, instanceDomain)?.id ?? msg.author_id,
        content_html: msg.content_html,
        created_at: msg.created_at,
        raw_activity_json: msg.raw_activity_json || null,
      })),
    });

    const threadUri = buildThreadUri(instanceDomain, thread.id);
    apThreads.push({
      id: thread.id,
      thread: threadUri,
      participants,
      activities: messages.map((msg: any) =>
        buildDmActivity(msg, participants, threadUri, instanceDomain)
      ),
    });
  }

  return {
    json: {
      generated_at: nowISO(),
      threads: jsonThreads,
    },
    activitypub: {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      generated_at: nowISO(),
      threads: apThreads,
    },
    counts: { dmThreads: relevantThreads.length, dmMessages: messageCount },
  };
}

const absoluteMediaUrl = (url: string, instanceDomain: string) => {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const normalized = url.startsWith("/") ? url : `/${url}`;
  return `https://${instanceDomain}${normalized}`;
};

function buildMediaActivity(item: any, instanceDomain: string) {
  const url = absoluteMediaUrl(item?.url || "", instanceDomain);
  const contentType = item?.content_type || "application/octet-stream";
  const lower = contentType.toLowerCase();
  const isImage = lower.startsWith("image/");
  const isVideo = lower.startsWith("video/");
  return {
    type: isImage ? "Image" : isVideo ? "Video" : "Document",
    mediaType: contentType,
    url,
    name: item?.description || undefined,
    updated: item?.updated_at || undefined,
  };
}

async function collectMediaBundles(
  store: ReturnType<typeof makeData>,
  userId: string,
  instanceDomain: string,
): Promise<MediaBundleResult> {
  if (!store.listMediaByUser) {
    return { json: null, activitypub: null, counts: { media: 0 } };
  }
  const media = await store.listMediaByUser(userId);
  return {
    json: {
      generated_at: nowISO(),
      files: media,
    },
    activitypub: {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "OrderedCollection",
      totalItems: media.length,
      orderedItems: (media || []).map((item: any) =>
        buildMediaActivity(item, instanceDomain)
      ),
    },
    counts: { media: media.length },
  };
}

async function putJsonArtifact(
  env: Bindings,
  key: string,
  payload: any,
): Promise<ArtifactRef> {
  if (!env.MEDIA) {
    throw new Error("media storage not configured for exports");
  }
  const body = JSON.stringify(payload, null, 2);
  await env.MEDIA.put(key, body, {
    httpMetadata: {
      contentType: "application/json",
      cacheControl: MEDIA_CACHE_CONTROL,
    },
  });
  return {
    key,
    url: `/media/${encodeURI(key)}`,
    contentType: "application/json",
  };
}

// POST /exports - enqueue data export
exportsRoute.post("/exports", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.createExportRequest) {
      return fail(c, "data export not supported", 501);
    }
    const user = c.get("user") as any;
    const body = (await c.req.json().catch(() => ({}))) as any;
    const options = parseExportOptions(body);
    const request = await store.createExportRequest({
      id: uuid(),
      user_id: user.id,
      format: options.format,
      status: "pending",
      requested_at: nowISO(),
      attempt_count: 0,
      max_attempts: DEFAULT_EXPORT_MAX_ATTEMPTS,
      result_json: JSON.stringify({ options }),
    });
    return ok(c, request, 202);
  } finally {
    await releaseStore(store);
  }
});

// GET /exports - list requests for user
exportsRoute.get("/exports", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.listExportRequestsByUser) {
      return fail(c, "data export not supported", 501);
    }
    const user = c.get("user") as any;
    const list = await store.listExportRequestsByUser(user.id);
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// GET /exports/:id
exportsRoute.get("/exports/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.getExportRequest) {
      return fail(c, "data export not supported", 501);
    }
    const user = c.get("user") as any;
    const request = await store.getExportRequest(c.req.param("id"));
    if (!request) return fail(c, "export not found", 404);
    if (request.user_id !== user.id) return fail(c, "forbidden", 403);
    return ok(c, request);
  } finally {
    await releaseStore(store);
  }
});

// Admin: reset or trigger retry for an export request
exportsRoute.post("/admin/exports/:id/retry", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.getExportRequest || !store.updateExportRequest) {
      return fail(c, "data export not supported", 501);
    }
    const user = c.get("user") as any;
    if (!isAdminUser(user, c.env as Bindings)) {
      return fail(c, "forbidden", 403);
    }
    const requestId = c.req.param("id");
    const current = await store.getExportRequest(requestId);
    if (!current) return fail(c, "export not found", 404);

    const body = (await c.req.json().catch(() => ({}))) as any;
    const resetAttempts = Boolean(body?.reset_attempts ?? body?.resetAttempts ?? false);
    const maxAttemptsInput = Number(body?.max_attempts ?? body?.maxAttempts);
    const parsedMaxAttempts = Number.isFinite(maxAttemptsInput)
      ? Math.max(1, Math.min(10, Math.trunc(maxAttemptsInput)))
      : null;

    const normalized = normalizeAttempts(current);
    const nextAttempts = resetAttempts ? 0 : normalized.attempts;
    const nextMaxAttempts = parsedMaxAttempts !== null ? parsedMaxAttempts : normalized.maxAttempts;

    if (nextAttempts >= nextMaxAttempts) {
      return fail(c, "max attempts exhausted; increase max_attempts or reset attempts", 409);
    }

    await store.updateExportRequest!(requestId, {
      status: "pending",
      attempt_count: nextAttempts,
      max_attempts: nextMaxAttempts,
      processed_at: null,
      download_url: null,
      error_message: resetAttempts ? null : current.error_message ?? null,
    });

    return ok(c, {
      id: requestId,
      status: "pending",
      attempt_count: nextAttempts,
      max_attempts: nextMaxAttempts,
      reset_attempts: resetAttempts,
    });
  } finally {
    await releaseStore(store);
  }
});

export type ExportQueueResult = {
  supported: boolean;
  processed: Array<{
    id: string;
    status: string;
    attempt?: number;
    max_attempts?: number;
    error?: string;
    reason?: string;
    retry_at?: string;
  }>;
};

export async function processExportQueue(
  env: Bindings,
  options: { limit?: number } = {},
): Promise<ExportQueueResult> {
  const limit = options.limit ?? EXPORT_BATCH_SIZE;
  const store = makeData(env as any);
  const results: ExportQueueResult["processed"] = [];

  try {
    if (!store.listPendingExportRequests || !store.updateExportRequest) {
      return { supported: false, processed: results };
    }

    const pending = await store.listPendingExportRequests(limit);
    const instanceDomain = requireInstanceDomain(env as any);

    for (const request of pending) {
      const storedOptions = parseStoredOptions(request);
      const resolvedOptions: ExportOptions = {
        format: request.format === "activitypub" ? "activitypub" : "json",
        includeDm: storedOptions.includeDm,
        includeMedia: storedOptions.includeMedia,
      };
      const { attempts, maxAttempts } = normalizeAttempts(request);

      if (attempts >= maxAttempts) {
        const exhaustedAt = nowISO();
        const errorMessage = request.error_message || "maximum export attempts reached";
        const failureSummary = {
          status: "failed",
          error: errorMessage,
          attempts,
          max_attempts: maxAttempts,
          options: {
            include_dm: resolvedOptions.includeDm,
            include_media: resolvedOptions.includeMedia,
            format: resolvedOptions.format,
          },
        };
        await store.updateExportRequest!(request.id, {
          status: "failed",
          processed_at: request.processed_at ?? exhaustedAt,
          error_message: errorMessage,
          result_json: JSON.stringify(failureSummary),
          attempt_count: attempts,
          max_attempts: maxAttempts,
        });
        results.push({
          id: request.id,
          status: "failed",
          reason: "max_attempts",
          attempt: attempts,
          max_attempts: maxAttempts,
        });
        continue;
      }

      const backoff = shouldBackoff(request);
      if (backoff.wait) {
        results.push({
          id: request.id,
          status: "pending",
          reason: "backoff",
          attempt: attempts,
          max_attempts: maxAttempts,
          retry_at: backoff.retryAt,
        });
        continue;
      }

      const attemptNumber = attempts + 1;

      try {
        await store.updateExportRequest!(request.id, {
          status: "processing",
          attempt_count: attemptNumber,
          max_attempts: maxAttempts,
          error_message: null,
        });

        const baseData = await loadBaseUserData(store, request.user_id);
        const core =
          resolvedOptions.format === "activitypub"
            ? buildCoreActivityPubPayload(baseData, instanceDomain)
            : buildCoreJsonPayload(baseData);

        const dmBundles = resolvedOptions.includeDm
          ? await collectDmBundles(store, request.user_id, instanceDomain)
          : { json: null, activitypub: null, counts: { dmThreads: 0, dmMessages: 0 } };
        const mediaBundles = resolvedOptions.includeMedia
          ? await collectMediaBundles(store, request.user_id, instanceDomain)
          : { json: null, activitypub: null, counts: { media: 0 } };

        const baseKey = `exports/${request.user_id}/${request.id}`;
        const artifacts: {
          core?: ArtifactRef;
          dmJson?: ArtifactRef;
          dmActivityPub?: ArtifactRef;
          mediaJson?: ArtifactRef;
          mediaActivityPub?: ArtifactRef;
        } = {};

        artifacts.core = await putJsonArtifact(
          env as any,
          `${baseKey}/core.${resolvedOptions.format}.json`,
          core.payload,
        );

        if (dmBundles.json) {
          artifacts.dmJson = await putJsonArtifact(
            env as any,
            `${baseKey}/dm.json`,
            dmBundles.json,
          );
        }
        if (dmBundles.activitypub) {
          artifacts.dmActivityPub = await putJsonArtifact(
            env as any,
            `${baseKey}/dm.activitypub.json`,
            dmBundles.activitypub,
          );
        }
        if (mediaBundles.json) {
          artifacts.mediaJson = await putJsonArtifact(
            env as any,
            `${baseKey}/media.json`,
            mediaBundles.json,
          );
        }
        if (mediaBundles.activitypub) {
          artifacts.mediaActivityPub = await putJsonArtifact(
            env as any,
            `${baseKey}/media.activitypub.json`,
            mediaBundles.activitypub,
          );
        }

        const summary = {
          generated_at: nowISO(),
          format: resolvedOptions.format,
          format_description: resolvedOptions.format === "activitypub"
            ? "ActivityPub JSON-LD export with resolved actor/object references"
            : "Application JSON export with raw identifiers",
          attempts: attemptNumber,
          max_attempts: maxAttempts,
          options: {
            include_dm: resolvedOptions.includeDm,
            include_media: resolvedOptions.includeMedia,
          },
          counts: {
            posts: core.counts.posts,
            friends: core.counts.friends,
            reactions: core.counts.reactions,
            bookmarks: core.counts.bookmarks,
            dm_threads: dmBundles.counts.dmThreads,
            dm_messages: dmBundles.counts.dmMessages,
            media_files: mediaBundles.counts.media,
          },
          artifacts: {
            core: artifacts.core,
            dm: resolvedOptions.includeDm
              ? {
                status: dmBundles.json || dmBundles.activitypub ? "completed" : "skipped",
                json: artifacts.dmJson,
                activitypub: artifacts.dmActivityPub,
              }
              : { status: "skipped" },
            media: resolvedOptions.includeMedia
              ? {
                status: mediaBundles.json || mediaBundles.activitypub ? "completed" : "skipped",
                json: artifacts.mediaJson,
                activitypub: artifacts.mediaActivityPub,
              }
              : { status: "skipped" },
          },
        };

        await store.updateExportRequest!(request.id, {
          status: "completed",
          processed_at: nowISO(),
          download_url: artifacts.core?.url ?? null,
          result_json: JSON.stringify(summary),
          error_message: null,
          attempt_count: attemptNumber,
          max_attempts: maxAttempts,
        });
        results.push({
          id: request.id,
          status: "completed",
          attempt: attemptNumber,
          max_attempts: maxAttempts,
        });
      } catch (err: any) {
        const failedAt = nowISO();
        const errorMessage = String(err?.message || err || "unknown error");
        const nextStatus = attemptNumber >= maxAttempts ? "failed" : "pending";
        const failureSummary = {
          status: "failed",
          error: errorMessage,
          attempt: attemptNumber,
          max_attempts: maxAttempts,
          failed_at: failedAt,
          will_retry: nextStatus === "pending",
          options: {
            include_dm: resolvedOptions.includeDm,
            include_media: resolvedOptions.includeMedia,
            format: resolvedOptions.format,
          },
        };
        await store.updateExportRequest!(request.id, {
          status: nextStatus,
          error_message: errorMessage,
          processed_at: failedAt,
          result_json: JSON.stringify(failureSummary),
          attempt_count: attemptNumber,
          max_attempts: maxAttempts,
        });
        results.push({
          id: request.id,
          status: nextStatus,
          attempt: attemptNumber,
          max_attempts: maxAttempts,
          error: errorMessage,
        });
      }
    }

    return { supported: true, processed: results };
  } finally {
    await releaseStore(store);
  }
}

// Cron/queue endpoint for export processing
exportsRoute.post("/internal/tasks/process-exports", async (c) => {
  const secret = c.env.CRON_SECRET;
  const headerSecret = c.req.header("Cron-Secret");
  if (secret && secret !== headerSecret) {
    return fail(c as any, "unauthorized", 401);
  }
  const result = await processExportQueue(c.env as Bindings, {
    limit: EXPORT_BATCH_SIZE,
  });
  if (!result.supported) {
    return fail(c as any, "data export not supported", 501);
  }
  return ok(c as any, result);
});

export {
  buildCoreActivityPubPayload,
  buildCoreJsonPayload,
  collectDmBundles,
  collectMediaBundles,
  parseExportOptions,
  computeRetryDelayMs,
  normalizeAttempts,
  shouldBackoff,
  processExportQueue,
};
export default exportsRoute;
