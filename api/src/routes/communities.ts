// Community-related routes

import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import {
  ok,
  fail,
  releaseStore,
  requireInstanceDomain,
  getActorUri,
  getActivityUri,
  ACTIVITYSTREAMS_CONTEXT,
  enqueueDeliveriesToFollowers,
  queueImmediateDelivery,
  webfingerLookup,
  getOrFetchActor,
} from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { makeData } from "../data";
import { notify } from "../lib/notifications";

const communities = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper functions
function uuid() {
  return crypto.randomUUID();
}

function nowISO() {
  return new Date().toISOString();
}

async function requireRole(
  store: ReturnType<typeof makeData>,
  communityId: string,
  userId: string,
  roles: string[],
  env: any,
) {
  const list = await store.listMembershipsByCommunity(communityId);
  const m = (list as any[]).find((x) => (x as any).user_id === userId);
  if (m) return roles.includes((m as any).role);

  // Allow remote members (followers) to act only as baseline Member (never Moderator/Owner)
  const isMember = await requireMember(store, communityId, userId, env);
  if (!isMember) return false;
  return roles.includes("Member") || roles.includes("member");
}

function canInvite(community: any, myRole: string | null) {
  const policy = community?.invite_policy || "owner_mod";
  if (policy === "members") return !!myRole;
  return myRole === "Owner" || myRole === "Moderator";
}

async function loadRemoteMembers(
  store: ReturnType<typeof makeData>,
  env: any,
  communityId: string,
) {
  const instanceDomain = requireInstanceDomain(env);
  const followers =
    (await store.listApFollowers?.(`group:${communityId}`, "accepted", 500).catch(() => [])) ?? [];
  const remotes: any[] = [];
  for (const follower of followers as any[]) {
    const actorId = (follower as any).remote_actor_id;
    if (!actorId) continue;
    try {
      const hostname = new URL(actorId).hostname.toLowerCase();
      if (hostname === instanceDomain.toLowerCase()) continue;
    } catch {
      // ignore invalid URLs
    }

    let actorProfile: any = null;
    try {
      actorProfile = await getOrFetchActor(actorId, env as any);
    } catch {
      actorProfile = null;
    }

    const avatar =
      (Array.isArray(actorProfile?.icon)
        ? actorProfile.icon.find((i: any) => i?.url)?.url
        : actorProfile?.icon?.url) || null;

    const displayName =
      actorProfile?.name || actorProfile?.preferredUsername || actorId;

    remotes.push({
      user_id: actorId,
      role: "Member",
      nickname: null,
      joined_at: (follower as any).accepted_at || (follower as any).created_at || nowISO(),
      display_name: displayName,
      avatar_url: avatar,
      handle: actorProfile?.preferredUsername || actorId,
      remote: true,
    });
  }
  return remotes;
}

async function resolveActorId(
  store: ReturnType<typeof makeData>,
  env: any,
  rawId: string,
): Promise<{ id: string; actorUri: string } | null> {
  const input = String(rawId || "").trim();
  if (!input) return null;
  const instanceDomain = requireInstanceDomain(env);

  // Local
  const local = await store.getUser(input).catch(() => null);
  if (local) {
    const actorUri = getActorUri(local.id, instanceDomain);
    return { id: local.id, actorUri };
  }

  // Actor URI
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const actorUri = input;
    const actor = await getOrFetchActor(actorUri, env as any).catch(() => null);
    if (!actor) return null;
    const handle = actor.preferredUsername || actorUri.split("/").pop() || "unknown";
    const domain = new URL(actorUri).hostname.toLowerCase();
    return { id: `@${handle}@${domain}`, actorUri };
  }

  // acct: @user@domain
  const acct = input.replace(/^@+/, "");
  if (acct.includes("@")) {
    const actorUri = await webfingerLookup(acct, fetch).catch(() => null);
    if (!actorUri) return null;
    const actor = await getOrFetchActor(actorUri, env as any).catch(() => null);
    if (!actor) return null;
    const handle = actor.preferredUsername || acct.split("@")[0] || acct;
    const domain = new URL(actorUri).hostname.toLowerCase();
    return { id: `@${handle}@${domain}`, actorUri };
  }

  return null;
}

async function requireMember(
  store: ReturnType<typeof makeData>,
  communityId: string | null | undefined,
  userId: string,
  env: any,
) {
  if (!communityId) return true;
  const isLocalMember = await store.hasMembership(communityId, userId);
  if (isLocalMember) return true;

  // Fallback: federated member via accepted Follow on the group actor
  const instanceDomain = requireInstanceDomain(env as any);
  const actorUri = getActorUri(userId, instanceDomain);
  const follower = await store.findApFollower?.(`group:${communityId}`, actorUri).catch(() => null);
  return follower?.status === "accepted";
}

