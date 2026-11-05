import { sql, type SQL } from "drizzle-orm";
import {
  talkMessageReads,
  talkReadAssertions,
  talkReadModes,
  type Database,
} from "../../db/index.ts";
import { runBatch } from "../../db/d1-write.ts";
import { operatorActorNotBlockedSql } from "./blocklist.ts";

export const MAX_OBSERVED_READ_IDS = 50;
export type TalkReadScope = {
  viewer: string;
  kind: "user" | "community";
  target: string;
  thread: string;
  epoch: string;
};

export class ObservedReadConflict extends Error {}

export function parseObservedReadIds(body: unknown): string[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const ids = (body as Record<string, unknown>).message_ids;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > MAX_OBSERVED_READ_IDS ||
    ids.some(
      (id) =>
        typeof id !== "string" ||
        id.length < 1 ||
        id.length > 2048 ||
        id.trim() !== id,
    ) ||
    new Set(ids).size !== ids.length ||
    JSON.stringify(ids).length > 32768
  )
    return null;
  return ids;
}

function scopeAuthorized(s: TalkReadScope): SQL {
  const actor = sql`EXISTS (SELECT 1 FROM actors WHERE ap_id = ${s.viewer} AND deleted_at IS NULL)`;
  return s.kind === "user"
    ? sql`${actor} AND ${operatorActorNotBlockedSql(sql`${s.target}`)} AND (
        EXISTS (SELECT 1 FROM actors WHERE ap_id = ${s.target} AND deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM actor_cache WHERE ap_id = ${s.target})
        OR EXISTS (SELECT 1 FROM objects o WHERE ${objectReadable(s)}))`
    : sql`${actor} AND EXISTS (
        SELECT 1 FROM communities c JOIN community_members cm ON cm.community_ap_id = c.ap_id
        WHERE c.ap_id = ${s.target} AND c.deleted_at IS NULL
          AND cm.actor_ap_id = ${s.viewer} AND cm.joined_at = ${s.epoch})`;
}

export function observedModeExists(s: TalkReadScope): SQL {
  return sql`EXISTS (SELECT 1 FROM talk_read_modes mode
    WHERE mode.actor_ap_id = ${s.viewer} AND mode.kind = ${s.kind}
      AND mode.target_ap_id = ${s.target} AND mode.thread_id = ${s.thread} AND mode.epoch = ${s.epoch})`;
}

// Every call is an object-set query, never conversation ID alone. Legacy
// conversation IDs could collide across different pairs on the same host.
function objectReadable(s: TalkReadScope): SQL {
  const common = sql`o.type = 'Note' AND o.deleted_at IS NULL
    AND ${operatorActorNotBlockedSql(sql`o.attributed_to`)}`;
  return s.kind === "user"
    ? sql`${common} AND o.visibility = 'direct' AND o.conversation = ${s.thread}
      AND ((o.attributed_to = ${s.target} AND EXISTS (SELECT 1 FROM object_recipients p
        WHERE p.object_ap_id = o.ap_id AND p.recipient_ap_id = ${s.viewer} AND p.type = 'to'))
      OR (o.attributed_to = ${s.viewer} AND EXISTS (SELECT 1 FROM object_recipients p
        WHERE p.object_ap_id = o.ap_id AND p.recipient_ap_id = ${s.target} AND p.type = 'to')))`
    : sql`${common} AND o.community_ap_id IS NULL AND EXISTS (SELECT 1 FROM object_recipients p
        WHERE p.object_ap_id = o.ap_id AND p.recipient_ap_id = ${s.target} AND p.type = 'audience')`;
}

function assertion(db: Database, id: string, condition: SQL) {
  return db
    .insert(talkReadAssertions)
    .values({ id, valid: sql`CASE WHEN ${condition} THEN 1 ELSE 0 END` });
}

function insertReads(db: Database, s: TalkReadScope, where: SQL, now: string) {
  return db
    .insert(talkMessageReads)
    .select(
      sql`SELECT ${s.viewer}, ${s.kind}, ${s.target},
    ${s.thread}, ${s.epoch}, o.ap_id, ${now} FROM objects o WHERE ${objectReadable(s)} AND ${where}`,
    )
    .onConflictDoNothing();
}

