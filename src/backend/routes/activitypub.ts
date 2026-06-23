import { Hono } from "hono";
import type { Context } from "hono";
import { and, count, eq } from "drizzle-orm";
import type { Env, Variables } from "../types.ts";
import { actors, objects as objectsTable } from "../../db/index.ts";
import { notDeleted } from "../../db/index.ts";
import { actorApId, getDomain, safeJsonParse } from "../federation-helpers.ts";
import { communityApId } from "../lib/ap-ids.ts";
import {
  getInstanceActor,
  INSTANCE_ACTOR_USERNAME,
  loadFederatedCommunity,
} from "./activitypub/query-helpers.ts";
import inboxRoutes from "./activitypub/inbox.ts";
import outboxRoutes from "./activitypub/outbox.ts";
import { CacheTags, CacheTTL, withCache } from "../middleware/cache.ts";
import { safeUrlJoin } from "../lib/activitypub-helpers.ts";
import { activityJson, jrdJson } from "../lib/ap-response.ts";

type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

const ap = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Shared constants and helpers
// ---------------------------------------------------------------------------

const AP_CONTENT_TYPE = "application/activity+json";

// Default software.version advertised in NodeInfo when the deploy pipeline
// does not inject `YURUCOMMU_SOFTWARE_VERSION`. Keep this in sync with
// package.json; the env override lets the build report the real build version
// without editing source.
const YURUCOMMU_VERSION = "1.0.0";

const AP_CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  "https://w3id.org/security/v1",
] as const;

// Conventional Mastodon-style JSON-LD context extension. The served Person
// actor doc uses PropertyValue attachments, alsoKnownAs / movedTo migration
// declarations, and manuallyApprovesFollowers; strict consumers (Mastodon)
// only interpret these terms when they are declared in @context. Mirrors what
// Mastodon emits on its own actor documents.
const ACTOR_CONTEXT_EXTENSION = {
  schema: "http://schema.org#",
  PropertyValue: "schema:PropertyValue",
  value: "schema:value",
  toot: "http://joinmastodon.org/ns#",
  alsoKnownAs: { "@id": "as:alsoKnownAs", "@type": "@id" },
  movedTo: { "@id": "as:movedTo", "@type": "@id" },
  manuallyApprovesFollowers: "as:manuallyApprovesFollowers",
} as const;

// Full @context for the served Person actor doc: AS2 + security + the
// Mastodon-style extension terms above.
const ACTOR_CONTEXT = [...AP_CONTEXT, ACTOR_CONTEXT_EXTENSION] as const;

/** Build a standard WebFinger JRD response. */
function buildWebFingerResponse(
  username: string,
  domain: string,
  apId: string,
  profileHref: string,
): Record<string, unknown> {
  return {
    subject: `acct:${username}@${domain}`,
    aliases: [apId],
    links: [
      { rel: "self", type: AP_CONTENT_TYPE, href: apId },
      {
        rel: "http://webfinger.net/rel/profile-page",
        type: "text/html",
        href: profileHref,
      },
    ],
  };
}

/** Build an ActivityPub public-key block for an actor. */
function buildPublicKey(
  actorApId: string,
  publicKeyPem: string,
): Record<string, string> {
  return {
    id: `${actorApId}#main-key`,
    owner: actorApId,
    publicKeyPem,
  };
}

/**
 * Normalize a stored timestamp to an xsd:dateTime string for AS2 `published`.
 * Post timestamps are written with `toISOString()`, but an actor's `created_at`
 * is a SQLite `datetime('now')` value (`YYYY-MM-DD HH:MM:SS[.mmm]`, UTC, space-
 * separated, no zone) — emitting it verbatim yields an INVALID xsd:dateTime
 * (Mastodon can't parse the join date). Convert it to ISO 8601; pass through
 * values that already carry the `T` separator.
 */
