/**
 * Post route helper functions
 *
 * Extracted from base.ts to reduce file size. Contains:
 * - validateCreatePostBody: full validation for POST / body
 * - checkCommunityPostPermission: community policy enforcement
 * - processMentions: mention extraction, resolution, and notification
 * - validateEditFields: content/summary validation for PATCH
 */

import {
  activities,
  actorCache,
  actors,
  communities,
  communityMembers,
  inbox as inboxTable,
  objects,
} from "../../../db/index.ts";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import { activityApId, generateId, isLocal } from "../../federation-helpers.ts";
import {
  extractMentions,
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_SUMMARY_LENGTH,
} from "./transformers.ts";
import {
  type CreatePostBody,
  isRecord,
  type MentionFailure,
  parseJsonObject,
  type PostAttachment,
  validateOptionalString,
} from "./queries.ts";
import { logger } from "../../lib/logger.ts";

const log = logger.child({ component: "posts.helpers" });

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export type CreatePostValidationResult =
  | {
      ok: true;
      body: CreatePostBody;
      content: string;
      summary: string | undefined;
    }
  | { ok: false; error: string; code?: string };

/**
 * Parse and validate the raw request body for creating a post.
 * Returns a discriminated union: ok with parsed body, or error details.
 */
export async function validateCreatePostBody(c: {
  req: { json: () => Promise<unknown> };
}): Promise<CreatePostValidationResult> {
  const rawBody = await parseJsonObject(c);
  if (!rawBody) {
    return { ok: false, error: "Invalid request body", code: "BAD_REQUEST" };
  }

  if (typeof rawBody.content !== "string") {
    return {
      ok: false,
      error: "content must be a string",
      code: "BAD_REQUEST",
    };
  }

  for (const field of [
    "summary",
    "visibility",
    "in_reply_to",
    "community_ap_id",
  ] as const) {
    const err = validateOptionalString(rawBody, field);
    if (err) return { ok: false, error: err, code: "BAD_REQUEST" };
  }

  if (
    rawBody.attachments !== undefined &&
    !Array.isArray(rawBody.attachments)
  ) {
    return {
      ok: false,
      error: "attachments must be an array",
      code: "BAD_REQUEST",
    };
  }
  if (
    Array.isArray(rawBody.attachments) &&
    rawBody.attachments.some((a) => !isRecord(a))
  ) {
    return {
      ok: false,
      error: "attachments must be objects",
      code: "BAD_REQUEST",
    };
  }

  const body: CreatePostBody = {
    content: rawBody.content,
    summary: typeof rawBody.summary === "string" ? rawBody.summary : undefined,
    attachments: Array.isArray(rawBody.attachments)
      ? (rawBody.attachments as PostAttachment[])
      : undefined,
    in_reply_to:
      typeof rawBody.in_reply_to === "string" ? rawBody.in_reply_to : undefined,
    visibility:
      typeof rawBody.visibility === "string" ? rawBody.visibility : undefined,
    community_ap_id:
      typeof rawBody.community_ap_id === "string"
        ? rawBody.community_ap_id
        : undefined,
  };

  const content = body.content.trim();
  const summary = body.summary?.trim();

  if (!content) {
    return { ok: false, error: "Content required" };
  }
  if (content.length > MAX_POST_CONTENT_LENGTH) {
    return {
      ok: false,
      error: `Content too long (max ${MAX_POST_CONTENT_LENGTH} chars)`,
    };
  }
  if (summary && summary.length > MAX_POST_SUMMARY_LENGTH) {
    return {
      ok: false,
      error: `Summary too long (max ${MAX_POST_SUMMARY_LENGTH} chars)`,
    };
  }

  return { ok: true, body, content, summary };
}

// ---------------------------------------------------------------------------
// Community policy check
// ---------------------------------------------------------------------------

export type CommunityCheckResult =
  | { allowed: true; communityId: string | null }
  | { allowed: false; error: string; status: 403 | 404 };

/**
 * Check whether the actor is allowed to post in the given community.
 * If `communityApId` is undefined, returns { allowed: true, communityId: null }.
 */
export async function checkCommunityPostPermission(
  db: Database,
  actorApId: string,
  communityApId: string | undefined,
): Promise<CommunityCheckResult> {
  if (!communityApId) return { allowed: true, communityId: null };

  const community = await db
    .select({
      apId: communities.apId,
      postPolicy: communities.postPolicy,
    })
    .from(communities)
    .where(
      and(
        or(
          eq(communities.apId, communityApId),
          eq(communities.preferredUsername, communityApId),
        ),
        isNull(communities.deletedAt),
      ),
    )
    .get();

  if (!community) {
    return { allowed: false, error: "Community not found", status: 404 };
  }

  const membership = await db
    .select({
      role: communityMembers.role,
    })
    .from(communityMembers)
    .where(
      and(
        eq(communityMembers.communityApId, community.apId),
        eq(communityMembers.actorApId, actorApId),
      ),
    )
    .get();

  const policy = community.postPolicy || "members";
  const role = membership?.role as "owner" | "moderator" | "member" | undefined;
  const isManager = role === "owner" || role === "moderator";

  if (policy !== "anyone" && !membership) {
    return { allowed: false, error: "Not a community member", status: 403 };
  }
  if (policy === "mods" && !isManager) {
    return { allowed: false, error: "Moderator role required", status: 403 };
  }
  if (policy === "owners" && role !== "owner") {
    return { allowed: false, error: "Owner role required", status: 403 };
  }

  return { allowed: true, communityId: community.apId };
}

