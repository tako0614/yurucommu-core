import { eq } from "drizzle-orm";

import {
  activities,
  objects,
  type D1Statement,
  type Database,
} from "../../../db/index.ts";
import { OBJECT_CONTEXT } from "../../lib/ap-context.ts";
import {
  activityApId,
  formatUsername,
  generateId,
  isLocal,
  isSafeRemoteUrl,
  safeJsonParse,
} from "../../federation-helpers.ts";
import { toApAttachments } from "../../lib/activitypub-helpers.ts";
import { enqueueDeliveryToActor } from "../../lib/delivery/queue.ts";
import { logger } from "../../lib/logger.ts";
import type { Env } from "../../types.ts";
import {
  persistPostMentionProjections,
  resolvePostMentions,
} from "./post-helpers.ts";
import {
  buildAddressing,
  buildCommunityObjectAddressing,
  mergeCc,
  persistActivity,
  persistAndFanout,
  persistAndFanoutToCommunity,
  preparePersistAndFanout,
  preparePersistAndFanoutToCommunity,
  type CommunityAddressingTarget,
  type MentionFailure,
  type PostAttachment,
  type PostTag,
  type ProcessMentionsResult,
} from "./queries.ts";

const log = logger.child({ component: "posts.federation" });
const PUBLIC_COLLECTION = "https://www.w3.org/ns/activitystreams#Public";

export type CreatedPostFederationInput = {
  db: Database;
  env: Env;
  actorApId: string;
  objectApId: string;
  content: string;
  summary: string | null;
  attachments?: PostAttachment[];
  inReplyTo: string | null;
  parentAuthor: string | null;
  visibility: string;
  community: CommunityAddressingTarget | null;
  published: string;
};

export type PreparedCreatedPostFederation = {
  readonly to: string[];
  readonly cc: string[];
  readonly audience: string[];
  readonly tags: PostTag[];
  readonly statements: readonly D1Statement[];
  complete(): Promise<{ mentionFailures: MentionFailure[] }>;
};

/**
 * Resolve and prepare a post's outbound Create without writing anything. The
 * caller co-commits these statements with the local Note/counter mutation,
 * then invokes complete() for best-effort Queue wakeups and notifications.
 */
export async function prepareCreatedPostFederation(
  input: CreatedPostFederationInput,
): Promise<PreparedCreatedPostFederation> {
  const {
    db,
    env,
    actorApId,
    objectApId: postApId,
    content,
    summary,
    attachments,
    inReplyTo,
    parentAuthor,
    visibility,
    community,
    published,
  } = input;
  const baseUrl = env.APP_URL;

  const {
    failures: mentionFailures,
    tags: mentionTags,
    mentionedActorApIds,
    remoteMentionedActorApIds,
  } = await resolvePostMentions(db, {
    content,
    actorApId,
    baseUrl,
  });
  const resolvedMentions: ProcessMentionsResult = {
    failures: mentionFailures,
    tags: mentionTags,
    mentionedActorApIds,
    remoteMentionedActorApIds,
  };

  // A non-direct reply must reach its parent author's instance even when the
  // body does not repeat an @mention. Direct reach remains explicit-only.
  const recipients = [...mentionedActorApIds];
  const remoteRecipients = [...remoteMentionedActorApIds];
  const tags = [...mentionTags];
  if (
    inReplyTo &&
    parentAuthor &&
    parentAuthor !== actorApId &&
    visibility !== "direct" &&
    !recipients.includes(parentAuthor)
  ) {
    recipients.push(parentAuthor);
    tags.push({
      type: "Mention",
      href: parentAuthor,
      name: `@${formatUsername(parentAuthor)}`,
    });
    if (!isLocal(parentAuthor, baseUrl)) remoteRecipients.push(parentAuthor);
  }

  // A plain direct Note with no resolved recipient has no federation reach.
  let to: string[];
  let cc: string[];
  let audience: string[] | undefined;
  if (visibility === "direct") {
    to = [];
    cc = [];
  } else if (community) {
    const addressing = buildCommunityObjectAddressing(visibility, community);
    to = addressing.to;
    cc = addressing.cc;
    audience = addressing.audience;
  } else {
    ({ to, cc } = buildAddressing(visibility, `${actorApId}/followers`));
  }
  cc = mergeCc(cc, recipients);

  const tag = tags.length > 0 ? tags : undefined;
  const createActivity = {
    "@context": OBJECT_CONTEXT,
    id: activityApId(baseUrl, generateId()),
    type: "Create",
    actor: actorApId,
    published,
    to,
    cc,
    ...(audience ? { audience } : {}),
    ...(tag ? { tag } : {}),
    object: {
      "@context": OBJECT_CONTEXT,
      id: postApId,
      type: "Note",
      attributedTo: actorApId,
      content,
      summary,
      ...(summary ? { sensitive: true } : {}),
      attachment: toApAttachments(attachments || [], baseUrl),
      inReplyTo,
      published,
      to,
      cc,
      ...(audience ? { audience } : {}),
      ...(tag ? { tag } : {}),
    },
  };

  let statements: readonly D1Statement[] = [];
  let publish = async () => {};
  // A plain direct Note with no resolved recipient has no federation reach and
  // therefore no outbound Activity. The local object still commits below.
  if (visibility === "direct" && mentionedActorApIds.length === 0) {
    statements = [];
  } else if (visibility === "direct") {
    statements = [
      db.insert(activities).values({
        apId: createActivity.id,
        type: createActivity.type,
        actorApId: createActivity.actor,
        objectApId: postApId,
        rawJson: JSON.stringify(createActivity),
        direction: "outbound",
      }) as D1Statement,
    ];
  } else if (community) {
    const prepared = await preparePersistAndFanoutToCommunity(
      db,
      env,
      createActivity,
      postApId,
      community.apId,
    );
    statements = prepared.statements;
    publish = prepared.publish;
  } else {
    const prepared = await preparePersistAndFanout(
      db,
      env,
      createActivity,
      postApId,
    );
    statements = prepared.statements;
    publish = prepared.publish;
  }

  return {
    to,
    cc,
    audience: audience ?? [],
    tags,
    statements,
    async complete() {
      await publish();

      const persistedMentionFailures = await persistPostMentionProjections(db, {
        result: resolvedMentions,
        postApId,
        actorApId,
        parentAuthor,
        baseUrl,
        now: published,
      });

      for (const recipient of new Set(remoteRecipients)) {
        try {
          await enqueueDeliveryToActor(env, createActivity.id, recipient);
        } catch (error) {
          log.error("Failed to enqueue explicit Create delivery", {
            event: "posts.create.delivery_enqueue_failed",
            activityId: createActivity.id,
            recipient,
            error,
          });
        }
      }

      return {
        mentionFailures: [...mentionFailures, ...persistedMentionFailures],
      };
    },
  };
}

