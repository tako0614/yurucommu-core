import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  actors,
  communities,
  insertMany,
  objectRecipients,
  objects,
  runBatch,
  type Database,
  type D1Statement,
} from "../../../../db/index.ts";
import { isLocal } from "../../../federation-helpers.ts";
import { isSameActivityPubActor } from "../../../lib/activitypub-actor-identity.ts";
import {
  guardInboundNoteUpdateWindow,
  inboundNoteUpdateCommitStatements,
  type AdmittedNotePatch,
  type NoteUpdateWindow,
} from "../../../lib/inbound-note-update-order.ts";
import { anyOwnerSuppressesInboundActor } from "../../../lib/personal-actor-moderation.ts";
import {
  actorSuppressesInteractionFrom,
  canViewerReadObjectFull,
} from "../../../lib/post-visibility.ts";
import { getConversationId } from "../../dm/query-helpers.ts";
import {
  boundInboundContent,
  boundInboundNoteAttachmentsJson,
  boundInboundSummary,
  boundInboundTagsJson,
} from "../../posts/transformers.ts";
import {
  addressesPublic,
  collectBoundedInboundAddresses,
} from "../inbound-addressing.ts";
import type { ActivityObject } from "../inbox-types.ts";
import {
  canActorPostToInboundCommunity,
  inboundCommunityAdmissionsSql,
  resolveInboundCommunityScope,
  type InboundCommunityAdmission,
} from "./inbound-community-scope.ts";
import { validateInboundReplyTarget } from "./inbound-reply-target.ts";

export type NoteProjection = Pick<
  typeof objects.$inferSelect,
  | "apId"
  | "type"
  | "attributedTo"
  | "isLocal"
  | "deletedAt"
  | "content"
  | "summary"
  | "attachmentsJson"
  | "tagsJson"
  | "inReplyTo"
  | "conversation"
  | "visibility"
  | "toJson"
  | "ccJson"
  | "audienceJson"
  | "communityApId"
  | "published"
  | "updated"
  | "endTime"
> & {
  recipients: { recipientApId: string; type: string }[];
  communityAdmissions?: InboundCommunityAdmission[];
};

export function noteAddressList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === "string"))]
    : [];
}

export function noteVisibility(
  addressing: NonNullable<AdmittedNotePatch["addressing"]>,
): "public" | "unlisted" | "followers" | "direct" {
  if (addressesPublic(addressing.to)) return "public";
  if (addressesPublic(addressing.cc)) return "unlisted";
  const all = [
    ...addressing.to,
    ...addressing.cc,
    ...addressing.bto,
    ...addressing.bcc,
  ];
  if (addressesPublic(all)) return "public";
  return all.some((a) => a.endsWith("/followers")) ? "followers" : "direct";
}

export function noteSpecificRecipients(
  addressing: NonNullable<AdmittedNotePatch["addressing"]>,
): string[] {
  return [
    ...new Set([
      ...addressing.to,
      ...addressing.cc,
      ...addressing.bto,
      ...addressing.bcc,
    ]),
  ].filter((a) => !addressesPublic([a]) && !a.endsWith("/followers"));
}

/** Preserve absence versus explicit clearing before a signed event is admitted. */
export function normalizeNoteUpdatePatch(
  object: ActivityObject,
): AdmittedNotePatch | null {
  if (!collectBoundedInboundAddresses([object]).ok) return null;
  const reply = validateInboundReplyTarget(object.inReplyTo);
  if (!reply.ok || reply.parentId === object.id) return null;
  const patch: AdmittedNotePatch = {};
  if (object.content !== undefined)
    patch.content = boundInboundContent(object.content);
  if (object.summary !== undefined)
    patch.summary = boundInboundSummary(object.summary);
  if (object.attachment !== undefined)
    patch.attachmentsJson = boundInboundNoteAttachmentsJson(object.attachment);
  if (object.tag !== undefined)
    patch.tagsJson = boundInboundTagsJson(object.tag);
  if (
    [object.to, object.cc, object.bto, object.bcc].some((v) => v !== undefined)
  )
    patch.addressing = {
      to: noteAddressList(object.to),
      cc: noteAddressList(object.cc),
      bto: noteAddressList(object.bto),
      bcc: noteAddressList(object.bcc),
    };
  if (object.audience !== undefined)
    patch.audience = noteAddressList(object.audience);
  if (reply.parentId !== undefined) patch.inReplyTo = reply.parentId;
  if (object.room !== undefined && object.room !== null && object.room !== "") {
    if (typeof object.room !== "string" || object.room.length > 2048)
      return null;
    patch.room = object.room;
  }
  return patch;
}

