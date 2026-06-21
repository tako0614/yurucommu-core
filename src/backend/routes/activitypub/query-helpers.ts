import type { Context } from "hono";
import type { Env, Variables } from "../../types.ts";
import { and, eq, isNull } from "drizzle-orm";
import { communities, instanceActor } from "../../../db/index.ts";
import type { Database } from "../../../db/index.ts";
import { generateKeyPair } from "../../federation-helpers.ts";
import type { RemoteFetchSigner } from "../../lib/activitypub-actor-cache.ts";
import { logger } from "../../lib/logger.ts";

const log = logger.child({ component: "activitypub.query_helpers" });

export const INSTANCE_ACTOR_USERNAME = "community";

/** Columns of a community needed to serve its ActivityPub Group actor doc. */
export interface FederatedCommunityActor {
  apId: string;
  preferredUsername: string;
  name: string;
  summary: string | null;
  iconUrl: string | null;
  inbox: string;
  outbox: string;
  followersUrl: string;
  publicKeyPem: string;
  joinPolicy: string;
  memberCount: number;
  createdAt: string;
}

/**
 * Load a community that is servable over federation as a Group actor: it must
 * exist, not be deleted, and be PUBLIC. A private community's existence /
 * name / summary is members-only (mirroring the discovery-list gate), so it is
 * NOT exposed as a federated actor — callers 404 a null result.
 */
export async function loadFederatedCommunity(
  db: Database,
  apId: string,
): Promise<FederatedCommunityActor | null> {
  const row = await db
    .select({
      apId: communities.apId,
      preferredUsername: communities.preferredUsername,
      name: communities.name,
      summary: communities.summary,
      iconUrl: communities.iconUrl,
      inbox: communities.inbox,
      outbox: communities.outbox,
      followersUrl: communities.followersUrl,
      publicKeyPem: communities.publicKeyPem,
      joinPolicy: communities.joinPolicy,
      memberCount: communities.memberCount,
      createdAt: communities.createdAt,
    })
    .from(communities)
    .where(
      and(
        eq(communities.apId, apId),
        isNull(communities.deletedAt),
        eq(communities.visibility, "public"),
      ),
    )
    .get();
  return row ?? null;
}

export type InstanceActorResult = {
  apId: string;
  preferredUsername: string;
  name: string | null;
  summary: string | null;
  publicKeyPem: string;
  privateKeyPem: string;
  joinPolicy: string;
  postingPolicy: string;
  visibility: string;
};

/**
 * Process-local in-flight lock for `getInstanceActor`. Two concurrent
 * cold-start callers used to race: each would observe a missing row,
 * each would generate its own RSA keypair, and the loser of the insert
 * would simply drop its key. That is correct (because `onConflictDoNothing`
 * keeps the winner's row) but wasteful — RSA generation is ~250ms.
 *
 * Cloudflare D1 does not support `SELECT FOR UPDATE`, so the synthetic
 * advisory lock here is a single in-process Promise keyed by AP-ID. Across
 * processes / D1 shards the race is still resolved by the database's
 * conflict-do-nothing semantics, but the local lock keeps the hot path
 * cheap when the same worker isolate receives a burst of concurrent
 * requests.
 */
const inFlightInstanceActor = new Map<string, Promise<InstanceActorResult>>();

export async function getInstanceActor(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<InstanceActorResult> {
  const db = c.get("db");
  const baseUrl = c.env.APP_URL;
  const apId = `${baseUrl}/ap/actor`;

  // Hot path: row exists, no lock acquisition needed.
  const existing = await db.query.instanceActor.findFirst({
    where: eq(instanceActor.apId, apId),
  });
  if (existing) {
    return {
      apId: existing.apId,
      preferredUsername: existing.preferredUsername,
      name: existing.name,
      summary: existing.summary,
      publicKeyPem: existing.publicKeyPem,
      privateKeyPem: existing.privateKeyPem,
      joinPolicy: existing.joinPolicy,
      postingPolicy: existing.postingPolicy,
      visibility: existing.visibility,
    };
  }

  // Cold path: serialise lazy-create through the synthetic advisory lock.
  const inflight = inFlightInstanceActor.get(apId);
  if (inflight) return await inflight;

  const promise = (async (): Promise<InstanceActorResult> => {
    try {
      // Re-check under lock. Some other in-isolate caller may have created
      // the row between our initial findFirst and lock acquisition.
      const racy = await db.query.instanceActor.findFirst({
        where: eq(instanceActor.apId, apId),
      });
      if (racy) {
        return {
          apId: racy.apId,
          preferredUsername: racy.preferredUsername,
          name: racy.name,
          summary: racy.summary,
          publicKeyPem: racy.publicKeyPem,
          privateKeyPem: racy.privateKeyPem,
          joinPolicy: racy.joinPolicy,
          postingPolicy: racy.postingPolicy,
          visibility: racy.visibility,
        };
      }

      // NO interactive transaction: the production runtime is Cloudflare D1,
      // whose drizzle driver does not support `db.transaction()` (it throws),
      // which previously made this cold path 500 on every call — the instance
      // actor row could never be lazily created, breaking `/ap/actor` and any
      // path that signs as the instance actor. The insert is idempotent on the
      // natural primary key (`ap_id`) via `onConflictDoNothing`, so concurrent
      // creators race safely: the loser's insert is a no-op and BOTH re-read
      // the winner's row (and thus the winner's keypair) via the trailing
      // findFirst — no transaction is needed for correctness here.
      const { publicKeyPem, privateKeyPem } = await generateKeyPair();
      const now = new Date().toISOString();
      await db
        .insert(instanceActor)
        .values({
          apId,
          preferredUsername: INSTANCE_ACTOR_USERNAME,
          name: "Yurucommu",
          summary: "Yurucommu Community",
          publicKeyPem,
          privateKeyPem,
          joinPolicy: "open",
          postingPolicy: "members",
          visibility: "public",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: instanceActor.apId });

      const created = await db.query.instanceActor.findFirst({
        where: eq(instanceActor.apId, apId),
      });
      if (!created) {
        throw new Error("Failed to load instance actor after lazy-create");
      }

      return {
        apId: created.apId,
        preferredUsername: created.preferredUsername,
        name: created.name,
        summary: created.summary,
        publicKeyPem: created.publicKeyPem,
        privateKeyPem: created.privateKeyPem,
        joinPolicy: created.joinPolicy,
        postingPolicy: created.postingPolicy,
        visibility: created.visibility,
      };
    } catch (err) {
      log.error("getInstanceActor failed", {
        event: "ap.instance_actor.lazy_create_failed",
        apId,
        error: err,
      });
      throw err;
    } finally {
      inFlightInstanceActor.delete(apId);
    }
  })();

  inFlightInstanceActor.set(apId, promise);
  return await promise;
}

/**
 * Build the authorized-fetch signing identity from the instance actor. Used to
 * HTTP-sign outbound actor/object GETs so secure-mode remotes serve the
 * document. The `keyId` matches the `#main-key` fragment the served instance
 * actor doc (`GET /ap/actor`) exposes, so the remote can fetch + verify it.
 */
export async function getInstanceFetchSigner(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<RemoteFetchSigner> {
  const instance = await getInstanceActor(c);
  return {
    keyId: `${instance.apId}#main-key`,
    privateKeyPem: instance.privateKeyPem,
  };
}

/** @internal Test-only helper for inspecting the synthetic lock. */
export const __instanceActorInternals = {
  inflightSize: () => inFlightInstanceActor.size,
  clear: () => inFlightInstanceActor.clear(),
};