// Get/search communities
communities.get("/communities", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  try {
    const url = new URL(c.req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const list = await store.listUserCommunities(user.id);
    if (!q) return ok(c, list);

    // Local filter first
    const filtered = list.filter((comm: any) =>
      (comm?.name || "").toLowerCase().includes(q),
    );

    // If query looks like a remote actor URI or acct, try to resolve a remote Group
    const resolvedRemotes: any[] = [];
    const instanceDomain = requireInstanceDomain(c.env);
    const internalFetcher = fetch;
    const attemptRemoteGroup = async (query: string) => {
      let actorUri: string | null = null;
      const trimmed = query.trim();
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        actorUri = trimmed;
      } else if (trimmed.includes("@")) {
        const acct = trimmed.replace(/^@+/, "");
        actorUri = await webfingerLookup(acct, internalFetcher).catch(() => null);
      }
      if (!actorUri) return;
      const actor = await getOrFetchActor(actorUri, c.env as any, false, internalFetcher).catch(
        () => null,
      );
      if (!actor || actor.type !== "Group") return;
      const domain = (() => {
        try {
          return new URL(actor.id || actorUri).hostname.toLowerCase();
        } catch {
          return null;
        }
      })();
      resolvedRemotes.push({
        id: actor.id,
        name: actor.name || actor.preferredUsername || actor.id,
        description: actor.summary || "",
        icon_url:
          (Array.isArray(actor.icon)
            ? actor.icon.find((i: any) => i?.url)?.url
            : actor.icon?.url) || "",
        domain: domain || instanceDomain,
        ap_id: actor.id,
        remote: true,
      });
    };

    await attemptRemoteGroup(q);

    return ok(c, [...filtered, ...resolvedRemotes]);
  } finally {
    await releaseStore(store);
  }
});

// Create community
communities.post("/communities", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const body = await c.req.json().catch(() => ({})) as any;
  const name = (body.name || "").trim();
  const visibility = body.visibility || "private";
  if (!name) return fail(c, "name is required");

  const id = uuid();
  const instanceDomain = requireInstanceDomain(c.env);
  const ap_id = `https://${instanceDomain}/ap/groups/${id}`;

  const community = {
    id,
    name,
    icon_url: body.icon_url || "",
    visibility,
    created_by: user.id,
    created_at: nowISO(),
    ap_id,
  };
  await store.createCommunity(community);
  await store.setMembership(id, user.id, {
    role: "Owner",
    nickname: body.nickname || user.display_name,
    joined_at: nowISO(),
    status: "active",
  });

  // Generate and save Create Activity for Group
  const groupObject = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Group",
    id: ap_id,
    name: community.name,
    summary: body.description || "",
    attributedTo: getActorUri(user.id, instanceDomain),
    inbox: `https://${instanceDomain}/ap/groups/${id}/inbox`,
    outbox: `https://${instanceDomain}/ap/groups/${id}/outbox`,
    followers: `https://${instanceDomain}/ap/groups/${id}/followers`,
    icon: community.icon_url ? {
      type: "Image",
      mediaType: "image/jpeg",
      url: community.icon_url,
    } : undefined,
  };

  const actorUri = getActorUri(user.id, instanceDomain);
  const activityId = getActivityUri(user.id, `create-group-${id}`, instanceDomain);
  const createActivity = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Create",
    id: activityId,
    actor: actorUri,
    object: groupObject,
    published: new Date(community.created_at).toISOString(),
    to: ["https://www.w3.org/ns/activitystreams#Public"],
  };

  await store.upsertApOutboxActivity({
    id: crypto.randomUUID(),
    local_user_id: user.id,
    activity_id: activityId,
    activity_type: "Create",
    activity_json: JSON.stringify(createActivity),
    object_id: ap_id,
    object_type: "Group",
    created_at: new Date(),
  });

  await enqueueDeliveriesToFollowers(store, user.id, activityId, {
    env: c.env,
  });

  return ok(c, community, 201);
});

