import { Hono } from "hono";
import type { Context } from "hono";
import { and, asc, count, desc, eq, lt } from "drizzle-orm";
import type { Env, Variables } from "../types.ts";
import {
  actors,
  communities,
  objects as objectsTable,
} from "../../db/index.ts";
import { notDeleted } from "../../db/index.ts";
import { actorApId, getDomain, parseLimit } from "../federation-helpers.ts";
import {
  getInstanceActor,
  INSTANCE_ACTOR_USERNAME,
  MAX_ROOM_STREAM_LIMIT,
  roomApId,
} from "./activitypub/query-helpers.ts";
import inboxRoutes from "./activitypub/inbox.ts";
import outboxRoutes from "./activitypub/outbox.ts";
import { CacheTags, CacheTTL, withCache } from "../middleware/cache.ts";
import {
  communityWhere,
  resolveCommunityApId,
} from "./communities/membership-shared.ts";

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

const APC_ROOM_CONTEXT = {
  apc: "https://yurucommu.com/ns/apc#",
  joinPolicy: "apc:joinPolicy",
  postPolicy: "apc:postPolicy",
  visibility: "apc:visibility",
} as const;

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
      return c.json({
        error: "Invalid resource format",
      }, 400);
    }

    const baseUrl = c.env.APP_URL;
    const currentDomain = getDomain(baseUrl);

    if (domain !== currentDomain) {
      return c.json({ error: "Actor not found" }, 404);
    }

    if (username === INSTANCE_ACTOR_USERNAME) {
      const instanceActor = await getInstanceActor(c);
      return c.json(buildWebFingerResponse(
        INSTANCE_ACTOR_USERNAME,
        domain,
        instanceActor.apId,
        `${baseUrl}/groups`,
      ));
    }

    const actor = await db.query.actors.findFirst({
      where: and(eq(actors.preferredUsername, username), notDeleted(actors)),
      columns: { apId: true, preferredUsername: true },
    });

    const resolvedActor = actor ??
      (isAcctResource
        ? await db.query.actors.findFirst({
          where: and(eq(actors.role, "owner"), notDeleted(actors)),
          columns: { apId: true, preferredUsername: true },
          orderBy: [asc(actors.createdAt)],
        })
        : null);

    if (!resolvedActor) return c.json({ error: "Actor not found" }, 404);

    const canonicalUsername = resolvedActor.preferredUsername;
    return c.json(buildWebFingerResponse(
      username,
      domain,
      resolvedActor.apId,
      `${baseUrl}/users/${canonicalUsername}`,
    ));
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
      },
    });

    if (!actor) return c.json({ error: "Actor not found" }, 404);

    const showCollections = !actor.isPrivate ||
      canViewPrivateActorCollections(c, actor.apId);

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
      rooms: `${baseUrl}/ap/rooms`,
      joinPolicy: instanceActor.joinPolicy || "open",
      postPolicy: instanceActor.postingPolicy || "members",
      visibility: instanceActor.visibility || "public",
    };

    return activityJson(c, actorResponse);
  },
);

// ---------------------------------------------------------------------------
// Rooms (Communities) (cached 5 minutes)
// ---------------------------------------------------------------------------

ap.get(
  "/ap/rooms",
  withCache({
    ttl: CacheTTL.COMMUNITY,
    cacheTag: CacheTags.COMMUNITY,
  }),
  async (c) => {
    const db = c.get("db");
    const baseUrl = c.env.APP_URL;

    const rooms = await db.query.communities.findMany({
      where: notDeleted(communities),
      columns: {
        preferredUsername: true,
        name: true,
        summary: true,
        visibility: true,
        joinPolicy: true,
        postPolicy: true,
      },
      orderBy: asc(communities.createdAt),
    });

    const items = rooms.map((room) => ({
      id: roomApId(baseUrl, room.preferredUsername),
      type: "Group",
      name: room.name,
      summary: room.summary || "",
      visibility: room.visibility || "public",
      joinPolicy: room.joinPolicy || "open",
      postPolicy: room.postPolicy || "members",
    }));

    return c.json({
      "@context": ["https://www.w3.org/ns/activitystreams", APC_ROOM_CONTEXT],
      id: `${baseUrl}/ap/rooms`,
      type: "OrderedCollection",
      totalItems: items.length,
      orderedItems: items,
    });
  },
);

ap.get("/ap/rooms/:roomId", async (c) => {
  const db = c.get("db");
  const baseUrl = c.env.APP_URL;
  const roomId = c.req.param("roomId");

  const room = await db.query.communities.findFirst({
    where: and(
      communityWhere(resolveCommunityApId(baseUrl, roomId), roomId),
      notDeleted(communities),
    ),
    columns: {
      apId: true,
      preferredUsername: true,
      name: true,
      summary: true,
      inbox: true,
      outbox: true,
      followersUrl: true,
      visibility: true,
      joinPolicy: true,
      postPolicy: true,
      publicKeyPem: true,
    },
  });

  if (!room) return c.json({ error: "Room not found" }, 404);

  const roomUrl = roomApId(baseUrl, room.preferredUsername);

  return c.json({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      { ...APC_ROOM_CONTEXT, stream: { "@id": "apc:stream", "@type": "@id" } },
    ],
    id: roomUrl,
    type: "Group",
    preferredUsername: room.preferredUsername,
    name: room.name,
    summary: room.summary || "",
    inbox: room.inbox,
    outbox: room.outbox,
    followers: room.followersUrl,
    publicKey: buildPublicKey(room.apId, room.publicKeyPem),
    visibility: room.visibility || "public",
    joinPolicy: room.joinPolicy || "open",
    postPolicy: room.postPolicy || "members",
    stream: `${roomUrl}/stream`,
  });
});

ap.get("/ap/rooms/:roomId/stream", async (c) => {
  const db = c.get("db");
  const baseUrl = c.env.APP_URL;
  const roomId = c.req.param("roomId");
  const limit = parseLimit(c.req.query("limit"), 20, MAX_ROOM_STREAM_LIMIT);
  const before = c.req.query("before");

  const community = await db.query.communities.findFirst({
    where: and(
      communityWhere(resolveCommunityApId(baseUrl, roomId), roomId),
      notDeleted(communities),
    ),
    columns: { apId: true, preferredUsername: true },
  });

  if (!community) return c.json({ error: "Room not found" }, 404);

  const conditions = [
    eq(objectsTable.type, "Note"),
    eq(objectsTable.communityApId, community.apId),
    notDeleted(objectsTable),
  ];
  if (before) conditions.push(lt(objectsTable.published, before));

  const objects = await db.query.objects.findMany({
    where: and(...conditions),
    columns: { apId: true, attributedTo: true, content: true, published: true },
    orderBy: desc(objectsTable.published),
    limit,
  });

  const communityRoomUrl = roomApId(baseUrl, community.preferredUsername);

  const items = objects.map((o) => ({
    id: o.apId,
    type: "Note",
    attributedTo: o.attributedTo,
    content: o.content,
    published: o.published,
    room: communityRoomUrl,
  }));

  return c.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${communityRoomUrl}/stream`,
    type: "OrderedCollection",
    totalItems: items.length,
    orderedItems: items,
  });
});

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