async function checkedBatch(
  db: Database,
  statements: Parameters<typeof runBatch>[1],
) {
  try {
    await runBatch(db, statements);
  } catch (error) {
    for (
      let cause: unknown = error;
      cause instanceof Error;
      cause = cause.cause
    ) {
      if (cause.message.includes("talk_read_assertion_valid")) {
        throw new ObservedReadConflict(
          "Current conversation, membership or messages changed",
          { cause: error },
        );
      }
    }
    throw error;
  }
}

// A peer-scoped legacy operation must not advance the shared timestamp of a
// different peer that happens to have the same historical conversation ID.
export function ambiguousLegacyThreadSql(s: TalkReadScope): SQL {
  if (s.kind !== "user") return sql`0`;
  return sql`EXISTS (SELECT 1 FROM objects legacy_other
    WHERE legacy_other.visibility = 'direct' AND legacy_other.type = 'Note'
      AND legacy_other.conversation = ${s.thread} AND (
        (legacy_other.attributed_to <> ${s.viewer} AND legacy_other.attributed_to <> ${s.target}
          AND EXISTS (SELECT 1 FROM object_recipients p WHERE p.object_ap_id = legacy_other.ap_id
            AND p.type = 'to' AND p.recipient_ap_id = ${s.viewer}))
        OR (legacy_other.attributed_to = ${s.viewer} AND EXISTS (
          SELECT 1 FROM object_recipients p WHERE p.object_ap_id = legacy_other.ap_id
            AND p.type = 'to' AND p.recipient_ap_id <> ${s.viewer} AND p.recipient_ap_id <> ${s.target}))))`;
}

function observedInitialization(
  db: Database,
  s: TalkReadScope,
  now: string,
  when: SQL = sql`1`,
) {
  const legacyBaseline =
    s.kind === "user"
      ? sql`COALESCE((SELECT last_read_at FROM dm_read_status WHERE actor_ap_id = ${s.viewer}
        AND conversation_id = ${s.thread}), '1970-01-01T00:00:00Z')`
      : sql`COALESCE((SELECT last_read_at FROM dm_community_read_status WHERE actor_ap_id = ${s.viewer}
        AND community_ap_id = ${s.target}), ${s.epoch}, '1970-01-01T00:00:00Z')`;
  return [
    insertReads(
      db,
      s,
      sql`${when} AND NOT ${observedModeExists(s)} AND o.published <= ${legacyBaseline}`,
      now,
    ),
    db
      .insert(talkReadModes)
      .select(
        sql`SELECT ${s.viewer}, ${s.kind}, ${s.target}, ${s.thread}, ${s.epoch}, ${now} WHERE ${when}`,
      )
      .onConflictDoUpdate({
        target: [
          talkReadModes.actorApId,
          talkReadModes.kind,
          talkReadModes.targetApId,
        ],
        set: { threadId: s.thread, epoch: s.epoch, startedAt: now },
        where: sql`${talkReadModes.threadId} <> ${s.thread} OR ${talkReadModes.epoch} <> ${s.epoch}`,
      }),
  ] as const;
}

export async function initializeObservedReads(
  db: Database,
  s: TalkReadScope,
): Promise<void> {
  const id = crypto.randomUUID();
  await checkedBatch(db, [
    assertion(db, id, scopeAuthorized(s)),
    ...observedInitialization(db, s, new Date().toISOString()),
    assertion(
      db,
      `${id}:after`,
      sql`${scopeAuthorized(s)} AND ${observedModeExists(s)}`,
    ),
    db
      .delete(talkReadAssertions)
      .where(sql`${talkReadAssertions.id} IN (${id}, ${`${id}:after`})`),
  ]);
}

export async function acknowledgeObservedReads(
  db: Database,
  s: TalkReadScope,
  ids: readonly string[],
): Promise<void> {
  const id = crypto.randomUUID();
  const selected = sql`o.ap_id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`;
  const valid = sql`${scopeAuthorized(s)} AND ${observedModeExists(s)}
    AND (SELECT count(*) FROM objects o WHERE ${objectReadable(s)} AND ${selected}) = ${ids.length}`;
  await checkedBatch(db, [
    assertion(db, id, valid),
    insertReads(db, s, selected, new Date().toISOString()),
    assertion(db, `${id}:after`, valid),
    db
      .delete(talkReadAssertions)
      .where(sql`${talkReadAssertions.id} IN (${id}, ${`${id}:after`})`),
  ]);
}