export type DeletedPostFederationInput = {
  db: Database;
  env: Env;
  actorApId: string;
  post: {
    apId: string;
    inReplyTo: string | null;
    visibility: string;
    communityApId: string | null;
    toJson: string;
    ccJson: string;
  };
};

/** Persist and enqueue the outbound Tombstone Delete for a removed local Note. */
export async function federateDeletedPost(
  input: DeletedPostFederationInput,
): Promise<string> {
  const { db, env, actorApId, post } = input;
  const baseUrl = env.APP_URL;
  const originalTo = safeJsonParse<string[]>(post.toJson, []);
  const originalCc = safeJsonParse<string[]>(post.ccJson, []);
  const explicitRecipients = new Set<string>();

  for (const iri of [...originalTo, ...originalCc]) {
    if (
      iri &&
      iri !== PUBLIC_COLLECTION &&
      !iri.endsWith("/followers") &&
      !isLocal(iri, baseUrl) &&
      isSafeRemoteUrl(iri)
    ) {
      explicitRecipients.add(iri);
    }
  }

  if (post.inReplyTo) {
    const parent = await db
      .select({ attributedTo: objects.attributedTo })
      .from(objects)
      .where(eq(objects.apId, post.inReplyTo))
      .get();
    if (
      parent?.attributedTo &&
      !isLocal(parent.attributedTo, baseUrl) &&
      isSafeRemoteUrl(parent.attributedTo)
    ) {
      explicitRecipients.add(parent.attributedTo);
    }
  }

  const deleteActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityApId(baseUrl, generateId()),
    type: "Delete",
    actor: actorApId,
    to: originalTo,
    cc: originalCc,
    object: { id: post.apId, type: "Tombstone" },
  };

  // Direct objects were never broadcast to followers. Persist their Delete for
  // the ledger and send only to explicit recipients; follower fanout here would
  // disclose the existence and id of a private object.
  if (post.visibility === "direct") {
    await persistActivity(db, deleteActivity, post.apId);
  } else if (post.communityApId) {
    await persistAndFanoutToCommunity(
      db,
      env,
      deleteActivity,
      post.apId,
      post.communityApId,
    );
  } else {
    await persistAndFanout(db, env, deleteActivity, post.apId);
  }

  for (const recipient of explicitRecipients) {
    try {
      await enqueueDeliveryToActor(env, deleteActivity.id, recipient);
    } catch (error) {
      log.error("Failed to enqueue explicit Delete delivery", {
        event: "posts.delete.delivery_enqueue_failed",
        activityId: deleteActivity.id,
        recipient,
        error,
      });
    }
  }

  return deleteActivity.id;
}