function toIso8601(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value.includes("T")) return value;
  const d = new Date(value.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

async function countRows(
  c: HonoContext,
  table: typeof actors | typeof objectsTable,
  where: ReturnType<typeof and> | ReturnType<typeof eq>,
): Promise<number> {
  const db = c.get("db");
  const rows = await db.select({ total: count() }).from(table).where(where);
  return Number(rows[0]?.total ?? 0);
}

function canViewPrivateActorCollections(
  c: HonoContext,
  actorApId: string,
): boolean {
  const viewer = c.get("actor");
  return viewer?.ap_id === actorApId;
}

// ---------------------------------------------------------------------------
// NodeInfo - Instance Metadata
// ---------------------------------------------------------------------------

ap.get("/.well-known/nodeinfo", (c) => {
  const baseUrl = c.env.APP_URL.replace(/\/+$/, "");
  // Advertise BOTH 2.0 and 2.1. NodeInfo 2.0 is the baseline version the widest
  // set of fediverse servers / relays / statistics crawlers fetch; advertising
  // only 2.1 (and letting /nodeinfo/2.0 fall through to the SPA HTML shell) made
  // those consumers see HTML instead of JSON. Consumers pick the highest schema
  // they understand from this list.
  return c.json({
    links: [
      {
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.0",
        href: `${baseUrl}/nodeinfo/2.0`,
      },
      {
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
        href: `${baseUrl}/nodeinfo/2.1`,
      },
    ],
  });
});

// Shared instance telemetry for both NodeInfo schema versions. The only
// difference between 2.0 and 2.1 output is the `software` block (2.1 adds
// `repository`) and the `version` discriminator, so the rest lives here.
async function nodeinfoCommon(c: HonoContext) {
  const [totalUsers, localPosts] = await Promise.all([
    countRows(c, actors, notDeleted(actors)),
    countRows(
      c,
      objectsTable,
      and(
        eq(objectsTable.type, "Note"),
        eq(objectsTable.isLocal, 1),
        notDeleted(objectsTable),
      ),
    ),
  ]);

  return {
    protocols: ["activitypub"],
    services: {
      inbound: [],
      outbound: [],
    },
    usage: {
      // We do not track per-user last-activity timestamps, so we report only
      // the total user count and OMIT activeMonth / activeHalfyear rather than
      // fabricating them (NodeInfo permits omitting the active-window fields).
      // Reporting total as "active" would advertise false liveness telemetry
      // to relay/instance directories.
      users: {
        total: totalUsers,
      },
      localPosts,
    },
    openRegistrations: false,
    metadata: {
      singleUser: true,
    },
  };
}

ap.get("/nodeinfo/2.0", async (c) => {
  return c.json({
    version: "2.0",
    software: {
      name: "yurucommu",
      // Real running version (build-injected env, else the in-sync default
      // constant). NodeInfo 2.0's software block has no `repository` field —
      // that was introduced in 2.1.
      version: c.env.YURUCOMMU_SOFTWARE_VERSION || YURUCOMMU_VERSION,
    },
    ...(await nodeinfoCommon(c)),
  });
});

ap.get("/nodeinfo/2.1", async (c) => {
  return c.json({
    version: "2.1",
    software: {
      name: "yurucommu",
      // Real running version (build-injected env, else the in-sync default
      // constant) instead of a hardcoded literal that silently goes stale.
      version: c.env.YURUCOMMU_SOFTWARE_VERSION || YURUCOMMU_VERSION,
      repository: "https://github.com/tako0614/yurucommu",
    },
    ...(await nodeinfoCommon(c)),
  });
});

// ---------------------------------------------------------------------------
// WebFinger - Actor Discovery (cached 1 hour)
// ---------------------------------------------------------------------------

// host-meta: the legacy XRD discovery document that points a peer holding only
// our domain at the WebFinger endpoint (the `lrdd` link template). Modern
// servers fetch /.well-known/webfinger directly, but some crawlers and older
// software still resolve host-meta first — without this route it fell through
// to the SPA HTML shell. The template's `{uri}` is a literal placeholder the
// caller substitutes, so it must not be URL-encoded.
ap.get("/.well-known/host-meta", (c) => {
  const baseUrl = c.env.APP_URL.replace(/\/+$/, "");
  const xrd =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">\n' +
    `  <Link rel="lrdd" type="application/jrd+json" template="${baseUrl}/.well-known/webfinger?resource={uri}"/>\n` +
    "</XRD>\n";
  c.header("Content-Type", "application/xrd+xml; charset=utf-8");
  return c.body(xrd);
});

ap.get(
  "/.well-known/webfinger",
  withCache({
    ttl: CacheTTL.WEBFINGER,
    cacheTag: CacheTags.WEBFINGER,
    queryParamsToInclude: ["resource"],
  }),
  async (c) => {
    const db = c.get("db");
    const resource = c.req.query("resource");
    if (!resource) return c.json({ error: "resource parameter required" }, 400);

    // Parse resource format: acct:username@domain or https://domain/ap/users/username
    let username: string | null = null;
    let domain: string | null = null;

    if (resource.startsWith("acct:")) {
      const acctPart = resource.slice(5);
      const [user, host] = acctPart.split("@");
      username = user;
      domain = host;
    } else if (resource.startsWith("http")) {
      try {
        const url = new URL(resource);
        domain = url.host;
        const match = resource.match(/\/users\/([^\/]+)$/);
        if (match) {
          username = match[1];
        }
      } catch {
        return c.json({ error: "Invalid resource format" }, 400);
      }
    } else {
      return c.json({ error: "Invalid resource format" }, 400);
    }

    if (!username || !domain) {
      return c.json(
        {
          error: "Invalid resource format",
        },
        400,
      );
    }

    const baseUrl = c.env.APP_URL;
    const currentDomain = getDomain(baseUrl);

    if (domain !== currentDomain) {
      return c.json({ error: "Actor not found" }, 404);
    }

    if (username === INSTANCE_ACTOR_USERNAME) {
      const instanceActor = await getInstanceActor(c);
      return jrdJson(
        c,
        buildWebFingerResponse(
          INSTANCE_ACTOR_USERNAME,
          domain,
          instanceActor.apId,
          `${baseUrl}/groups`,
        ),
      );
    }

    const resolvedActor = await db.query.actors.findFirst({
      where: and(eq(actors.preferredUsername, username), notDeleted(actors)),
      columns: { apId: true, preferredUsername: true },
    });

    // An unknown local handle MUST 404 — never fall back to the owner actor.
    // The old fallback resolved ANY `acct:<anything>@<domain>` to the owner with
    // a `subject` echoing the requested (wrong) username, which (1) violates
    // WebFinger (the subject must identify the account the links describe), (2)
    // claims every possible username exists, and (3) does not even work for
    // federation: a conformant peer fetches the resolved actor, reads its real
    // `preferredUsername`, and re-WebFingers THAT — the round-trip subject then
    // mismatches the original query and the actor is rejected. So the fallback
    // had no working upside and real downsides (identity confusion / spoofed
    // existence). Resolve only an exact local actor — but a handle may instead
    // name a federated COMMUNITY, so try a public Group actor before 404ing.
    if (!resolvedActor) {
      const community = await loadFederatedCommunity(
        db,
        communityApId(baseUrl.replace(/\/+$/, ""), username),
      );
      if (community) {
        return jrdJson(
          c,
          buildWebFingerResponse(
            community.preferredUsername,
            domain,
            community.apId,
            `${baseUrl}/groups/${community.preferredUsername}`,
          ),
        );
      }
      return c.json({ error: "Actor not found" }, 404);
    }

    // Echo the CANONICAL username as the subject (not the requested casing) so
    // the WebFinger round-trip a remote performs stays self-consistent.
    const canonicalUsername = resolvedActor.preferredUsername;
    return jrdJson(
      c,
      buildWebFingerResponse(
        canonicalUsername,
        domain,
        resolvedActor.apId,
        `${baseUrl}/users/${canonicalUsername}`,
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// Actor Profile Endpoint (cached 10 minutes)
// ---------------------------------------------------------------------------

ap.get(
  "/ap/users/:username",
  // NOTE: no varyByActor — the session actor is never extracted on /ap/* (that
  // middleware is mounted only on /api, /media, /.takos/tools), so this is an
  // anonymous public AP document. The owner-only showCollections branch is
  // therefore unreachable here by design (AP identity is the HTTP signature, not
  // a session); a per-viewer flag would be dead + a latent footgun.
  withCache({
    ttl: CacheTTL.ACTIVITYPUB_ACTOR,
    cacheTag: CacheTags.ACTOR,
  }),
  async (c) => {
    const db = c.get("db");
    const username = c.req.param("username");
    const baseUrl = c.env.APP_URL;
    const apId = actorApId(baseUrl, username);

    const actor = await db.query.actors.findFirst({
      where: and(eq(actors.apId, apId), notDeleted(actors)),
      columns: {
        apId: true,
        type: true,
        preferredUsername: true,
        name: true,
        summary: true,
        iconUrl: true,
        headerUrl: true,
        inbox: true,
        outbox: true,
        followersUrl: true,
        followingUrl: true,
        publicKeyPem: true,
        followerCount: true,
        followingCount: true,
        postCount: true,
        isPrivate: true,
        createdAt: true,
        fieldsJson: true,
        alsoKnownAsJson: true,
        movedTo: true,
      },
    });

    if (!actor) return c.json({ error: "Actor not found" }, 404);

    const showCollections =
      !actor.isPrivate || canViewPrivateActorCollections(c, actor.apId);

    const actorResponse: Record<string, unknown> = {
      "@context": ACTOR_CONTEXT,
      id: actor.apId,
      type: actor.type,
      preferredUsername: actor.preferredUsername,
      name: actor.name,
      summary: actor.summary,
      url: `${baseUrl}/users/${username}`,
      icon: actor.iconUrl
        ? { type: "Image", url: safeUrlJoin(baseUrl, actor.iconUrl) }
        : undefined,
      image: actor.headerUrl
        ? { type: "Image", url: safeUrlJoin(baseUrl, actor.headerUrl) }
        : undefined,
      inbox: actor.inbox,
      outbox: showCollections ? actor.outbox : undefined,
      followers: showCollections ? actor.followersUrl : undefined,
      following: showCollections ? actor.followingUrl : undefined,
      // Advertise sharedInbox so remote servers can deduplicate fan-out
      // delivery (Mastodon convention). The endpoint accepts signed
      // activities just like the per-actor inbox.
      endpoints: {
        sharedInbox: `${baseUrl}/ap/inbox`,
      },
      publicKey: buildPublicKey(actor.apId, actor.publicKeyPem),
      discoverable: !actor.isPrivate,
      // Advertise the lock so remote servers know inbound follows are held
      // pending (handleFollow keeps them pending for private accounts). Mirrors
      // the Update(Person) object built in actors.ts.
      manuallyApprovesFollowers: Boolean(actor.isPrivate),
      published: toIso8601(actor.createdAt),
    };

    // Structured profile metadata -> PropertyValue attachments (Mastodon
    // convention). Stored as a JSON array of { name, value }.
    const fields = safeJsonParse<Array<{ name?: unknown; value?: unknown }>>(
      actor.fieldsJson,
      [],
    );
    if (Array.isArray(fields) && fields.length > 0) {
      actorResponse.attachment = fields
        .filter(
          (f) => typeof f?.name === "string" && typeof f?.value === "string",
        )
        .map((f) => ({
          type: "PropertyValue",
          name: f.name as string,
          value: f.value as string,
        }));
    }

    // Account-migration declarations. `alsoKnownAs` lists the aliases this
    // account claims; `movedTo` (when set) points remote servers at the new
    // account so they can process a Move.
    const alsoKnownAs = safeJsonParse<string[]>(actor.alsoKnownAsJson, []);
    if (Array.isArray(alsoKnownAs) && alsoKnownAs.length > 0) {
      actorResponse.alsoKnownAs = alsoKnownAs.filter(
        (a) => typeof a === "string",
      );
    }
    if (actor.movedTo) {
      actorResponse.movedTo = actor.movedTo;
    }

    // Remove undefined fields
    for (const key of Object.keys(actorResponse)) {
      if (actorResponse[key] === undefined) {
        delete actorResponse[key];
      }
    }

    return activityJson(c, actorResponse);
  },
);

// ---------------------------------------------------------------------------
// Group Actor / Instance Community (cached 10 minutes)
// ---------------------------------------------------------------------------

ap.get(
  "/ap/actor",
  withCache({
    ttl: CacheTTL.ACTIVITYPUB_ACTOR,
    cacheTag: CacheTags.COMMUNITY,
  }),
  async (c) => {
    const baseUrl = c.env.APP_URL;
    const instanceActor = await getInstanceActor(c);

    const actorResponse = {
      "@context": [
        ...AP_CONTEXT,
        {
          apc: "https://yurucommu.com/ns/apc#",
          rooms: { "@id": "apc:rooms", "@type": "@id" },
          joinPolicy: "apc:joinPolicy",
          postPolicy: "apc:postPolicy",
          visibility: "apc:visibility",
        },
      ],
      id: instanceActor.apId,
      type: "Group",
      preferredUsername: instanceActor.preferredUsername,
      name: instanceActor.name || "Yurucommu",
      summary: instanceActor.summary || "",
      inbox: `${baseUrl}/ap/actor/inbox`,
      outbox: `${baseUrl}/ap/actor/outbox`,
      followers: `${baseUrl}/ap/actor/followers`,
      following: `${baseUrl}/ap/actor/following`,
      endpoints: {
        sharedInbox: `${baseUrl}/ap/inbox`,
      },
      publicKey: buildPublicKey(instanceActor.apId, instanceActor.publicKeyPem),
    };

    return activityJson(c, actorResponse);
  },
);

// ---------------------------------------------------------------------------
// Community Group Actor (cached 10 minutes)
//
// A yurucommu community federates as a standard fediverse Group actor
// (Lemmy/Mobilizon style): remotes WebFinger `acct:<name>@host`, fetch this
// document, and Follow the inbox to join. Only PUBLIC, non-deleted communities
// are served (a private community's existence is members-only). The human web
// page (`/groups/<name>`) is already an SPA route, so `url` resolves.
// ---------------------------------------------------------------------------

ap.get(
  "/ap/groups/:name",
  withCache({
    ttl: CacheTTL.ACTIVITYPUB_ACTOR,
    cacheTag: CacheTags.COMMUNITY,
  }),
  async (c) => {
    const db = c.get("db");
    const baseUrl = c.env.APP_URL;
    const name = c.req.param("name");
    const community = await loadFederatedCommunity(
      db,
      communityApId(baseUrl.replace(/\/+$/, ""), name),
    );
    if (!community) return c.json({ error: "Community not found" }, 404);

    const actorResponse: Record<string, unknown> = {
      "@context": ACTOR_CONTEXT,
      id: community.apId,
      type: "Group",
      preferredUsername: community.preferredUsername,
      name: community.name,
      summary: community.summary ?? "",
      url: `${baseUrl}/groups/${community.preferredUsername}`,
      icon: community.iconUrl
        ? { type: "Image", url: safeUrlJoin(baseUrl, community.iconUrl) }
        : undefined,
      inbox: community.inbox,
      outbox: community.outbox,
      followers: community.followersUrl,
      // Lemmy/Mobilizon convention: the collection of actors that moderate this
      // group (its owner + moderators). Lets those consumers attribute and
      // authorize moderation activities.
      moderators: `${community.apId}/moderators`,
      endpoints: {
        sharedInbox: `${baseUrl}/ap/inbox`,
      },
      publicKey: buildPublicKey(community.apId, community.publicKeyPem),
      discoverable: true,
      // open-join communities auto-accept Follows; approval/invite hold them
      // pending (the inbox Follow handler enforces this).
      manuallyApprovesFollowers: community.joinPolicy !== "open",
      published: toIso8601(community.createdAt),
    };

    for (const key of Object.keys(actorResponse)) {
      if (actorResponse[key] === undefined) delete actorResponse[key];
    }

    return activityJson(c, actorResponse);
  },
);

// ---------------------------------------------------------------------------
// Shared inbox (Mastodon convention)
//
// The shared inbox POST handler (`/ap/inbox`) lives in `inbox.ts` alongside
// the per-actor inbox so it reuses the same signature-verify / dedup / store
// pipeline and dispatch logic. It is mounted via `inboxRoutes` below.
// ---------------------------------------------------------------------------

ap.route("/", inboxRoutes);
ap.route("/", outboxRoutes);

export default ap;