const PATCH_FIELDS = new Set([
  "content",
  "summary",
  "attachmentsJson",
  "tagsJson",
  "addressing",
  "audience",
  "inReplyTo",
  "room",
]);

/** Corrupt/unknown admitted state is retryable, never a made-up successful no-op. */
export function decodeNoteUpdatePatch(json: string | null): AdmittedNotePatch {
  if (json === null) throw new Error("Pending Note update lost its projection");
  const p: unknown = JSON.parse(json);
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw new Error("Invalid admitted Note patch");
  const raw = p as Record<string, unknown>;
  if (Object.keys(raw).some((k) => !PATCH_FIELDS.has(k)))
    throw new Error("Unknown admitted Note patch format");
  for (const key of ["content", "attachmentsJson", "tagsJson", "room"]) {
    if (raw[key] !== undefined && typeof raw[key] !== "string")
      throw new Error("Invalid admitted Note field");
  }
  for (const key of ["summary", "inReplyTo"]) {
    if (
      raw[key] !== undefined &&
      raw[key] !== null &&
      typeof raw[key] !== "string"
    )
      throw new Error("Invalid admitted Note nullable field");
  }
  if (
    raw.audience !== undefined &&
    (!Array.isArray(raw.audience) ||
      raw.audience.some((v) => typeof v !== "string"))
  )
    throw new Error("Invalid admitted Note audience");
  if (raw.addressing !== undefined) {
    if (
      !raw.addressing ||
      typeof raw.addressing !== "object" ||
      Array.isArray(raw.addressing)
    )
      throw new Error("Invalid admitted Note addressing");
    const a = raw.addressing as Record<string, unknown>;
    if (
      Object.keys(a).some((k) => !["to", "cc", "bto", "bcc"].includes(k)) ||
      ["to", "cc", "bto", "bcc"].some(
        (k) =>
          !Array.isArray(a[k]) ||
          (a[k] as unknown[]).some((v) => typeof v !== "string"),
      )
    )
      throw new Error("Invalid admitted Note address field");
  }
  const patch = raw as AdmittedNotePatch;
  if (
    !collectBoundedInboundAddresses([
      { ...patch.addressing, audience: patch.audience },
    ]).ok
  )
    throw new Error("Unbounded admitted Note addressing");
  if (
    !validateInboundReplyTarget(patch.inReplyTo).ok ||
    (patch.room !== undefined && patch.room.length > 2048)
  )
    throw new Error("Invalid admitted Note target");
  for (const json of [patch.attachmentsJson, patch.tagsJson]) {
    if (json !== undefined && !Array.isArray(JSON.parse(json)))
      throw new Error("Invalid admitted Note array projection");
  }
  return patch;
}