// ---------------------------------------------------------------------------
// Reply handling
// ---------------------------------------------------------------------------

export const REPLY_TARGET_NOT_FOUND = "REPLY_TARGET_NOT_FOUND";

/**
 * Insert the post object, increment author post count, and handle reply-chain
 * updates (parent reply count bump + notification to local parent author).
 *
 * Throws Error(REPLY_TARGET_NOT_FOUND) if in_reply_to references a missing post.
 * Returns the parentAuthor apId (or null if not a reply).
 */
export async function insertPostAndHandleReply(
  db: Database,
  params: {
    apId: string;
    actorApId: string;
    content: string;
    summary: string | null;
    attachments: PostAttachment[] | undefined;
    inReplyTo: string | null;
    visibility: string;
    communityId: string | null;
    baseUrl: string;
    now: string;
  },
): Promise<string | null> {
  let parentAuthor: string | null = null;

  await db.insert(objects).values({
    apId: params.apId,
    type: "Note",
    attributedTo: params.actorApId,
    content: params.content,
    summary: params.summary,
    attachmentsJson: JSON.stringify(params.attachments || []),
    inReplyTo: params.inReplyTo,
    visibility: params.visibility,
    communityApId: params.communityId,
    published: params.now,
    isLocal: 1,
  });

  await db
    .update(actors)
    .set({ postCount: sql`${actors.postCount} + 1` })
    .where(eq(actors.apId, params.actorApId));

  if (params.inReplyTo) {
    const parentPost = await db
      .select({ attributedTo: objects.attributedTo })
      .from(objects)
      .where(eq(objects.apId, params.inReplyTo))
      .get();

    if (!parentPost) throw new Error(REPLY_TARGET_NOT_FOUND);

    parentAuthor = parentPost.attributedTo;

    await db
      .update(objects)
      .set({ replyCount: sql`${objects.replyCount} + 1` })
      .where(eq(objects.apId, params.inReplyTo));

    if (
      parentPost.attributedTo !== params.actorApId &&
      isLocal(parentPost.attributedTo, params.baseUrl)
    ) {
      const replyActivityId = activityApId(params.baseUrl, generateId());
      await db.insert(activities).values({
        apId: replyActivityId,
        type: "Create",
        actorApId: params.actorApId,
        objectApId: params.apId,
        rawJson: JSON.stringify({
          "@context": "https://www.w3.org/ns/activitystreams",
          id: replyActivityId,
          type: "Create",
          actor: params.actorApId,
          object: params.apId,
        }),
        createdAt: params.now,
      });

      await db.insert(inboxTable).values({
        actorApId: parentPost.attributedTo,
        activityApId: replyActivityId,
        read: 0,
        createdAt: params.now,
      });
    }
  }

  return parentAuthor;
}

// ---------------------------------------------------------------------------
// Mention processing
// ---------------------------------------------------------------------------

/**
 * Extract @mentions from content, resolve them to actor AP IDs,
 * create notification activities for local mentioned actors, and
 * return any failures encountered.
 */
