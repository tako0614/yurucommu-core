import { and, count, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "../../../db/index.ts";
import { activities, inbox, likes, objects } from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import { activityApId, generateId, isLocal } from "../../federation-helpers.ts";
import { activityDeleteCascadeStatements } from "../../lib/activity-delete-cascade.ts";
import { enqueueDeliveryToActor } from "../../lib/delivery/queue.ts";
import { logger } from "../../lib/logger.ts";
import { isUniqueConstraintError } from "../../lib/parse-helpers.ts";

const log = logger.child({ component: "posts.like_mutation" });

type BatchStatement = BatchItem<"sqlite">;
type BatchableDb = {
  batch(
    statements: readonly [BatchStatement, ...BatchStatement[]],
  ): Promise<unknown>;
};

export type LikeTarget = {
  apId: string;
  attributedTo: string;
};

export type PostLikeMutationResult = {
  active: boolean;
  changed: boolean;
  likeCount: number;
};

async function readLikeCount(
  db: Database,
  objectApId: string,
): Promise<number> {
  const row = await db
    .select({ count: count() })
    .from(likes)
    .where(eq(likes.objectApId, objectApId))
    .get();
  return row?.count ?? 0;
}

async function enqueueRemoteInteraction(
  env: Env,
  activityId: string,
  recipientApId: string,
  type: "Like" | "Undo",
): Promise<void> {
  try {
    await enqueueDeliveryToActor(env, activityId, recipientApId);
  } catch (error) {
    log.error("Failed to enqueue post interaction", {
      event: "posts.like_mutation.enqueue_failed",
      type,
      activityId,
      recipient: recipientApId,
      error,
    });
  }
}

/**
 * Set one actor's Like edge and all of its durable Activity/notification state.
 *
 * Web and agent callers deliberately keep their own response semantics: this
 * owner reports whether the requested state changed, so HTTP may reject a
 * duplicate while the Takos tool remains safely idempotent.
 */
export async function setPostLike(input: {
  db: Database;
  env: Env;
  actorApId: string;
  post: LikeTarget;
  active: boolean;
}): Promise<PostLikeMutationResult> {
  const { db, env, actorApId, post, active } = input;
  const existing = await db
    .select({ activityApId: likes.activityApId })
    .from(likes)
    .where(and(eq(likes.actorApId, actorApId), eq(likes.objectApId, post.apId)))
    .get();

  if (active) {
    if (existing) {
      return {
        active: true,
        changed: false,
        likeCount: await readLikeCount(db, post.apId),
      };
    }

    const now = new Date().toISOString();
    const likeActivityId = activityApId(env.APP_URL, generateId());
    const raw = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: likeActivityId,
      type: "Like",
      actor: actorApId,
      object: post.apId,
    };
    const statements: BatchStatement[] = [
      db.insert(likes).values({
        actorApId,
        objectApId: post.apId,
        activityApId: likeActivityId,
        createdAt: now,
      }),
      db
        .update(objects)
        .set({
          likeCount: sql`(SELECT COUNT(*) FROM ${likes} WHERE ${likes.objectApId} = ${post.apId})`,
        })
        .where(eq(objects.apId, post.apId)),
      db.insert(activities).values({
        apId: likeActivityId,
        type: "Like",
        actorApId,
        objectApId: post.apId,
        rawJson: JSON.stringify(raw),
        direction: "outbound",
        createdAt: now,
      }),
    ];
    if (
      post.attributedTo !== actorApId &&
      isLocal(post.attributedTo, env.APP_URL)
    ) {
      statements.push(
        db.insert(inbox).values({
          actorApId: post.attributedTo,
          activityApId: likeActivityId,
          read: 0,
          createdAt: now,
        }),
      );
    }

    try {
      await (db as unknown as BatchableDb).batch(
        statements as [BatchStatement, ...BatchStatement[]],
      );
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      return {
        active: true,
        changed: false,
        likeCount: await readLikeCount(db, post.apId),
      };
    }

    if (!isLocal(post.apId, env.APP_URL)) {
      await enqueueRemoteInteraction(
        env,
        likeActivityId,
        post.attributedTo,
        "Like",
      );
    }
    return {
      active: true,
      changed: true,
      likeCount: await readLikeCount(db, post.apId),
    };
  }

  if (!existing) {
    return {
      active: false,
      changed: false,
      likeCount: await readLikeCount(db, post.apId),
    };
  }

  const remote = !isLocal(post.apId, env.APP_URL);
  const undoActivityId = remote
    ? activityApId(env.APP_URL, generateId())
    : null;
  const undoObject = existing.activityApId
    ? existing.activityApId
    : { type: "Like", actor: actorApId, object: post.apId };
  const undoRaw = undoActivityId
    ? {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: undoActivityId,
        type: "Undo",
        actor: actorApId,
        object: undoObject,
      }
    : null;
  const reapOriginal = existing.activityApId
    ? activityDeleteCascadeStatements(
        db,
        eq(activities.apId, existing.activityApId),
      )
    : [];
  const statements: BatchStatement[] = [
    db
      .delete(likes)
      .where(
        and(eq(likes.actorApId, actorApId), eq(likes.objectApId, post.apId)),
      ),
    db
      .update(objects)
      .set({
        likeCount: sql`(SELECT COUNT(*) FROM ${likes} WHERE ${likes.objectApId} = ${post.apId})`,
      })
      .where(eq(objects.apId, post.apId)),
    ...reapOriginal,
  ];
  if (undoActivityId && undoRaw) {
    statements.push(
      db.insert(activities).values({
        apId: undoActivityId,
        type: "Undo",
        actorApId,
        objectApId: post.apId,
        rawJson: JSON.stringify(undoRaw),
        direction: "outbound",
      }),
    );
  }
  await (db as unknown as BatchableDb).batch(
    statements as [BatchStatement, ...BatchStatement[]],
  );

  if (undoActivityId) {
    await enqueueRemoteInteraction(
      env,
      undoActivityId,
      post.attributedTo,
      "Undo",
    );
  }
  return {
    active: false,
    changed: true,
    likeCount: await readLikeCount(db, post.apId),
  };
}
