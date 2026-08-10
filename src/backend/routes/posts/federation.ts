import { eq } from "drizzle-orm";

import { objects, type Database } from "../../../db/index.ts";
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
import { processMentions } from "./post-helpers.ts";
import {
  buildAddressing,
  buildCommunityObjectAddressing,
  mergeCc,
  persistActivity,
  persistAndFanout,
  persistAndFanoutToCommunity,
  type CommunityAddressingTarget,
  type MentionFailure,
  type PostAttachment,
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

/**
 * Build, persist, address, and enqueue the outbound Create for one already
 * committed local Note. Both the human post route and the Takos agent tool use
 * this owner so a client surface cannot silently become local-only.
 */
export async function federateCreatedPost(
  input: CreatedPostFederationInput,
): Promise<{ mentionFailures: MentionFailure[] }> {
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
  } = await processMentions(db, {
    content,
    postApId,
    actorApId,
    parentAuthor,
    baseUrl,
    now: published,
  });

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
  if (visibility === "direct" && mentionedActorApIds.length === 0) {
    return { mentionFailures };
  }

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

  // Persist the exact final addressing carried by the Create. This gives the
  // canonical object endpoint and a later Delete the same recipient evidence,
  // including explicit remote mentions that follower fanout cannot recover.
  await db
    .update(objects)
    .set({
      toJson: JSON.stringify(to),
      ccJson: JSON.stringify(cc),
      ...(audience ? { audienceJson: JSON.stringify(audience) } : {}),
    })
    .where(eq(objects.apId, postApId));

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

  if (visibility === "direct") {
    await persistActivity(db, createActivity, postApId);
  } else if (community) {
    await persistAndFanoutToCommunity(
      db,
      env,
      createActivity,
      postApId,
      community.apId,
    );
  } else {
    await persistAndFanout(db, env, createActivity, postApId);
  }

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

  return { mentionFailures };
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