// Legacy /read intentionally keeps mark-current-conversation semantics. This
// is not an observed-ID ACK and must never emit an exact timestamp receipt.
export function legacyObservedReadWrite(
  db: Database,
  s: TalkReadScope,
  now: string,
) {
  return insertReads(
    db,
    s,
    sql`${scopeAuthorized(s)} AND ${observedModeExists(s)}`,
    now,
  );
}

export async function applyLegacyTalkRead(
  db: Database,
  s: TalkReadScope,
  statusWrite: Parameters<typeof runBatch>[1][number],
  now: string,
) {
  await applyTalkScopeWrite(db, s, [
    ...observedInitialization(db, s, now, ambiguousLegacyThreadSql(s)),
    legacyObservedReadWrite(db, s, now),
    statusWrite,
  ]);
}

/** One authenticated conversation-metadata operation, never split into batches. */
export async function applyTalkScopeWrite(
  db: Database,
  s: TalkReadScope,
  payload: Parameters<typeof runBatch>[1],
) {
  const id = crypto.randomUUID();
  await checkedBatch(db, [
    assertion(db, id, scopeAuthorized(s)),
    ...payload,
    assertion(db, `${id}:after`, scopeAuthorized(s)),
    db
      .delete(talkReadAssertions)
      .where(sql`${talkReadAssertions.id} IN (${id}, ${`${id}:after`})`),
  ]);
}

export async function hasObservedReads(
  db: Database,
  s: TalkReadScope,
): Promise<boolean> {
  const row = await db
    .select({ actor: talkReadModes.actorApId })
    .from(talkReadModes)
    .where(
      sql`${talkReadModes.actorApId} = ${s.viewer} AND ${talkReadModes.kind} = ${s.kind}
      AND ${talkReadModes.targetApId} = ${s.target} AND ${talkReadModes.threadId} = ${s.thread}
      AND ${talkReadModes.epoch} = ${s.epoch}`,
    )
    .get();
  return !!row;
}

export async function partnerObservedReadIds(
  db: Database,
  s: TalkReadScope,
  ids: readonly string[],
): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: talkMessageReads.objectApId })
    .from(talkMessageReads).where(sql`
    ${talkMessageReads.actorApId} = ${s.viewer} AND ${talkMessageReads.kind} = ${s.kind}
    AND ${talkMessageReads.targetApId} = ${s.target} AND ${talkMessageReads.threadId} = ${s.thread}
    AND ${talkMessageReads.epoch} = ${s.epoch} AND ${observedModeExists(s)}
    AND ${talkMessageReads.objectApId} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`);
  const seen = new Set(rows.map((row) => row.id));
  return ids.filter((value) => seen.has(value));
}

/** Both contact counts and nav/push badge queries share the same predicate. */
export function unreadTalkObjectSql(
  kind: "user" | "community",
  viewer: SQL,
  target: SQL,
  thread: SQL,
  epoch: SQL,
  published: SQL,
  objectId: SQL,
  legacyBaseline: SQL,
): SQL {
  const mode = sql`SELECT 1 FROM talk_read_modes exact_mode
    WHERE exact_mode.actor_ap_id = ${viewer} AND exact_mode.kind = ${kind}
      AND exact_mode.target_ap_id = ${target} AND exact_mode.thread_id = ${thread} AND exact_mode.epoch = ${epoch}`;
  return sql`CASE WHEN EXISTS (${mode}) THEN NOT EXISTS (
    SELECT 1 FROM talk_message_reads seen WHERE seen.actor_ap_id = ${viewer} AND seen.kind = ${kind}
      AND seen.target_ap_id = ${target} AND seen.thread_id = ${thread} AND seen.epoch = ${epoch}
      AND seen.object_ap_id = ${objectId}) ELSE ${published} > ${legacyBaseline} END`;
}
