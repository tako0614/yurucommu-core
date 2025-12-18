import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import {
  fail,
  HttpError,
  nowISO,
  ok,
  releaseStore,
  requireInstanceDomain,
  uuid,
} from "@takos/platform/server";
import { makeData } from "../data";
import { auth } from "../middleware/auth";
import { ErrorCodes } from "../lib/error-codes";

type ExportOptions = {
  format: "json";
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
  counts: { dmThreads: number; dmMessages: number };
};

type MediaBundleResult = {
  json: any | null;
  counts: { media: number };
};

const MEDIA_CACHE_CONTROL = "private, max-age=0, no-store";
const DEFAULT_EXPORT_MAX_ATTEMPTS = 3;
const EXPORT_RETRY_BASE_DELAY_MS = 60_000;
const EXPORT_RETRY_MAX_DELAY_MS = 30 * 60_000;
const EXPORT_BATCH_SIZE = 5;

const exportsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const dedupeStrings = (values: Array<string | null | undefined>): string[] => {
  const set = new Set(
    values
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean),
  );
  return Array.from(set);
};

function parseExportOptions(body: any): ExportOptions {
  const format: ExportOptions["format"] = "json";
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
    throw new HttpError(404, ErrorCodes.USER_NOT_FOUND, "User not found", { userId });
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

async function collectDmBundles(
  store: ReturnType<typeof makeData>,
  userId: string,
  instanceDomain: string,
): Promise<DmBundleResult> {
  if (!store.listAllDmThreads || !store.listDmMessages) {
    return { json: null, counts: { dmThreads: 0, dmMessages: 0 } };
  }
  const aliases = new Set<string>([
    userId,
    `@${userId}@${instanceDomain}`,
  ]);
  const threads = await store.listAllDmThreads();
  const relevantThreads = (threads || []).filter((thread: any) => {
    const participants = parseParticipants(thread?.participants_json);
    return participants.some((p) => aliases.has(p) || p.endsWith(`/${userId}`));
  });

  const jsonThreads: any[] = [];
  let messageCount = 0;

  for (const thread of relevantThreads) {
    const rawParticipants = parseParticipants(thread?.participants_json);
    const participants = dedupeStrings(rawParticipants);
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
        actor: msg.author_id,
        content_html: msg.content_html,
        created_at: msg.created_at,
        raw_activity_json: msg.raw_activity_json || null,
      })),
    });
  }

  return {
    json: {
      generated_at: nowISO(),
      threads: jsonThreads,
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

async function collectMediaBundles(
  store: ReturnType<typeof makeData>,
  userId: string,
  instanceDomain: string,
): Promise<MediaBundleResult> {
  if (!store.listMediaByUser) {
    return { json: null, counts: { media: 0 } };
  }
  const media = await store.listMediaByUser(userId);
  return {
    json: {
      generated_at: nowISO(),
      files: media,
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
    throw new HttpError(500, ErrorCodes.CONFIGURATION_ERROR, "Media storage not configured");
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
    if (request.user_id !== user.id) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN });
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
      return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN });
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
        format: "json",
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
        const core = buildCoreJsonPayload(baseData);

        const dmBundles = resolvedOptions.includeDm
          ? await collectDmBundles(store, request.user_id, instanceDomain)
          : { json: null, counts: { dmThreads: 0, dmMessages: 0 } };
        const mediaBundles = resolvedOptions.includeMedia
          ? await collectMediaBundles(store, request.user_id, instanceDomain)
          : { json: null, counts: { media: 0 } };

        const baseKey = `exports/${request.user_id}/${request.id}`;
        const artifacts: {
          core?: ArtifactRef;
          dmJson?: ArtifactRef;
          mediaJson?: ArtifactRef;
        } = {};

        artifacts.core = await putJsonArtifact(
          env as any,
          `${baseKey}/core.json`,
          core.payload,
        );

        if (dmBundles.json) {
          artifacts.dmJson = await putJsonArtifact(
            env as any,
            `${baseKey}/dm.json`,
            dmBundles.json,
          );
        }
        if (mediaBundles.json) {
          artifacts.mediaJson = await putJsonArtifact(
            env as any,
            `${baseKey}/media.json`,
            mediaBundles.json,
          );
        }

        const summary = {
          generated_at: nowISO(),
          format: resolvedOptions.format,
          format_description: "Application JSON export with raw identifiers",
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
                status: dmBundles.json ? "completed" : "skipped",
                json: artifacts.dmJson,
              }
              : { status: "skipped" },
            media: resolvedOptions.includeMedia
              ? {
                status: mediaBundles.json ? "completed" : "skipped",
                json: artifacts.mediaJson,
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

// GET /exports/:id/artifacts - list all artifacts for an export
exportsRoute.get("/exports/:id/artifacts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.getExportRequest) {
      return fail(c, "data export not supported", 501);
    }
    const user = c.get("user") as any;
    const request = await store.getExportRequest(c.req.param("id"));
    if (!request) return fail(c, "export not found", 404);
    if (request.user_id !== user.id) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN });
    if (request.status !== "completed") {
      return fail(c, "export not completed", 400);
    }

    let resultData: any;
    try {
      resultData = JSON.parse(request.result_json || "{}");
    } catch {
      return fail(c, "invalid export result", 500);
    }

    const artifacts = resultData.artifacts || {};
    const response: any = {
      id: request.id,
      status: request.status,
      format: resultData.format,
      generated_at: resultData.generated_at,
      counts: resultData.counts,
      artifacts: [],
    };

    // Core artifact
    if (artifacts.core) {
      response.artifacts.push({
        key: "core",
        type: "data",
        url: artifacts.core.url,
        contentType: artifacts.core.contentType,
        description: `Core data (profile, posts, friends, reactions, bookmarks) in ${resultData.format} format`,
      });
    }

    // DM artifacts
    if (artifacts.dm?.status === "completed") {
      if (artifacts.dm.json) {
        response.artifacts.push({
          key: "dm-json",
          type: "dm",
          url: artifacts.dm.json.url,
          contentType: artifacts.dm.json.contentType,
          description: "Direct messages in JSON format",
        });
      }
    }

    // Media artifacts
    if (artifacts.media?.status === "completed") {
      if (artifacts.media.json) {
        response.artifacts.push({
          key: "media-json",
          type: "media-metadata",
          url: artifacts.media.json.url,
          contentType: artifacts.media.json.contentType,
          description: "Media file metadata in JSON format",
        });
      }
    }

    return ok(c, response);
  } finally {
    await releaseStore(store);
  }
});

