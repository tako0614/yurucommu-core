import { Hono } from "hono";
import type { Context } from "hono";
import { and, asc, count, eq } from "drizzle-orm";
import type { Env, Variables } from "../types.ts";
import { actors, objects as objectsTable } from "../../db/index.ts";
import { notDeleted } from "../../db/index.ts";
import { actorApId, getDomain, safeJsonParse } from "../federation-helpers.ts";
import {
  getInstanceActor,
  INSTANCE_ACTOR_USERNAME,
} from "./activitypub/query-helpers.ts";
import inboxRoutes from "./activitypub/inbox.ts";
import outboxRoutes from "./activitypub/outbox.ts";
import { CacheTags, CacheTTL, withCache } from "../middleware/cache.ts";

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

/** Return an activity+json Response via Hono context. */
function activityJson(c: HonoContext, body: Record<string, unknown>): Response {
  c.header("Content-Type", AP_CONTENT_TYPE);
  return c.json(body);
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
  return c.json({
    links: [
      {
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.1",
        href: `${baseUrl}/nodeinfo/2.1`,
      },
    ],
  });
});

ap.get("/nodeinfo/2.1", async (c) => {
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

  return c.json({
    version: "2.1",
    software: {
      name: "yurucommu",
      // Real running version (build-injected env, else the in-sync default
      // constant) instead of a hardcoded literal that silently goes stale.
      version: c.env.YURUCOMMU_SOFTWARE_VERSION || YURUCOMMU_VERSION,
      repository: "https://github.com/tako0614/yurucommu",
    },
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
  });
});

// ---------------------------------------------------------------------------
// WebFinger - Actor Discovery (cached 1 hour)
// ---------------------------------------------------------------------------

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
    let isAcctResource = false;

    if (resource.startsWith("acct:")) {
      isAcctResource = true;
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
      return c.json(
        buildWebFingerResponse(
          INSTANCE_ACTOR_USERNAME,
          domain,
          instanceActor.apId,
          `${baseUrl}/groups`,
        ),
      );
    }

    const actor = await db.query.actors.findFirst({
      where: and(eq(actors.preferredUsername, username), notDeleted(actors)),
      columns: { apId: true, preferredUsername: true },
    });

    const resolvedActor =
      actor ??
      (isAcctResource
        ? await db.query.actors.findFirst({
            where: and(eq(actors.role, "owner"), notDeleted(actors)),
            columns: { apId: true, preferredUsername: true },
            orderBy: [asc(actors.createdAt)],
          })
        : null);

    if (!resolvedActor) return c.json({ error: "Actor not found" }, 404);

    const canonicalUsername = resolvedActor.preferredUsername;
    return c.json(
      buildWebFingerResponse(
        username,
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
  withCache({
    ttl: CacheTTL.ACTIVITYPUB_ACTOR,
    cacheTag: CacheTags.ACTOR,
    varyByActor: true,
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
      "@context": AP_CONTEXT,
      id: actor.apId,
      type: actor.type,
      preferredUsername: actor.preferredUsername,
      name: actor.name,
      summary: actor.summary,
      url: `${baseUrl}/users/${username}`,
      icon: actor.iconUrl ? { type: "Image", url: actor.iconUrl } : undefined,
      image: actor.headerUrl
        ? { type: "Image", url: actor.headerUrl }
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
      published: actor.createdAt,
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
// Shared inbox (Mastodon convention)
//
// The shared inbox POST handler (`/ap/inbox`) lives in `inbox.ts` alongside
// the per-actor inbox so it reuses the same signature-verify / dedup / store
// pipeline and dispatch logic. It is mounted via `inboxRoutes` below.
// ---------------------------------------------------------------------------

ap.route("/", inboxRoutes);
ap.route("/", outboxRoutes);

export default ap;