// Get community details
communities.get("/communities/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const id = c.req.param("id");
  const community: any = await store.getCommunity(id);
  if (!community) return fail(c, "community not found", 404);
  if (!(await requireMember(store, id, user.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const members = await store.listCommunityMembersWithUsers(id);
  const remoteMembers = await loadRemoteMembers(store, c.env, id);
  const myRole = (members as any[]).find((m) =>
    (m as any).user_id === user.id
  )?.role || null;
  return ok(c, {
    ...community,
    member_count: (members as any[]).length + remoteMembers.length,
    my_role: myRole,
    members: [
      ...(members as any[]).map((m) => ({
      user_id: (m as any).user_id,
      role: (m as any).role,
      nickname: (m as any).nickname,
      joined_at: (m as any).joined_at,
      display_name: (m as any).user?.display_name || "",
      avatar_url: (m as any).user?.avatar_url || "",
      handle: (m as any).user?.handle || null,
      })),
      ...remoteMembers,
    ],
  });
});

// Update community
communities.patch("/communities/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const id = c.req.param("id");
  const community: any = await store.getCommunity(id);
  if (!community) return fail(c, "community not found", 404);
  if (!(await requireRole(store, id, user.id, ["Owner", "Moderator"], c.env))) {
    return fail(c, "forbidden", 403);
  }
  const body = await c.req.json().catch(() => ({})) as any;
  const updates: any = {};
  if (typeof body.name === "string") {
    updates.name = String(body.name).slice(0, 200);
  }
  if (typeof body.icon_url === "string") {
    updates.icon_url = String(body.icon_url).slice(0, 1000);
  }
  if (typeof body.description === "string") {
    updates.description = String(body.description).slice(0, 5000);
  }
  if (
    typeof body.invite_policy === "string" &&
    ["owner_mod", "members"].includes(body.invite_policy)
  ) updates.invite_policy = body.invite_policy;
  const updated = await store.updateCommunity(id, updates);

  // Generate and save Update Activity for Group
  const instanceDomain = requireInstanceDomain(c.env);
  const ap_id = (community as any).ap_id || `https://${instanceDomain}/ap/groups/${id}`;

  const groupObject = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Group",
    id: ap_id,
    name: updated?.name || community.name,
    summary: updated?.description || community.description || "",
    attributedTo: getActorUri(user.id, instanceDomain),
    inbox: `https://${instanceDomain}/ap/groups/${id}/inbox`,
    outbox: `https://${instanceDomain}/ap/groups/${id}/outbox`,
    followers: `https://${instanceDomain}/ap/groups/${id}/followers`,
    icon: (updated?.icon_url || community.icon_url) ? {
      type: "Image",
      mediaType: "image/jpeg",
      url: updated?.icon_url || community.icon_url,
    } : undefined,
  };

  const actorUri = getActorUri(user.id, instanceDomain);
  const activityId = getActivityUri(
    user.id,
    `update-group-${id}-${Date.now()}`,
    instanceDomain,
  );
  const updateActivity = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Update",
    id: activityId,
    actor: actorUri,
    object: groupObject,
    published: new Date().toISOString(),
    to: ["https://www.w3.org/ns/activitystreams#Public"],
  };

  await store.upsertApOutboxActivity({
    id: crypto.randomUUID(),
    local_user_id: user.id,
    activity_id: activityId,
    activity_type: "Update",
    activity_json: JSON.stringify(updateActivity),
    object_id: ap_id,
    object_type: "Group",
    created_at: new Date(),
  });

  await enqueueDeliveriesToFollowers(store, user.id, activityId, {
    env: c.env,
  });

  return ok(c, updated);
});

// Get community channels
communities.get("/communities/:id/channels", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const community = await store.getCommunity(community_id);
  if (!community) return fail(c, "community not found", 404);
  if (!(await requireMember(store, community_id, user.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const list = await store.listChannelsByCommunity(community_id);
  // ensure at least 'general' exists
  if (!list.find((x: any) => x.id === "general")) {
    await store.createChannel(community_id, {
      id: "general",
      name: "general",
      created_at: new Date().toISOString(),
    });
  }
  const final = await store.listChannelsByCommunity(community_id);
  return ok(c, final);
});

// Create channel
communities.post("/communities/:id/channels", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const community = await store.getCommunity(community_id);
  if (!community) return fail(c, "community not found", 404);
  if (
    !(await requireRole(store, community_id, user.id, ["Owner", "Moderator"], c.env))
  ) return fail(c, "forbidden", 403);
  const body = await c.req.json().catch(() => ({})) as any;
  let name = String(body.name || "").trim();
  if (!name) return fail(c, "name is required", 400);
  let base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  if (!base) base = `ch-${crypto.randomUUID().slice(0, 8)}`;
  let id = base;
  const existing = await store.listChannelsByCommunity(community_id);
  let n = 1;
  while (existing.find((x: any) => x.id === id)) id = `${base}-${n++}`;
  const created = await store.createChannel(community_id, {
    id,
    name,
    created_at: new Date().toISOString(),
  });
  return ok(c, created, 201);
});

// Update channel
communities.patch("/communities/:id/channels/:channelId", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const channelId = c.req.param("channelId");
  const community = await store.getCommunity(community_id);
  if (!community) return fail(c, "community not found", 404);
  if (!(await requireRole(store, community_id, user.id, ["Owner", "Moderator"], c.env))) {
    return fail(c, "forbidden", 403);
  }
  const body = await c.req.json().catch(() => ({})) as any;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const updated = await store.updateChannel?.(community_id, channelId, { name });
  if (!updated) return fail(c, "channel not found", 404);
  return ok(c, updated);
});