/** Current policy is checked for every partial patch against the preceding projection. */
export async function projectAdmittedNotePatch(
  db: Database,
  source: NoteProjection,
  patch: AdmittedNotePatch,
  actor: string,
  baseUrl: string,
): Promise<NoteProjection | null> {
  if (
    source.type !== "Note" ||
    source.deletedAt !== null ||
    !isSameActivityPubActor(source.attributedTo, actor)
  )
    return null;
  if (await anyOwnerSuppressesInboundActor(db, actor)) return null;

  let communityApId = source.communityApId;
  const admissions = new Map(
    (source.communityAdmissions ?? []).map((a) => [a.apId, a]),
  );
  const admit = (admission: InboundCommunityAdmission) => {
    admissions.set(admission.apId, admission);
  };
  if (source.visibility === "group") {
    const audience = noteAddressList(JSON.parse(source.audienceJson));
    if (audience.length !== 1) return null;
    const community = await db
      .select()
      .from(communities)
      .where(
        and(eq(communities.apId, audience[0]), isNull(communities.deletedAt)),
      )
      .get();
    if (
      !community ||
      !(await canActorPostToInboundCommunity(db, actor, community, admit))
    )
      return null;
    if (
      patch.audience &&
      (patch.audience.length !== 1 || patch.audience[0] !== community.apId)
    )
      return null;
    if (
      patch.addressing &&
      [
        ...patch.addressing.to,
        ...patch.addressing.cc,
        ...patch.addressing.bto,
        ...patch.addressing.bcc,
      ].some((a) => a !== community.apId && a !== community.followersUrl)
    )
      return null;
    if (patch.room) {
      const room = patch.room.match(/\/ap\/rooms\/([^/]+)$/)?.[1];
      if (room !== community.preferredUsername && room !== community.apId)
        return null;
    }
    if (patch.inReplyTo !== undefined && patch.inReplyTo !== source.inReplyTo)
      return null;
  } else {
    if (patch.room !== undefined) return null;
    const scope =
      patch.audience !== undefined
        ? await resolveInboundCommunityScope(db, actor, patch.audience, admit)
        : source.communityApId
          ? await resolveInboundCommunityScope(
              db,
              actor,
              [source.communityApId],
              admit,
            )
          : { allowed: true as const, communityApId: null };
    if (
      !scope.allowed ||
      (patch.audience === undefined &&
        scope.communityApId !== source.communityApId)
    )
      return null;
    communityApId = scope.communityApId;
  }
  if (patch.inReplyTo) {
    const parent = await db
      .select()
      .from(objects)
      .where(eq(objects.apId, patch.inReplyTo))
      .get();
    if (
      patch.inReplyTo === source.apId ||
      (parent &&
        (parent.deletedAt !== null ||
          !(await canViewerReadObjectFull(db, parent, actor)) ||
          (isLocal(parent.attributedTo, baseUrl) &&
            (await actorSuppressesInteractionFrom(
              db,
              parent.attributedTo,
              actor,
            )))))
    )
      return null;
  }
  const result: NoteProjection = {
    ...source,
    communityApId,
    communityAdmissions: [...admissions.values()],
  };
  for (const field of [
    "content",
    "summary",
    "attachmentsJson",
    "tagsJson",
    "inReplyTo",
  ] as const) {
    if (patch[field] !== undefined)
      Object.assign(result, { [field]: patch[field] });
  }
  if (source.visibility !== "group") {
    if (patch.addressing) {
      const recipients = noteSpecificRecipients(patch.addressing);
      result.visibility = noteVisibility(patch.addressing);
      result.toJson = JSON.stringify(patch.addressing.to);
      result.ccJson = JSON.stringify(patch.addressing.cc);
      result.conversation =
        result.visibility === "direct" && recipients.length === 1
          ? getConversationId(baseUrl, actor, recipients[0])
          : null;
      result.recipients = [
        ...source.recipients.filter((r) => r.type !== "to"),
        ...recipients.map((recipientApId) => ({ recipientApId, type: "to" })),
      ];
    }
    if (patch.audience !== undefined)
      result.audienceJson = JSON.stringify(patch.audience);
  }
  result.updated = new Date().toISOString();
  return result;
}

export async function foldAdmittedNoteUpdates(
  db: Database,
  source: NoteProjection,
  window: NoteUpdateWindow,
  actor: string,
  baseUrl: string,
): Promise<NoteProjection> {
  let projected = source;
  for (const event of window.events) {
    const next = await projectAdmittedNotePatch(
      db,
      projected,
      decodeNoteUpdatePatch(event.patchJson),
      actor,
      baseUrl,
    );
    // A current policy rejection consumes only that admitted event, keeping
    // later valid changes and the legitimate original Create usable.
    if (next) projected = next;
  }
  return projected;
}

export async function readNoteProjection(
  db: Database,
  objectId: string,
): Promise<NoteProjection | null> {
  const row = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (!row) return null;
  const recipients = await db
    .select({
      recipientApId: objectRecipients.recipientApId,
      type: objectRecipients.type,
    })
    .from(objectRecipients)
    .where(eq(objectRecipients.objectApId, objectId));
  return { ...row, recipients };
}

const SOURCE_FIELDS = [
  "apId",
  "type",
  "attributedTo",
  "isLocal",
  "deletedAt",
  "content",
  "summary",
  "attachmentsJson",
  "tagsJson",
  "inReplyTo",
  "conversation",
  "visibility",
  "toJson",
  "ccJson",
  "audienceJson",
  "communityApId",
  "published",
  "updated",
  "endTime",
] as const;

export function noteProjectionSourceSql(
  before: NoteProjection | null,
  objectId: string,
): SQL {
  if (!before)
    return sql`NOT EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.apId} = ${objectId})`;
  const fields = SOURCE_FIELDS.map(
    (field) => sql`${objects[field]} IS ${before[field]}`,
  );
  const expected = JSON.stringify(before.recipients);
  return sql`EXISTS (SELECT 1 FROM ${objects} WHERE ${sql.join(fields, sql` AND `)})
    AND NOT EXISTS (SELECT ${objectRecipients.recipientApId}, ${objectRecipients.type} FROM ${objectRecipients}
      WHERE ${objectRecipients.objectApId} = ${objectId}
      EXCEPT SELECT json_extract(value, '$.recipientApId'), json_extract(value, '$.type') FROM json_each(${expected}))
    AND NOT EXISTS (SELECT json_extract(value, '$.recipientApId'), json_extract(value, '$.type') FROM json_each(${expected})
      EXCEPT SELECT ${objectRecipients.recipientApId}, ${objectRecipients.type} FROM ${objectRecipients}
      WHERE ${objectRecipients.objectApId} = ${objectId})`;
}

