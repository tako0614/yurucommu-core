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
  insertMany,
  objects,
  runBatch,
  type D1Statement,
} from "../../../db/index.ts";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import {
  activityApId,
  formatUsername,
  generateId,
  isLocal,
} from "../../federation-helpers.ts";
import {
  extractHashtags,
  extractMentions,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_JSON_LENGTH,
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_SUMMARY_LENGTH,
} from "./transformers.ts";
import {
  type CreatePostBody,
  isRecord,
  type MentionFailure,
  type PostTag,
  parseJsonObject,
  type PostAttachment,
  type ProcessMentionsResult,
  validateOptionalString,
} from "./queries.ts";
import { logger } from "../../lib/logger.ts";
import { chunkForInClause } from "../../lib/chunk.ts";

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
  // Bound the attachments payload (count + serialized size). content/summary are
  // length-capped above; without this an attachments blob could carry up to the
  // global 1 MiB body cap into the stored row and every federated delivery.
  if (Array.isArray(rawBody.attachments)) {
    if (rawBody.attachments.length > MAX_ATTACHMENTS) {
      return {
        ok: false,
        error: `Too many attachments (max ${MAX_ATTACHMENTS})`,
        code: "BAD_REQUEST",
      };
    }
    if (
      JSON.stringify(rawBody.attachments).length > MAX_ATTACHMENTS_JSON_LENGTH
    ) {
      return {
        ok: false,
        error: "attachments payload too large",
        code: "BAD_REQUEST",
      };
    }
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

export type CommunityTarget = {
  apId: string;
  followersUrl: string;
};

export type CommunityCheckResult =
  | {
      allowed: true;
      communityId: string | null;
      community: CommunityTarget | null;
    }
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
  if (!communityApId) {
    return { allowed: true, communityId: null, community: null };
  }

  const community = await db
    .select({
      apId: communities.apId,
      followersUrl: communities.followersUrl,
      postPolicy: communities.postPolicy,
      visibility: communities.visibility,
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

  // A non-public community requires membership to WRITE regardless of
  // post_policy. Read access is membership-gated (canViewerReadObject /
  // checkReadAccess), so without this a private community with
  // post_policy="anyone" would let a non-member who CANNOT read it inject posts.
  if ((community.visibility ?? "public") !== "public" && !membership) {
    return { allowed: false, error: "Not a community member", status: 403 };
  }
  if (policy !== "anyone" && !membership) {
    return { allowed: false, error: "Not a community member", status: 403 };
  }
  if (policy === "mods" && !isManager) {
    return { allowed: false, error: "Moderator role required", status: 403 };
  }
  if (policy === "owners" && role !== "owner") {
    return { allowed: false, error: "Owner role required", status: 403 };
  }

  return {
    allowed: true,
    communityId: community.apId,
    community: {
      apId: community.apId,
      followersUrl: community.followersUrl,
    },
  };
}

// ---------------------------------------------------------------------------
// Reply handling
// ---------------------------------------------------------------------------

/**
 * Prepare every local statement owned by post creation without executing it.
 * The route composes these statements with the outbound Create Activity and
 * durable fanout intent in one D1 batch.
 */
export function preparePostInsertStatements(
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
    to: string[];
    cc: string[];
    audience: string[];
    tags: PostTag[];
    parentAuthor: string | null;
    baseUrl: string;
    now: string;
  },
): [D1Statement, ...D1Statement[]] {
  // Co-commit the object insert + author postCount++ + parent replyCount recompute
  // in ONE batch (mirrors the federated handleCreate): a crash between separate
  // autocommits would otherwise leave the object inserted with an un-bumped
  // postCount (permanent under-count). postCount++ is guarded NOT EXISTS(object)
  // so a retry can't double-count; the parent replyCount is RECOMPUTED from
  // COUNT(*) of the reply edge set — exact and idempotent.
  const objectAbsent = sql`NOT EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.apId} = ${params.apId})`;
  const insertObject = db.insert(objects).values({
    apId: params.apId,
    type: "Note",
    attributedTo: params.actorApId,
    content: params.content,
    summary: params.summary,
    attachmentsJson: JSON.stringify(params.attachments || []),
    inReplyTo: params.inReplyTo,
    visibility: params.visibility,
    communityApId: params.communityId,
    toJson: JSON.stringify(params.to),
    ccJson: JSON.stringify(params.cc),
    audienceJson: JSON.stringify(params.audience),
    tagsJson: JSON.stringify(params.tags),
    published: params.now,
    isLocal: 1,
  }) as D1Statement;
  const bumpPostCount = db
    .update(actors)
    .set({ postCount: sql`${actors.postCount} + 1` })
    .where(and(eq(actors.apId, params.actorApId), objectAbsent)) as D1Statement;

  // Direct (DM) posts do NOT count toward postCount: the dedicated DM send path
  // (createDmNote) never bumps it, and the generic DELETE skips the decrement for
  // visibility==='direct'. A direct post created through the generic POST /posts
  // must therefore skip the bump too — otherwise create/delete are asymmetric and
  // postCount over-counts permanently.
  const countStmts = params.visibility === "direct" ? [] : [bumpPostCount];

  const statements: D1Statement[] = [...countStmts, insertObject];
  if (params.inReplyTo) {
    const parentId = params.inReplyTo;
    statements.push(
      db
        .update(objects)
        .set({
          replyCount: sql`(SELECT COUNT(*) FROM ${objects} WHERE ${objects.inReplyTo} = ${parentId})`,
        })
        .where(eq(objects.apId, parentId)) as D1Statement,
    );
  }

  if (params.inReplyTo && params.parentAuthor) {
    if (
      params.parentAuthor !== params.actorApId &&
      isLocal(params.parentAuthor, params.baseUrl)
    ) {
      const replyActivityId = activityApId(params.baseUrl, generateId());
      statements.push(
        db.insert(activities).values({
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
        }) as D1Statement,
        db.insert(inboxTable).values({
          actorApId: params.parentAuthor,
          activityApId: replyActivityId,
          read: 0,
          createdAt: params.now,
        }) as D1Statement,
      );
    }
  }

  return statements as [D1Statement, ...D1Statement[]];
}

// ---------------------------------------------------------------------------
// Mention processing
// ---------------------------------------------------------------------------

/**
 * Extract @mentions from content, resolve them to actor AP IDs (local AND
 * remote), build the `Mention` tag array for the outbound Note/Create, create
 * notification activities for LOCAL mentioned actors, and return the resolved
 * actor IRIs so the caller can address (`cc`) and deliver (remote inbox) the
 * Create to every mentioned actor.
 *
 * Remote mentioned actors do not get a local inbox row — they are reached by
 * federated delivery, which the caller enqueues via `enqueueDeliveryToActor`.
 */

// Match a cached actor's apId HOST against a mention's `@domain`. A substring
// test (`apId.includes(domain)`) would resolve a `@user@host.com` mention to a
// hostile actor whose apId merely CONTAINS the host (e.g.
// `https://host.com.attacker.test/users/user`), misdirecting the cc + the
// federated delivery (and, for a followers-only/direct post, handing read access
// to the wrong actor via isExplicitRecipient). Compare the parsed host exactly.
function actorHostMatches(apId: string, domain: string): boolean {
  try {
    return new URL(apId).host.toLowerCase() === domain.toLowerCase();
  } catch {
    return false;
  }
}

type MentionActorRow = { apId: string; preferredUsername: string | null };

/**
 * Resolve the local (`actors`) and cached-remote (`actor_cache`) rows for the
 * mention tokens of a post. Both lookups are CHUNKED via chunkForInClause: post
 * content allows >100 distinct `@token`s within MAX_POST_CONTENT_LENGTH, and an
 * unchunked `inArray` over that list binds >100 params, exceeding Cloudflare
 * D1's 100-bound-parameter ceiling ("too many SQL variables") — a prod-only
 * failure invisible to the libsql/better-sqlite3 test driver. `remoteMentions`
 * are `user@host` tokens; only their username part is matched here (the caller
 * disambiguates the host).
 */
async function resolveMentionActorRows(
  db: Database,
  localMentions: string[],
  remoteMentions: string[],
): Promise<{
  localActors: MentionActorRow[];
  cachedActors: MentionActorRow[];
}> {
  const remoteUsernames = remoteMentions.map((m) => m.split("@")[0]);
  const [localActors, cachedActors] = await Promise.all([
    localMentions.length > 0
      ? Promise.all(
          chunkForInClause(localMentions).map((chunk) =>
            db
              .select({
                apId: actors.apId,
                preferredUsername: actors.preferredUsername,
              })
              .from(actors)
              .where(inArray(actors.preferredUsername, chunk)),
          ),
        ).then((rows) => rows.flat())
      : [],
    remoteUsernames.length > 0
      ? Promise.all(
          chunkForInClause(remoteUsernames).map((chunk) =>
            db
              .select({
                apId: actorCache.apId,
                preferredUsername: actorCache.preferredUsername,
              })
              .from(actorCache)
              .where(inArray(actorCache.preferredUsername, chunk)),
          ),
        ).then((rows) => rows.flat())
      : [],
  ]);
  return { localActors, cachedActors };
}

export async function resolvePostMentions(
  db: Database,
  params: {
    content: string;
    actorApId: string;
    baseUrl: string;
  },
): Promise<ProcessMentionsResult> {
  const mentions = extractMentions(params.content);
  const mentionFailures: MentionFailure[] = [];
  const tags: PostTag[] = [];
  const mentionedActorApIds: string[] = [];
  const remoteMentionedActorApIds: string[] = [];
  const seenMentioned = new Set<string>();

  // Hashtags federate as standard AS2 `Hashtag` tags (independent of mention
  // resolution) so remote servers can index the post. `href` points at this
  // instance's tag search page (the same destination the web client links to).
  const baseHref = params.baseUrl.replace(/\/+$/, "");
  for (const tag of extractHashtags(params.content)) {
    tags.push({
      type: "Hashtag",
      href: `${baseHref}/search?search=${encodeURIComponent(`#${tag}`)}`,
      name: `#${tag}`,
    });
  }

  const result: ProcessMentionsResult = {
    failures: mentionFailures,
    tags,
    mentionedActorApIds,
    remoteMentionedActorApIds,
  };

  if (mentions.length === 0) return result;

  const localMentions = mentions.filter((m) => !m.includes("@"));
  const remoteMentions = mentions.filter((m) => m.includes("@"));

  const { localActors, cachedActors } = await resolveMentionActorRows(
    db,
    localMentions,
    remoteMentions,
  );
  const localActorMap = new Map(
    localActors.map((a) => [a.preferredUsername, a.apId]),
  );

  const remoteActorMap = new Map<string, string>();
  for (const mention of remoteMentions) {
    const [username, domain] = mention.split("@");
    const matching = cachedActors.find(
      (a) =>
        a.preferredUsername === username && actorHostMatches(a.apId, domain),
    );
    if (matching) {
      remoteActorMap.set(mention, matching.apId);
    }
  }

  for (const mention of mentions) {
    try {
      const mentionedActorApId = mention.includes("@")
        ? remoteActorMap.get(mention) || null
        : localActorMap.get(mention) || null;

      if (!mentionedActorApId || mentionedActorApId === params.actorApId) {
        continue;
      }

      const remote = !isLocal(mentionedActorApId, params.baseUrl);

      // Every resolved mention (local + remote) gets a `Mention` tag and is
      // recorded as a recipient so the caller can address (`cc`) and — for
      // remote actors — deliver the Create to it. `name` uses the canonical
      // `@user@host` acct form so receiving servers can render/notify.
      if (!seenMentioned.has(mentionedActorApId)) {
        seenMentioned.add(mentionedActorApId);
        tags.push({
          type: "Mention",
          href: mentionedActorApId,
          name: `@${formatUsername(mentionedActorApId)}`,
        });
        mentionedActorApIds.push(mentionedActorApId);
        if (remote) remoteMentionedActorApIds.push(mentionedActorApId);
      }
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

  return result;
}

/**
 * Persist the local-notification projections for an already resolved post.
 * The canonical Note, tags, Activity, and fanout intent are committed by the
 * caller first; notification failures are reported without invalidating that
 * durable federation mutation.
 */
export async function persistPostMentionProjections(
  db: Database,
  params: {
    result: ProcessMentionsResult;
    postApId: string;
    actorApId: string;
    parentAuthor: string | null;
    baseUrl: string;
    now: string;
  },
): Promise<MentionFailure[]> {
  const failures: MentionFailure[] = [];
  const remoteActors = new Set(params.result.remoteMentionedActorApIds);
  const localNotificationTargets = params.result.mentionedActorApIds.filter(
    (actorApId) =>
      actorApId !== params.parentAuthor && !remoteActors.has(actorApId),
  );

  const activitiesToCreate = localNotificationTargets.map((actorApId) => {
    const mentionActivityId = activityApId(params.baseUrl, generateId());
    return {
      activity: {
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
      },
      inbox: {
        actorApId,
        activityApId: mentionActivityId,
        read: 0,
        createdAt: params.now,
      },
    };
  });

  if (activitiesToCreate.length > 0) {
    // A mention notification is one invariant: its activity and inbox edge
    // either both exist or neither does. Build D1-safe chunked INSERT
    // statements, then commit each bounded page as one atomic batch. This
    // avoids both the 100-bind ceiling and the old activity-without-inbox
    // partial state when the second independent INSERT failed.
    const MENTION_NOTIFICATION_PAGE_SIZE = 200;
    try {
      for (
        let offset = 0;
        offset < activitiesToCreate.length;
        offset += MENTION_NOTIFICATION_PAGE_SIZE
      ) {
        const page = activitiesToCreate.slice(
          offset,
          offset + MENTION_NOTIFICATION_PAGE_SIZE,
        );
        const statements = [
          ...insertMany(
            db,
            activities,
            page.map((entry) => entry.activity),
          ),
          ...insertMany(
            db,
            inboxTable,
            page.map((entry) => entry.inbox),
          ),
        ];
        await runBatch(db, statements as [D1Statement, ...D1Statement[]]);
      }
    } catch (e) {
      log.error("Failed to atomically persist mention notifications", {
        event: "posts.mention.notification_persist_failed",
        error: e,
      });
      failures.push(
        {
          mention: "__batch__",
          stage: "persist_activity",
          reason: "mention_activity_persist_failed",
        },
        {
          mention: "__batch__",
          stage: "persist_inbox",
          reason: "mention_inbox_persist_failed",
        },
      );
    }
  }

  return failures;
}

/**
 * Derive the AS2 `tag` array (Hashtag + Mention) for a post's content WITHOUT
 * any notification / activity side effects. The EDIT path uses this so an
 * edited post's served object + Update(Note) carry the SAME tags a fresh post
 * would — re-running notification projection on every edit would re-notify
 * every mention. Mirrors resolvePostMentions' tag-building.
 */
export async function deriveContentTags(
  db: Database,
  content: string,
  baseUrl: string,
  actorApId: string,
): Promise<PostTag[]> {
  const tags: PostTag[] = [];

  const baseHref = baseUrl.replace(/\/+$/, "");
  for (const tag of extractHashtags(content)) {
    tags.push({
      type: "Hashtag",
      href: `${baseHref}/search?search=${encodeURIComponent(`#${tag}`)}`,
      name: `#${tag}`,
    });
  }

  const mentions = extractMentions(content);
  if (mentions.length === 0) return tags;

  const localMentions = mentions.filter((m) => !m.includes("@"));
  const remoteMentions = mentions.filter((m) => m.includes("@"));

  const { localActors, cachedActors } = await resolveMentionActorRows(
    db,
    localMentions,
    remoteMentions,
  );
  const localActorMap = new Map(
    localActors.map((a) => [a.preferredUsername, a.apId]),
  );
  const remoteActorMap = new Map<string, string>();
  for (const mention of remoteMentions) {
    const [username, domain] = mention.split("@");
    const matching = cachedActors.find(
      (a) =>
        a.preferredUsername === username && actorHostMatches(a.apId, domain),
    );
    if (matching) remoteActorMap.set(mention, matching.apId);
  }

  const seen = new Set<string>();
  for (const mention of mentions) {
    const apId = mention.includes("@")
      ? remoteActorMap.get(mention) || null
      : localActorMap.get(mention) || null;
    if (!apId || apId === actorApId || seen.has(apId)) continue;
    seen.add(apId);
    tags.push({
      type: "Mention",
      href: apId,
      name: `@${formatUsername(apId)}`,
    });
  }
  return tags;
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
  { ok: true; trimmed?: string } | { ok: false; error: string };

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