// Delete channel
communities.delete("/communities/:id/channels/:channelId", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const channelId = c.req.param("channelId");
  const community = await store.getCommunity(community_id);
  if (!community) return fail(c, "community not found", 404);
  if (!(await requireRole(store, community_id, user.id, ["Owner", "Moderator"], c.env))) {
    return fail(c, "forbidden", 403);
  }
  if (channelId === "general") return fail(c, "cannot delete general channel", 400);
  await store.deleteChannel(community_id, channelId);
  return ok(c, { deleted: true });
});

// Create invite code
communities.post("/communities/:id/invites", auth, async (c) => {
  return fail(c, "invite codes are disabled; use direct invites", 410);
});

// List invite codes
communities.get("/communities/:id/invites", auth, async (c) => {
  return fail(c, "invite codes are disabled; use direct invites", 410);
});

// Disable invite code
communities.post("/communities/:id/invites/:code/disable", auth, async (c) => {
  return fail(c, "invite codes are disabled; use direct invites", 410);
});

// Reset all invites
communities.post("/communities/:id/invites/reset", auth, async (c) => {
  return fail(c, "invite codes are disabled; use direct invites", 410);
});

// Join community with invite code
communities.post("/communities/:id/join", auth, async (c) => {
  return fail(c, "invite codes are disabled; ask for a direct invite", 410);
});

// Leave community
communities.post("/communities/:id/leave", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const community = await store.getCommunity(community_id);
  if (!community) return fail(c, "community not found", 404);
  const members = await store.listCommunityMembersWithUsers(community_id);
  const membership = (members as any[]).find((m: any) => m.user_id === user.id);
  if (!membership) return fail(c, "not a member", 400);
  if (membership.role === "Owner") {
    return fail(c, "owner cannot leave community", 400);
  }
  if (store.removeMembership) {
    await store.removeMembership(community_id, user.id);
  } else {
    await store.setMembership(community_id, user.id, {
      role: membership.role || "Member",
      nickname: membership.nickname,
      joined_at: membership.joined_at || nowISO(),
      status: "left",
    });
  }
  return ok(c, { community_id, left: true });
});

