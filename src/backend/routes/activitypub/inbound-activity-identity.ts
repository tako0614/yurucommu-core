import { activityApId } from "../../federation-helpers.ts";
import { normalizeActivityPubActorId } from "../../lib/activitypub-actor-identity.ts";
import { sha256Hex } from "../../lib/delivery/transformers.ts";

/** Build the fixed-size, actor-scoped local ledger IRI for an inbound source. */
export async function internalInboundActivityId(
  baseUrl: string,
  actor: string,
  source: string,
): Promise<string> {
  const actorIdentity = normalizeActivityPubActorId(actor) ?? actor;
  return activityApId(
    baseUrl,
    `inbound-${await sha256Hex(`${actorIdentity}\0${source}`)}`,
  );
}
