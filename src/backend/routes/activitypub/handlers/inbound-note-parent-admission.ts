import { eq, sql, type SQL } from "drizzle-orm";
import { objects, type Database } from "../../../../db/index.ts";
import { isLocal } from "../../../federation-helpers.ts";
import { isSameActivityPubActor } from "../../../lib/activitypub-actor-identity.ts";
import { personalActorNotSuppressedSql } from "../../../lib/personal-actor-moderation.ts";
import {
  actorSuppressesInteractionFrom,
  canViewerReadObjectFull,
  postReadAdmissionSql,
  type PostReadAdmission,
} from "../../../lib/post-visibility.ts";

export type InboundNoteParentAdmission = {
  objectId: string;
  actor: string;
  read: PostReadAdmission | null;
  localOwner: string | null;
};

/** Use the actual canonical parent read and its current owner policy. */
export async function readInboundNoteParent(
  db: Database,
  objectId: string | null,
  actor: string,
  baseUrl: string,
): Promise<
  { allowed: true; admission?: InboundNoteParentAdmission } | { allowed: false }
> {
  if (!objectId) return { allowed: true };
  const parent = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (!parent)
    return {
      allowed: true,
      admission: { objectId, actor, read: null, localOwner: null },
    };
  if (parent.deletedAt !== null) return { allowed: false };
  const captured: { read?: PostReadAdmission } = {};
  if (
    !(await canViewerReadObjectFull(db, parent, actor, (read) => {
      captured.read = read;
    }))
  )
    return { allowed: false };
  const localOwner = isLocal(parent.attributedTo, baseUrl)
    ? parent.attributedTo
    : null;
  if (
    localOwner &&
    (await actorSuppressesInteractionFrom(db, localOwner, actor))
  )
    return { allowed: false };
  if (!captured.read)
    throw new Error(
      "Allowed parent read did not retain its actual dependencies",
    );
  return {
    allowed: true,
    admission: { objectId, actor, read: captured.read, localOwner },
  };
}

/** Absence, reach and all current authority dependencies share the child batch. */
export function inboundNoteParentAdmissionSql(
  admission: InboundNoteParentAdmission | undefined,
  parentId: string | null,
  actor: string,
): SQL {
  if (!admission) return sql`1`;
  if (
    admission.objectId !== parentId ||
    !isSameActivityPubActor(admission.actor, actor) ||
    (admission.read &&
      (admission.read.object.apId !== parentId ||
        !isSameActivityPubActor(admission.read.viewer, actor)))
  ) {
    throw new Error("Parent read admission identity mismatch");
  }
  if (!admission.read)
    return sql`NOT EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.apId} = ${parentId})`;
  return sql`(${postReadAdmissionSql(admission.read)})
    AND EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.apId} = ${parentId} AND ${objects.deletedAt} IS NULL)
    AND ${admission.localOwner ? personalActorNotSuppressedSql(sql`${actor}`, sql`${admission.localOwner}`) : sql`1`}`;
}