/** Object/reach, derived counters and admitted watermark share one real batch. */
export async function commitNoteProjection(
  db: Database,
  before: NoteProjection | null,
  after: NoteProjection,
  window: NoteUpdateWindow,
  creation?: { activityId?: string; countPost: boolean },
) {
  if (
    after.type !== "Note" ||
    after.apId !== window.objectId ||
    !isSameActivityPubActor(after.attributedTo, window.actor) ||
    (!before && after.isLocal !== 0) ||
    (before &&
      (before.apId !== after.apId ||
        before.type !== "Note" ||
        before.attributedTo !== after.attributedTo ||
        before.isLocal !== after.isLocal ||
        before.deletedAt !== after.deletedAt ||
        before.published !== after.published ||
        !isSameActivityPubActor(before.attributedTo, window.actor)))
  ) {
    throw new Error("Note projection identity mismatch");
  }
  const guarded = guardInboundNoteUpdateWindow(
    db,
    window,
    sql`(${noteProjectionSourceSql(before, after.apId)}) AND ${inboundCommunityAdmissionsSql(after.communityAdmissions ?? [], window.actor)}`,
  );
  const values = {
    type: after.type,
    attributedTo: after.attributedTo,
    isLocal: after.isLocal,
    deletedAt: after.deletedAt,
    content: after.content,
    summary: after.summary,
    attachmentsJson: after.attachmentsJson,
    tagsJson: after.tagsJson,
    inReplyTo: after.inReplyTo,
    conversation: after.conversation,
    visibility: after.visibility,
    toJson: after.toJson,
    ccJson: after.ccJson,
    audienceJson: after.audienceJson,
    communityApId: after.communityApId,
    published: after.published,
    updated: after.updated,
    endTime: after.endTime,
  };
  const mutation = (
    before
      ? guarded.update(objects).set(values).where(eq(objects.apId, after.apId))
      : guarded.insert(objects).values({ apId: after.apId, ...values })
  ) as D1Statement;
  const statements: [D1Statement, ...D1Statement[]] = [mutation];
  if (!before && creation?.countPost)
    statements.unshift(
      guarded
        .update(actors)
        .set({ postCount: sql`${actors.postCount} + 1` })
        .where(eq(actors.apId, after.attributedTo)) as D1Statement,
    );
  const recipients = JSON.stringify(after.recipients);
  statements.push(
    guarded.delete(objectRecipients).where(
      and(
        eq(objectRecipients.objectApId, after.apId),
        sql`NOT EXISTS (SELECT 1 FROM json_each(${recipients}) WHERE json_extract(value, '$.recipientApId') = ${objectRecipients.recipientApId}
    AND json_extract(value, '$.type') = ${objectRecipients.type})`,
      ),
    ) as D1Statement,
  );
  statements.push(
    ...insertMany(
      guarded,
      objectRecipients,
      after.recipients.map((r) => ({ objectApId: after.apId, ...r })),
      { conflict: "ignore" },
    ),
  );
  const parents = new Set(
    [before?.inReplyTo, after.inReplyTo, after.apId].filter((v): v is string =>
      Boolean(v),
    ),
  );
  for (const parent of parents)
    statements.push(
      guarded
        .update(objects)
        .set({
          replyCount: sql`(SELECT COUNT(*) FROM ${objects} WHERE ${objects.inReplyTo} = ${parent})`,
        })
        .where(eq(objects.apId, parent)) as D1Statement,
    );
  const creator = before ? undefined : (creation?.activityId ?? null);
  statements.push(
    ...inboundNoteUpdateCommitStatements(guarded, window, creator),
  );
  await runBatch(guarded, statements);
  const committedWindow = {
    ...window,
    applied: window.latest,
    events: [],
    creationActivityId:
      creator !== undefined ? creator : window.creationActivityId,
  };
  return {
    db: guardInboundNoteUpdateWindow(
      db,
      committedWindow,
      sql`(${noteProjectionSourceSql(after, after.apId)}) AND ${inboundCommunityAdmissionsSql(after.communityAdmissions ?? [], window.actor)}`,
    ),
    projection: after,
    window: committedWindow,
    created: before === null,
  };
}
