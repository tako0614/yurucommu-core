import type { Context } from "hono";
import type { Env, Variables } from "../../types.ts";
import { eq } from "drizzle-orm";
import { instanceActor } from "../../../db/index.ts";
import { generateKeyPair } from "../../federation-helpers.ts";
import { logger } from "../../lib/logger.ts";

const log = logger.child({ component: "activitypub.query_helpers" });

export const INSTANCE_ACTOR_USERNAME = "community";
export const MAX_ROOM_STREAM_LIMIT = 50;

export function roomApId(baseUrl: string, roomId: string): string {
  return `${baseUrl}/ap/rooms/${roomId}`;
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

      // Use a transaction so that the keypair generation + insert + final
      // read are bundled. `onConflictDoNothing` on the natural primary key
      // (`ap_id`) keeps cross-process races safe: only one writer wins, and
      // the loser re-reads the winner's row via the trailing findFirst.
      const created = await db.transaction(async (tx) => {
        const inside = await tx.query.instanceActor.findFirst({
          where: eq(instanceActor.apId, apId),
        });
        if (inside) return inside;

        const { publicKeyPem, privateKeyPem } = await generateKeyPair();
        const now = new Date().toISOString();
        await tx
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

        const final = await tx.query.instanceActor.findFirst({
          where: eq(instanceActor.apId, apId),
        });
        if (!final) {
          throw new Error("Failed to load instance actor after lazy-create");
        }
        return final;
      });

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

/** @internal Test-only helper for inspecting the synthetic lock. */
export const __instanceActorInternals = {
  inflightSize: () => inFlightInstanceActor.size,
  clear: () => inFlightInstanceActor.clear(),
};