// GET /exports/:id/media-urls - generate download URLs for media files
exportsRoute.get("/exports/:id/media-urls", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.getExportRequest || !store.listMediaByUser) {
      return fail(c, "data export not supported", 501);
    }
    const user = c.get("user") as any;
    const request = await store.getExportRequest(c.req.param("id"));
    if (!request) return fail(c, "export not found", 404);
    if (request.user_id !== user.id) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN });
    if (request.status !== "completed") {
      return fail(c, "export not completed", 400);
    }

    // Check if media was included in export
    let resultData: any;
    try {
      resultData = JSON.parse(request.result_json || "{}");
    } catch {
      return fail(c, "invalid export result", 500);
    }

    if (resultData.artifacts?.media?.status !== "completed") {
      return fail(c, "media was not included in this export", 400);
    }

    const instanceDomain = requireInstanceDomain(c.env as any);
    const media = await store.listMediaByUser(user.id);

    const mediaUrls = (media || []).map((item: any) => ({
      key: item.key,
      filename: item.key?.split("/").pop() || item.key,
      url: absoluteMediaUrl(item.url || `/media/${item.key}`, instanceDomain),
      contentType: item.content_type || "application/octet-stream",
      size: item.size || null,
      description: item.description || null,
      createdAt: item.created_at || null,
    }));

    return ok(c, {
      exportId: request.id,
      totalFiles: mediaUrls.length,
      files: mediaUrls,
    });
  } finally {
    await releaseStore(store);
  }
});

// GET /exports/:id/dm-threads - get detailed DM threads list
exportsRoute.get("/exports/:id/dm-threads", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.getExportRequest || !store.listAllDmThreads) {
      return fail(c, "data export not supported", 501);
    }
    const user = c.get("user") as any;
    const request = await store.getExportRequest(c.req.param("id"));
    if (!request) return fail(c, "export not found", 404);
    if (request.user_id !== user.id) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN });
    if (request.status !== "completed") {
      return fail(c, "export not completed", 400);
    }

    // Check if DM was included in export
    let resultData: any;
    try {
      resultData = JSON.parse(request.result_json || "{}");
    } catch {
      return fail(c, "invalid export result", 500);
    }

    if (resultData.artifacts?.dm?.status !== "completed") {
      return fail(c, "DM was not included in this export", 400);
    }

    const instanceDomain = requireInstanceDomain(c.env as any);
    const aliases = new Set<string>([
      user.id,
      `@${user.id}@${instanceDomain}`,
    ]);

    const threads = await store.listAllDmThreads();
    const relevantThreads = (threads || []).filter((thread: any) => {
      const participants = parseParticipants(thread?.participants_json);
      return participants.some((p) => aliases.has(p) || p.endsWith(`/${user.id}`));
    });

    const threadSummaries = relevantThreads.map((thread: any) => {
      const rawParticipants = parseParticipants(thread?.participants_json);
      const participants = dedupeStrings(rawParticipants);
      return {
        id: thread.id,
        participants,
        participantCount: participants.length,
        createdAt: thread.created_at,
      };
    });

    return ok(c, {
      exportId: request.id,
      totalThreads: threadSummaries.length,
      threads: threadSummaries,
    });
  } finally {
    await releaseStore(store);
  }
});

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
  buildCoreJsonPayload,
  collectDmBundles,
  collectMediaBundles,
  parseExportOptions,
  computeRetryDelayMs,
  normalizeAttempts,
  shouldBackoff,
};
export default exportsRoute;