export async function processMentions(
  db: Database,
  params: {
    content: string;
    postApId: string;
    actorApId: string;
    parentAuthor: string | null;
    baseUrl: string;
    now: string;
  },
): Promise<MentionFailure[]> {
  const mentions = extractMentions(params.content);
  const mentionFailures: MentionFailure[] = [];

  if (mentions.length === 0) return mentionFailures;

  const localMentions = mentions.filter((m) => !m.includes("@"));
  const remoteMentions = mentions.filter((m) => m.includes("@"));

  const [localActors, cachedActors] = await Promise.all([
    localMentions.length > 0
      ? db
          .select({
            apId: actors.apId,
            preferredUsername: actors.preferredUsername,
          })
          .from(actors)
          .where(inArray(actors.preferredUsername, localMentions))
      : [],
    remoteMentions.length > 0
      ? db
          .select({
            apId: actorCache.apId,
            preferredUsername: actorCache.preferredUsername,
          })
          .from(actorCache)
          .where(
            inArray(
              actorCache.preferredUsername,
              remoteMentions.map((m) => m.split("@")[0]),
            ),
          )
      : [],
  ]);
  const localActorMap = new Map(
    localActors.map((a) => [a.preferredUsername, a.apId]),
  );

  const remoteActorMap = new Map<string, string>();
  for (const mention of remoteMentions) {
    const [username, domain] = mention.split("@");
    const matching = cachedActors.find(
      (a) => a.preferredUsername === username && a.apId.includes(domain),
    );
    if (matching) {
      remoteActorMap.set(mention, matching.apId);
    }
  }

  const activitiesToCreate: Array<{
    apId: string;
    type: string;
    actorApId: string;
    objectApId: string;
    rawJson: string;
    createdAt: string;
  }> = [];
  const inboxEntriesToCreate: Array<{
    actorApId: string;
    activityApId: string;
    read: number;
    createdAt: string;
  }> = [];

  for (const mention of mentions) {
    try {
      const mentionedActorApId = mention.includes("@")
        ? remoteActorMap.get(mention) || null
        : localActorMap.get(mention) || null;

      if (!mentionedActorApId || mentionedActorApId === params.actorApId) {
        continue;
      }
      if (params.parentAuthor === mentionedActorApId) continue;

      if (!isLocal(mentionedActorApId, params.baseUrl)) continue;

      const mentionActivityId = activityApId(params.baseUrl, generateId());
      activitiesToCreate.push({
        apId: mentionActivityId,
        type: "Create",
        actorApId: params.actorApId,
        objectApId: params.postApId,
        rawJson: JSON.stringify({
          "@context": "https://www.w3.org/ns/activitystreams",
          id: mentionActivityId,
          type: "Create",
          actor: params.actorApId,
          object: params.postApId,
        }),
        createdAt: params.now,
      });

      inboxEntriesToCreate.push({
        actorApId: mentionedActorApId,
        activityApId: mentionActivityId,
        read: 0,
        createdAt: params.now,
      });
    } catch (e) {
      log.error("Failed to process mention", {
        event: "posts.mention.processing_failed",
        mention,
        error: e,
      });
      mentionFailures.push({
        mention,
        stage: "resolve",
        reason: "mention_processing_failed",
      });
    }
  }

  if (activitiesToCreate.length > 0) {
    try {
      await db.insert(activities).values(activitiesToCreate);
    } catch (e) {
      log.error("Failed to persist mention activities", {
        event: "posts.mention.activity_persist_failed",
        error: e,
      });
      mentionFailures.push({
        mention: "__batch__",
        stage: "persist_activity",
        reason: "mention_activity_persist_failed",
      });
    }
  }
  if (inboxEntriesToCreate.length > 0) {
    try {
      await db.insert(inboxTable).values(inboxEntriesToCreate);
    } catch (e) {
      log.error("Failed to persist mention inbox entries", {
        event: "posts.mention.inbox_persist_failed",
        error: e,
      });
      mentionFailures.push({
        mention: "__batch__",
        stage: "persist_inbox",
        reason: "mention_inbox_persist_failed",
      });
    }
  }

  return mentionFailures;
}

// ---------------------------------------------------------------------------
// Edit validation
// ---------------------------------------------------------------------------

export type EditFieldsResult =
  | {
      ok: true;
      rawBody: Record<string, unknown>;
      body: { content?: string; summary?: string };
    }
  | { ok: false; error: string; code?: string };

/**
 * Parse and validate the request body for PATCH (edit post).
 * Returns a discriminated union with the parsed body or error details.
 */
export async function validateEditBody(c: {
  req: { json: () => Promise<unknown> };
}): Promise<EditFieldsResult> {
  const rawBody = await parseJsonObject(c);
  if (!rawBody) {
    return { ok: false, error: "Invalid request body", code: "BAD_REQUEST" };
  }

  for (const field of ["content", "summary"] as const) {
    const err = validateOptionalString(rawBody, field);
    if (err) return { ok: false, error: err, code: "BAD_REQUEST" };
  }

  const body: { content?: string; summary?: string } = {
    content: typeof rawBody.content === "string" ? rawBody.content : undefined,
    summary: typeof rawBody.summary === "string" ? rawBody.summary : undefined,
  };

  return { ok: true, rawBody, body };
}

type EditValidation =
  | { ok: true; trimmed?: string }
  | { ok: false; error: string };

function validateTrimmedEdit(
  value: string | undefined,
  label: string,
  maxLength: number,
  allowEmpty: boolean,
): EditValidation {
  if (value === undefined) return { ok: true };
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    return { ok: false, error: `${label} cannot be empty` };
  }
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      error: `${label} too long (max ${maxLength} chars)`,
    };
  }
  return { ok: true, trimmed };
}

/** Validate trimmed content length for editing. */
export function validateContentEdit(
  content: string | undefined,
): EditValidation {
  return validateTrimmedEdit(
    content,
    "Content",
    MAX_POST_CONTENT_LENGTH,
    false,
  );
}

/** Validate trimmed summary length for editing. */
export function validateSummaryEdit(
  summary: string | undefined,
): EditValidation {
  return validateTrimmedEdit(summary, "Summary", MAX_POST_SUMMARY_LENGTH, true);
}