// Send direct member invites
communities.post("/communities/:id/direct-invites", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const community_id = c.req.param("id");
  const community: any = await store.getCommunity(community_id);
  if (!community) return fail(c, "community not found", 404);
  if (!(await requireMember(store, community_id, me.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const members = await store.listCommunityMembersWithUsers(community_id);
  const myRole = (members as any[]).find((m) =>
    (m as any).user_id === me.id
  )?.role || null;
  if (!canInvite(community, myRole)) return fail(c, "forbidden", 403);
  const body = await c.req.json().catch(() => ({})) as any;
  const ids: string[] = Array.isArray(body.user_ids)
    ? body.user_ids
    : (body.user_id ? [String(body.user_id)] : []);
  if (!ids.length) return fail(c, "user_ids required", 400);

  const instanceDomain = requireInstanceDomain(c.env);
  const ap_id = (community as any).ap_id ||
    `https://${instanceDomain}/ap/groups/${community_id}`;

  const created: any[] = [];
  for (const uid of ids) {
    const resolved = await resolveActorId(store, c.env, uid);
    if (!resolved) continue;
    if (await requireMember(store, community_id, resolved.id, c.env)) continue;
    const invId = crypto.randomUUID();
    const inv = await store.createMemberInvite({
      id: invId,
      community_id,
      invited_user_id: resolved.id,
      invited_by: me.id,
      status: "pending",
      created_at: nowISO(),
    });
    await notify(
      store,
      c.env as Bindings,
      resolved.id,
      "community_invite",
      me.id,
      "community",
      community_id,
      `${me.display_name} が「${community.name}」に招待しました`,
    );
    created.push(inv);

    // Generate and save Invite Activity
    const actorUri = getActorUri(me.id, instanceDomain);
    const targetActorUri = resolved.actorUri;
    const activityId = getActivityUri(me.id, `invite-${invId}`, instanceDomain);
    const inviteActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Invite",
      id: activityId,
      actor: actorUri,
      object: ap_id,
      target: targetActorUri,
      published: new Date().toISOString(),
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: me.id,
      activity_id: activityId,
      activity_type: "Invite",
      activity_json: JSON.stringify(inviteActivity),
      object_id: ap_id,
      object_type: "Group",
      created_at: new Date(),
    });

    // Enqueue delivery to invited user
    const targetActor =
      (await store.findApActor?.(targetActorUri)) ??
      (await getOrFetchActor(targetActorUri, c.env as any).catch(() => null));
    const inboxUrl =
      (targetActor as any)?.inbox ||
      (targetActor as any)?.endpoints?.sharedInbox ||
      (targetActor as any)?.inbox_url;
    if (inboxUrl) {
      await queueImmediateDelivery(store, c.env as any, {
        id: crypto.randomUUID(),
        activity_id: activityId,
        target_inbox_url: inboxUrl,
        status: "pending",
        created_at: new Date(),
      });
    }
  }
  return ok(c, created, 201);
});

// Accept community invitation
communities.post("/communities/:id/invitations/accept", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const community_id = c.req.param("id");
  const community = await store.getCommunity(community_id);
  if (!community) return fail(c, "community not found", 404);
  const list: any[] = await store.listMemberInvitesForUser(me.id);
  const inv = list.find((x: any) =>
    x.community_id === community_id && x.status === "pending"
  );
  if (!inv) return fail(c, "no pending invite", 400);
  await store.setMemberInviteStatus(inv.id, "accepted");
  await store.setMembership(community_id, me.id, {
    role: "Member",
    nickname: me.display_name,
    joined_at: nowISO(),
    status: "active",
  });
  return ok(c, { community_id, user_id: me.id });
});

// Decline community invitation
communities.post("/communities/:id/invitations/decline", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const community_id = c.req.param("id");
  const community = await store.getCommunity(community_id);
  if (!community) return fail(c, "community not found", 404);
  const list: any[] = await store.listMemberInvitesForUser(me.id);
  const inv = list.find((x: any) =>
    x.community_id === community_id && x.status === "pending"
  );
  if (!inv) return fail(c, "no pending invite", 400);
  await store.setMemberInviteStatus(inv.id, "declined");
  return ok(c, { community_id, declined: true });
});

// Get community members
communities.get("/communities/:id/members", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const community_id = c.req.param("id");
  const community = await store.getCommunity(community_id);
  if (!community) return fail(c, "community not found", 404);
  if (!(await requireMember(store, community_id, me.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const members = await store.listCommunityMembersWithUsers(community_id);
  const remoteMembers = await loadRemoteMembers(store, c.env, community_id);
  return ok(c, [...members, ...remoteMembers]);
});

// Get community posts
communities.get("/communities/:id/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  if (!(await store.getCommunity(community_id))) {
    return fail(c, "community not found", 404);
  }
  if (!(await requireMember(store, community_id, user.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const list: any[] = await store.listPostsByCommunity(community_id);
  list.sort((a, b) =>
    (Number(b.pinned) - Number(a.pinned)) ||
    (a.created_at < b.created_at ? 1 : -1)
  );
  return ok(c, list);
});

// Get reactions summary for community
communities.get("/communities/:id/reactions-summary", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  if (!(await store.getCommunity(community_id))) {
    return fail(c, "community not found", 404);
  }
  if (!(await requireMember(store, community_id, user.id, c.env))) {
    return fail(c, "forbidden", 403);
  }
  const summary: Record<string, Record<string, number>> = {};
  const posts = await store.listPostsByCommunity(community_id);
  for (const p of posts as any[]) {
    const reactions = await store.listReactionsByPost((p as any).id);
    for (const r of reactions as any[]) {
      if (!summary[(p as any).id]) summary[(p as any).id] = {};
      summary[(p as any).id][(r as any).emoji] =
        (summary[(p as any).id][(r as any).emoji] || 0) + 1;
    }
  }
  return ok(c, summary);
});

export default communities;
