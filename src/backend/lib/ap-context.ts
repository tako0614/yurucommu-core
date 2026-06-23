// Shared JSON-LD @context for SERVED / DELIVERED objects (Note + the Create that
// wraps it). The objects we emit carry `tag` entries of type `Hashtag` and a
// `sensitive` flag (content warnings) — neither is defined in the vanilla AS2
// context, so a strict JSON-LD processor (relays / indexers that expand)
// silently DROPS them: a CW post can render unblurred and a hashtag is not
// indexed remotely. Declaring the terms (to their AS2 IRIs) keeps our egress
// JSON-LD-valid. Mirrors the ACTOR_CONTEXT_EXTENSION pattern used for the actor
// doc (routes/activitypub.ts) but for the object/Create surfaces.
export const OBJECT_CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
  {
    Hashtag: "https://www.w3.org/ns/activitystreams#Hashtag",
    sensitive: "https://www.w3.org/ns/activitystreams#sensitive",
  },
] as const;
