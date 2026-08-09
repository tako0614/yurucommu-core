/**
 * Shared-inbox addressing: which LOCAL actors is an inbound activity for?
 *
 * The old model was an exception list. Six types were "recipient independent"
 * and dispatched once; everything else fell through to "fan out to every local
 * actor that follows the SENDER". That fallback is a guess, and it is wrong in
 * both directions:
 *
 *   - A DM or a Like from someone the recipient does not follow resolved to
 *     ZERO recipients. The route then committed `processed = 1`, so the
 *     activity was permanently un-redeliverable — a silent drop with a 202.
 *     Our own delivery planner always prefers `endpoints.sharedInbox`, and so
 *     does Mastodon, so this is the NORMAL inbound path, not an edge case.
 *   - `Like` / `Announce` were fanned out once PER LOCAL FOLLOWER even though
 *     their handlers take `_recipient` and resolve the target from the object's
 *     `attributedTo`. Every extra follower was one more redundant whole-row
 *     counter recompute.
 *
 * The replacement is a total function over the handled activity types. Every
 * type declares its addressing class, `satisfies` makes the map exhaustive, and
 * a new handler therefore cannot be added without declaring where it is
 * addressed — the enforcement is `bunx tsc --noEmit`, not a lint script.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import { actors, follows, inChunks } from "../../../db/index.ts";
import { isLocal } from "../../federation-helpers.ts";
import type { Activity } from "./inbox-types.ts";
import {
  addressesPublic,
  MAX_ADDRESS_ENTRIES,
} from "./handlers/inbox-content-handlers.ts";

export type ActorRow = typeof actors.$inferSelect;

/**
 * How an inbound activity names its recipients.
 *
 * `audience` is never DECLARED — it is only ever the RESULT of resolving an
 * `addressed` activity whose addressing actually contains a Public or
 * followers-collection marker. That distinction is the whole point: the old
 * code performed a follower fan-out because it had found no other recipient,
 * rather than because the activity asked for one.
 */
export type AddressingClass =
  "instance" | "object-actor" | "addressed" | "audience";

export type DeclaredAddressingClass = Exclude<AddressingClass, "audience">;

/** Activity types `dispatchUserActivity` handles. */
export const HANDLED_ACTIVITY_TYPES = [
  "Follow",
  "Accept",
  "Undo",
  "Like",
  "Create",
  "Delete",
  "Announce",
  "Update",
  "Reject",
  "Add",
  "Remove",
  "Block",
  "Flag",
  "Move",
] as const;

export type HandledActivityType = (typeof HANDLED_ACTIVITY_TYPES)[number];

/**
 * The addressing declaration. `satisfies` keeps it total: adding a handler to
 * {@link HANDLED_ACTIVITY_TYPES} without a class here is a type error.
 *
 * `Like` and `Announce` are `instance`: their handlers already ignore the
 * recipient argument and resolve the affected object (and its owner) from
 * `activity.object`, so dispatching them once is not a behaviour change — it
 * only removes the per-follower duplication.
 *
 * `Undo` is declared `object-actor` because Undo(Follow|Block) must reach the
 * followed/blocked actor. Undo(Like|Announce) carries no local actor target and
 * is actor-keyed + idempotent, so the resolver downgrades it to `instance`.
 */
export const ACTIVITY_ADDRESSING = {
  Accept: "instance",
  Delete: "instance",
  Update: "instance",
  Reject: "instance",
  Flag: "instance",
  Move: "instance",
  Like: "instance",
  Announce: "instance",

  Follow: "object-actor",
  Block: "object-actor",
  Undo: "object-actor",

  Create: "addressed",
  Add: "addressed",
  Remove: "addressed",
} satisfies Record<HandledActivityType, DeclaredAddressingClass>;

export function isHandledActivityType(
  type: string,
): type is HandledActivityType {
  return type in ACTIVITY_ADDRESSING;
}

/**
 * Every IRI the activity uses to name an audience, from the ENVELOPE and from
 * an embedded object. The envelope fields used to be discarded by
 * `parseActivity`, which is why a DM's addressing never reached routing.
 *
 * `bto`/`bcc` are included: a peer that strips them before delivery simply
 * contributes nothing, and one that does not must still be honoured.
 */
export function collectAddresses(activity: Activity): string[] {
  const object = typeof activity.object === "string" ? null : activity.object;
  const all = [
    ...(activity.to ?? []),
    ...(activity.cc ?? []),
    ...(activity.bto ?? []),
    ...(activity.bcc ?? []),
    ...(activity.audience ?? []),
    ...(object?.to ?? []),
    ...(object?.cc ?? []),
    ...(object?.bto ?? []),
    ...(object?.bcc ?? []),
    ...(object?.audience ?? []),
  ];
  // Same bound the persisted addressing arrays use (policy defined once, in
  // inbox-content-handlers): a remote must not be able to make one delivery
  // cost an unbounded number of actor lookups.
  return [...new Set(all)].slice(0, MAX_ADDRESS_ENTRIES);
}

/**
 * A followers-collection IRI. Matched by suffix, exactly like the visibility
 * classifier in inbox-content-handlers — resolving the sender's real
 * `followers` URL would need a network fetch for a remote actor.
 */
function addressesFollowersCollection(addresses: readonly string[]): boolean {
  return addresses.some((a) => a.endsWith("/followers"));
}

export type AddressingResolution = {
  /** The class actually applied (may be `audience`, which is never declared). */
  readonly cls: AddressingClass;
  readonly recipients: readonly ActorRow[];
  /** Addressing IRIs read off the activity, for logging. */
  readonly addresses: readonly string[];
};

/**
 * Local actors explicitly named in the addressing.
 */
async function resolveAddressedLocalActors(
  db: Database,
  addresses: readonly string[],
  baseUrl: string,
): Promise<ActorRow[]> {
  const localIris = addresses.filter(
    (a) => isLocal(a, baseUrl) && !addressesPublic([a]),
  );
  if (localIris.length === 0) return [];
  // Bounded by MAX_ADDRESS_ENTRIES, but routed through inChunks anyway so the
  // D1 parameter rule holds if that bound is ever raised.
  return await inChunks(localIris, (chunk) =>
    db.query.actors.findMany({ where: inArray(actors.apId, [...chunk]) }),
  );
}

/**
 * Local actors with an accepted follow of `senderApId`.
 */
async function resolveLocalFollowers(
  db: Database,
  senderApId: string,
  baseUrl: string,
  limit: number,
): Promise<ActorRow[]> {
  const rows = await db
    .select({ followerApId: follows.followerApId })
    .from(follows)
    .where(
      and(
        eq(follows.followingApId, senderApId),
        eq(follows.status, "accepted"),
      ),
    )
    .limit(limit);

  const localFollowerApIds = rows
    .map((row) => row.followerApId)
    .filter((apId) => isLocal(apId, baseUrl));
  if (localFollowerApIds.length === 0) return [];

  return await inChunks(localFollowerApIds, (chunk) =>
    db.query.actors.findMany({ where: inArray(actors.apId, [...chunk]) }),
  );
}

/**
 * Resolve an `addressed` activity's local recipients.
 *
 * A follower fan-out happens ONLY when the activity actually addresses Public
 * or a followers collection (`audience`). An activity that names specific
 * actors resolves to exactly those (`addressed`). An activity that names
 * neither resolves to nothing, and the caller must treat that as UNDELIVERABLE
 * rather than as a completed no-op — the old code's `processed = 1` on that
 * branch is what made non-follower DMs unrecoverable.
 */
export async function resolveAddressedRecipients(
  db: Database,
  activity: Activity,
  senderApId: string,
  baseUrl: string,
  followerFanoutLimit: number,
): Promise<AddressingResolution> {
  const addresses = collectAddresses(activity);
  const addressed = await resolveAddressedLocalActors(db, addresses, baseUrl);

  const wantsAudience =
    addressesPublic([...addresses]) || addressesFollowersCollection(addresses);

  if (!wantsAudience) {
    return { cls: "addressed", recipients: addressed, addresses };
  }

  const followers = await resolveLocalFollowers(
    db,
    senderApId,
    baseUrl,
    followerFanoutLimit,
  );
  const byApId = new Map<string, ActorRow>();
  for (const row of [...addressed, ...followers]) byApId.set(row.apId, row);
  return { cls: "audience", recipients: [...byApId.values()], addresses };
}
