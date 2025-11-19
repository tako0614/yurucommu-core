// Prisma-based data access layer for Cloudflare D1
// Database API implementation using dependency injection

/// <reference types="@cloudflare/workers-types" />

import type { PrismaClient } from "@prisma/client";
import { normalizeStoryItems } from "@takos/platform";
import type { DatabaseAPI } from "./types";
import type { DatabaseConfig } from "./prisma-factory";

const toBool = (v: number | boolean | null | undefined) =>
  !!(v && Number(v) !== 0);

// Small domain types to reduce `any` usage and improve readability.
type NullableDate = string | Date | null | undefined;

const mapUser = (row: any) => (row ? { ...row, handle: row.id } : null);

interface ChannelRow {
  id: string;
  community_id: string;
  name: string;
  created_at: string;
}

/**
 * Creates a Database API instance with the provided configuration
 * This function injects the Prisma client factory, allowing different
 * implementations to use different database configurations
 */
export function createDatabaseAPI(config: DatabaseConfig): DatabaseAPI {
  const prisma = config.createPrismaClient(config.DB);
  const db = config.DB;

  if (!db) {
    throw new Error("D1 database binding (DB) is required");
  }

  const runStatement = async (
    sql: string,
    params: any[] = [],
    expectRows = false,
  ) => {
    let stmt = db.prepare(sql);
    if (params.length > 0) {
      stmt = stmt.bind(...params);
    }
    const command = sql.trim().toLowerCase();
    const firstWord = command.split(/\s+/)[0] || "";
    const shouldFetch =
      expectRows ||
      firstWord === "select" ||
      firstWord === "pragma" ||
      firstWord === "with";
    if (shouldFetch) {
      const res = await stmt.all();
      return res.results ?? [];
    }
    await stmt.run();
    return [];
  };

  // -------------- Users --------------
  const getUser = async (id: string) => {
    const row = await (prisma as any).users.findUnique({
      where: { id },
    });
    return mapUser(row);
  };

  const searchUsersByName = async (q: string, limit: number = 20) => {
    const list = await (prisma as any).users.findMany({
      where: { display_name: { contains: q } },
      take: limit,
    });
    return list.map(mapUser);
  };

  const createUser = async (
    user: {
      id?: string;
      handle?: string | null;
      display_name: string;
      avatar_url?: string;
      created_at?: string | Date;
      is_private?: number | boolean;
      profile_completed_at?: string | Date | null;
    },
  ) => {
    const id = (user.handle ?? user.id)?.trim();
    if (!id) throw new Error("user id is required");
    const created = await (prisma as any).users.create({
      data: {
        id,
        display_name: user.display_name ?? "",
        avatar_url: user.avatar_url ?? "",
        created_at: user.created_at ? new Date(user.created_at) : new Date(),
        is_private:
          user.is_private === undefined
            ? 1
            : Number(user.is_private ? 1 : 0),
        profile_completed_at: user.profile_completed_at
          ? new Date(user.profile_completed_at)
          : null,
      },
    });
    return mapUser(created);
  };

  const updateUser = async (
    id: string,
    fields: {
      display_name?: string;
      avatar_url?: string;
      is_private?: number | boolean;
      profile_completed_at?: string | Date | null;
    },
  ) => {
    const data: Record<string, any> = {};
    if (fields.display_name !== undefined) {
      data.display_name = fields.display_name ?? "";
    }
    if (fields.avatar_url !== undefined) {
      data.avatar_url = fields.avatar_url ?? "";
    }
    if (fields.is_private !== undefined) {
      data.is_private = Number(fields.is_private ? 1 : 0);
    }
    if (fields.profile_completed_at !== undefined) {
      data.profile_completed_at = fields.profile_completed_at
        ? new Date(fields.profile_completed_at)
        : null;
    }
    if (!Object.keys(data).length) {
      return getUser(id);
    }
    const row = await (prisma as any).users.update({
      where: { id },
      data,
    });
    return mapUser(row);
  };

  const getUserByHandle = async (handle: string) => getUser(handle);

  const getAccountByProvider = async (
    provider: string,
    providerAccountId: string,
  ) =>
    (prisma as any).user_accounts.findUnique({
      where: {
        provider_provider_account_id: {
          provider,
          provider_account_id: providerAccountId,
        },
      },
    });

  const createUserAccount = async (
    account: {
      id: string;
      user_id: string;
      provider: string;
      provider_account_id: string;
      created_at?: string | Date;
      updated_at?: string | Date;
    },
  ) => {
    const row = await (prisma as any).user_accounts.create({
      data: {
        id: account.id,
        user_id: account.user_id,
        provider: account.provider,
        provider_account_id: account.provider_account_id,
        created_at: account.created_at
          ? new Date(account.created_at)
          : new Date(),
        updated_at: account.updated_at
          ? new Date(account.updated_at)
          : new Date(),
      },
    });
    return row;
  };

  const updateAccountUser = async (
    provider: string,
    providerAccountId: string,
    user_id: string,
  ) =>
    (prisma as any).user_accounts.update({
      where: {
        provider_provider_account_id: {
          provider,
          provider_account_id: providerAccountId,
        },
      },
      data: { user_id, updated_at: new Date() },
    });

  const updateUserAccountPassword = async (
    accountId: string,
    newPasswordHash: string,
  ) =>
    (prisma as any).user_accounts.update({
      where: {
        id: accountId,
      },
      data: { provider_account_id: newPasswordHash, updated_at: new Date() },
    });

  const listAccountsByUser = async (user_id: string) =>
    (prisma as any).user_accounts.findMany({ where: { user_id } });

  const renameUserId = async (oldId: string, newId: string) => {
    if (!oldId || !newId) throw new Error("invalid user id");
    if (oldId === newId) return getUser(oldId);
    const existing = await (prisma as any).users.findUnique({
      where: { id: newId },
    });
    if (existing) throw new Error("user id already exists");

    await (prisma as any).$transaction(async (tx: any) => {
      await tx.users.update({
        where: { id: oldId },
        data: { id: newId },
      });
      await tx.communities.updateMany({
        where: { created_by: oldId },
        data: { created_by: newId },
      });
      await tx.memberships.updateMany({
        where: { user_id: oldId },
        data: { user_id: newId },
      });
      await tx.member_invites.updateMany({
        where: { invited_user_id: oldId },
        data: { invited_user_id: newId },
      });
      await tx.member_invites.updateMany({
        where: { invited_by: oldId },
        data: { invited_by: newId },
      });
      await tx.invites.updateMany({
        where: { created_by: oldId },
        data: { created_by: newId },
      });
      await tx.posts.updateMany({
        where: { author_id: oldId },
        data: { author_id: newId },
      });
      await tx.post_reactions.updateMany({
        where: { user_id: oldId },
        data: { user_id: newId },
      });
      await tx.comments.updateMany({
        where: { author_id: oldId },
        data: { author_id: newId },
      });
      await tx.stories.updateMany({
        where: { author_id: oldId },
        data: { author_id: newId },
      });
      await tx.friendships.updateMany({
        where: { requester_id: oldId },
        data: { requester_id: newId },
      });
      await tx.friendships.updateMany({
        where: { addressee_id: oldId },
        data: { addressee_id: newId },
      });
      await tx.notifications.updateMany({
        where: { user_id: oldId },
        data: { user_id: newId },
      });
      await tx.notifications.updateMany({
        where: { actor_id: oldId },
        data: { actor_id: newId },
      });
      await tx.push_devices.updateMany({
        where: { user_id: oldId },
        data: { user_id: newId },
      });
      await tx.sessions.updateMany({
        where: { user_id: oldId },
        data: { user_id: newId },
      });
      await tx.user_accounts.updateMany({
        where: { user_id: oldId },
        data: { user_id: newId, updated_at: new Date() },
      });
      await tx.chat_dm_messages.updateMany({
        where: { author_id: oldId },
        data: { author_id: newId },
      });
      await tx.chat_channel_messages.updateMany({
        where: { author_id: oldId },
        data: { author_id: newId },
      });
      await tx.ap_keypairs.updateMany({
        where: { user_id: oldId },
        data: { user_id: newId },
      });
      await tx.ap_outbox_activities.updateMany({
        where: { local_user_id: oldId },
        data: { local_user_id: newId },
      });
      await tx.ap_inbox_activities.updateMany({
        where: { local_user_id: oldId },
        data: { local_user_id: newId },
      });
      await tx.ap_follows.updateMany({
        where: { local_user_id: oldId },
        data: { local_user_id: newId },
      });
      await tx.ap_followers.updateMany({
        where: { local_user_id: oldId },
        data: { local_user_id: newId },
      });
    });

    return getUser(newId);
  };

  // -------------- JWT Authentication --------------
  const getUserJwtSecret = async (userId: string): Promise<string | null> => {
    const user = await (prisma as any).users.findUnique({
      where: { id: userId },
      select: { jwt_secret: true },
    });
    return user?.jwt_secret || null;
  };

  const setUserJwtSecret = async (userId: string, secret: string): Promise<void> => {
    await (prisma as any).users.update({
      where: { id: userId },
      data: { jwt_secret: secret },
    });
  };

  // -------------- Friendships --------------
  type FriendStatus = "pending" | "accepted" | "rejected";

  const getFriendRequest = async (requester_id: string, addressee_id: string) =>
    (prisma as any).friendships.findFirst({
      where: {
        requester_id,
        addressee_id,
      },
    });

  const getFriendshipBetween = async (user_id: string, other_id: string) =>
    (prisma as any).friendships.findFirst({
      where: {
        OR: [
          { requester_id: user_id, addressee_id: other_id },
          { requester_id: other_id, addressee_id: user_id },
        ],
      },
    });

  const createFriendRequest = async (
    requester_id: string,
    addressee_id: string,
  ) => {
    await (prisma as any).friendships.upsert({
      where: {
        requester_id_addressee_id: {
          requester_id,
          addressee_id,
        },
      },
      create: {
        requester_id,
        addressee_id,
        status: "pending",
        created_at: new Date(),
      },
      update: { status: "pending" },
    });
    return getFriendRequest(requester_id, addressee_id);
  };

  const setFriendStatus = async (
    requester_id: string,
    addressee_id: string,
    status: FriendStatus,
  ) => {
    await (prisma as any).friendships.update({
      where: {
        requester_id_addressee_id: {
          requester_id,
          addressee_id,
        },
      },
      data: { status },
    });
    return getFriendRequest(requester_id, addressee_id);
  };

  const listFriendships = async (
    user_id: string,
    status: FriendStatus | null = null,
  ) =>
    (prisma as any).friendships.findMany({
      where: {
        ...(status ? { status } : {}),
        OR: [
          { requester_id: user_id },
          { addressee_id: user_id },
        ],
      },
      include: { requester: true, addressee: true },
    });

  // -------------- Notifications --------------
  const addNotification = async (
    n: {
      id: string;
      user_id: string;
      type: string;
      actor_id: string;
      ref_type: string;
      ref_id: string;
      message?: string;
      created_at?: string | Date;
      read?: boolean | number;
    },
  ) => {
    await (prisma as any).notifications.create({
      data: {
        id: n.id,
        user_id: n.user_id,
        type: n.type,
        actor_id: n.actor_id,
        ref_type: n.ref_type,
        ref_id: n.ref_id,
        message: n.message ?? "",
        created_at: n.created_at ? new Date(n.created_at) : new Date(),
        read: (typeof n.read === "boolean"
          ? (n.read ? 1 : 0)
          : (n.read ?? 0)) as number,
      },
    });
    return n;
  };

  const listNotifications = async (user_id: string) => {
    const res = await (prisma as any).notifications.findMany({
      where: { user_id },
    });
    // sort newest first at API
    return (res as Array<any>).sort((
      a,
      b,
    ) => (a.created_at < b.created_at ? 1 : -1)).map((r) => ({
      ...r,
      read: toBool(r.read),
    }));
  };

  const markNotificationRead = async (id: string) => {
    await (prisma as any).notifications.update({
      where: { id },
      data: { read: 1 },
    });
  };

  const countUnreadNotifications = async (user_id: string) => {
    const res = await (prisma as any).notifications.findMany({
      where: { user_id, read: 0 },
    });
    return res.length;
  };

  // -------------- Communities / Memberships --------------
  const createCommunity = async (
    community: {
      id: string;
      name: string;
      icon_url?: string;
      visibility?: string;
      created_by: string;
      created_at: string | Date;
    },
  ) => {
    await (prisma as any).communities.create({
      data: {
        id: community.id,
        name: community.name,
        icon_url: community.icon_url ?? "",
        visibility: community.visibility ?? "private",
        description: "",
        invite_policy: "owner_mod",
        created_by: community.created_by,
        created_at: new Date(community.created_at),
      },
    });
    return community;
  };

  const getCommunity = async (id: string) =>
    (prisma as any).communities.findUnique({
      where: { id },
    });

  const updateCommunity = async (id: string, fields: Record<string, any>) => {
    const allowed = [
      "name",
      "icon_url",
      "description",
      "invite_policy",
      "visibility",
    ];
    const data: any = {};
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) data[k] = v;
    }
    if (Object.keys(data).length === 0) return getCommunity(id);
    await (prisma as any).communities.update({
      where: { id },
      data,
    });
    return getCommunity(id);
  };

  const setMembership = async (
    community_id: string,
    user_id: string,
    v: {
      role?: string;
      nickname?: string;
      joined_at?: string | Date;
      status?: string;
    },
  ) => {
    await (prisma as any).memberships.upsert({
      where: {
        community_id_user_id: { community_id, user_id },
      },
      create: {
        community_id,
        user_id,
        role: v.role ?? "Member",
        nickname: v.nickname ?? "",
        joined_at: v.joined_at ? new Date(v.joined_at) : new Date(),
        status: v.status ?? "active",
      },
      update: {
        role: v.role ?? "Member",
        nickname: v.nickname ?? "",
        joined_at: v.joined_at ? new Date(v.joined_at) : new Date(),
        status: v.status ?? "active",
      },
    });
  };

  const hasMembership = async (community_id: string, user_id: string) => {
    const m = await (prisma as any).memberships.findUnique({
      where: { community_id_user_id: { community_id, user_id } },
    });
    return !!m;
  };

  const listMembershipsByCommunity = async (community_id: string) =>
    (prisma as any).memberships.findMany({ where: { community_id } });

  const listUserCommunities = async (user_id: string) => {
    const mems = await (prisma as any).memberships.findMany({
      where: { user_id },
    });
    const ids = mems.map((m: { community_id: string }) => m.community_id);
    if (ids.length === 0) return [];
    return (prisma as any).communities.findMany({
      where: { id: { in: ids } },
    });
  };

  const listCommunityMembersWithUsers = async (community_id: string) => {
    const mems: any[] = await (prisma as any).memberships.findMany({
      where: { community_id },
    });
    const userIds = Array.from(new Set(mems.map((m: any) => m.user_id)));
    const users = userIds.length
      ? await (prisma as any).users.findMany({
          where: { id: { in: userIds } },
        })
      : [];
    const userMap = new Map<string, any>();
    (users || []).forEach((u: any) => userMap.set(u.id, mapUser(u)));
    return mems.map((m: any) => ({
      user_id: m.user_id,
      role: m.role,
      nickname: m.nickname,
      joined_at: m.joined_at,
      status: m.status,
      user: userMap.get(m.user_id) || null,
    }));
  };

  // -------------- Channels --------------
  const mapChannelRow = (row: any): ChannelRow => ({
    id: row.id,
    community_id: row.community_id,
    name: row.name,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at ?? new Date().toISOString()),
  });

  const listChannelsByCommunity = async (community_id: string) => {
    const rows = await (prisma as any).channels.findMany({
      where: { community_id },
    });
    const mapped = rows.map(mapChannelRow);
    mapped.sort((a: { id: string; name: any; }, b: { id: string; name: any; }) =>
      a.id === "general"
        ? -1
        : b.id === "general"
        ? 1
        : (a.name || "").localeCompare(b.name || ""),
    );
    return mapped;
  };

  const createChannel = async (
    community_id: string,
    channel: { id: string; name: string; created_at?: string | Date },
  ) => {
    const created = await (prisma as any).channels.create({
      data: {
        id: channel.id,
        community_id,
        name: channel.name,
        created_at: channel.created_at ? new Date(channel.created_at) : new Date(),
      },
    });
    return mapChannelRow(created);
  };

  const getChannel = async (community_id: string, id: string) => {
    const row = await (prisma as any).channels.findFirst({
      where: { community_id, id },
    });
    return row ? mapChannelRow(row) : null;
  };

  const deleteChannel = async (community_id: string, id: string) => {
    if (id === "general") return; // never delete general
    await (prisma as any).channels.deleteMany({
      where: { community_id, id },
    });
  };

  // -------------- Invites --------------
  const createInvite = async (invite: {
    code: string;
    community_id: string;
    expires_at?: NullableDate;
    created_by: string;
    max_uses?: number;
    uses?: number;
    active?: boolean | number;
  }) => {
    await (prisma as any).invites.create({
      data: {
        code: invite.code,
        community_id: invite.community_id,
        expires_at: invite.expires_at ? new Date(invite.expires_at) : null,
        created_by: invite.created_by,
        max_uses: invite.max_uses ?? 0,
        uses: invite.uses ?? 0,
        active: (typeof invite.active === "boolean"
          ? (invite.active ? 1 : 0)
          : (invite.active ?? 1)) as number,
      },
    });
    return invite;
  };

  const listInvites = async (community_id: string) => {
    const res = await (prisma as any).invites.findMany({
      where: { community_id },
    });
    return res.map((r: any) => ({
      ...r,
      active: toBool((r as any).active as any),
    })) as any;
  };

  const getInvite = async (code: string) => {
    const r = await (prisma as any).invites.findUnique({
      where: { code },
    });
    return r ? { ...r, active: toBool(r.active) } as any : null;
  };

  const updateInvite = async (code: string, fields: Record<string, any>) => {
    const data: any = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k === "active") data[k] = v ? 1 : 0;
      else data[k] = v;
    }
    await (prisma as any).invites.update({
      where: { code },
      data,
    });
    return getInvite(code);
  };

  const disableInvite = async (code: string) =>
    updateInvite(code, { active: 0 });

  const resetInvites = async (community_id: string) => {
    await (prisma as any).invites.updateMany({
      where: { community_id },
      data: { active: 0 },
    });
  };

  // -------------- Direct Member Invites --------------
  const createMemberInvite = async (
    invite: {
      id: string;
      community_id: string;
      invited_user_id: string;
      invited_by: string;
      status?: string;
      created_at?: string | Date;
    },
  ) => {
    await (prisma as any).member_invites.create({
      data: {
        id: invite.id,
        community_id: invite.community_id,
        invited_user_id: invite.invited_user_id,
        invited_by: invite.invited_by,
        status: invite.status ?? "pending",
        created_at: invite.created_at
          ? new Date(invite.created_at)
          : new Date(),
      },
    });
    return invite;
  };

  const listMemberInvitesByCommunity = async (community_id: string) =>
    (prisma as any).member_invites.findMany({ where: { community_id } });
  const listMemberInvitesForUser = async (user_id: string) =>
    (prisma as any).member_invites.findMany({
      where: { invited_user_id: user_id, status: "pending" },
    });
  const getMemberInvite = async (id: string) =>
    (prisma as any).member_invites.findUnique({
      where: { id },
    });
  const setMemberInviteStatus = async (id: string, status: string) => {
    await (prisma as any).member_invites.update({
      where: { id },
      data: { status },
    });
    return getMemberInvite(id);
  };

  // -------------- Posts --------------
  const createPost = async (
    post: {
      id: string;
      community_id: string | null;
      author_id: string;
      type: string;
      text?: string;
      media_urls?: string[];
      created_at: string | Date;
      pinned?: boolean;
      broadcast_all?: boolean;
      visible_to_friends?: boolean;
      attributed_community_id?: string | null;
      ap_object_id?: string | null;
      ap_activity_id?: string | null;
    },
  ) => {
    const broadcastAll =
      post.broadcast_all === undefined ? true : !!post.broadcast_all;
    const visibleToFriends =
      post.visible_to_friends === undefined
        ? broadcastAll
        : !!post.visible_to_friends;
    await (prisma as any).posts.create({
      data: {
        id: post.id,
        community_id: post.community_id ?? null,
        author_id: post.author_id,
        type: post.type ?? "text",
        text: post.text ?? "",
        media_json: JSON.stringify(post.media_urls ?? []),
        created_at: new Date(post.created_at),
        pinned: post.pinned ? 1 : 0,
        broadcast_all: broadcastAll ? 1 : 0,
        visible_to_friends: visibleToFriends ? 1 : 0,
        attributed_community_id: post.attributed_community_id || null,
        ap_object_id: post.ap_object_id || null,
        ap_activity_id: post.ap_activity_id || null,
      },
    });
    return {
      ...post,
      community_id: post.community_id ?? null,
      broadcast_all: broadcastAll,
      visible_to_friends: visibleToFriends,
      attributed_community_id: post.attributed_community_id || null,
      ap_object_id: post.ap_object_id || null,
      ap_activity_id: post.ap_activity_id || null,
    };
  };

  const getPost = async (id: string) => {
    const r = await (prisma as any).posts.findUnique({
      where: { id },
    });
    return r
      ? {
        ...r,
        pinned: toBool(r.pinned),
        broadcast_all: toBool((r as any).broadcast_all as any),
        visible_to_friends: toBool((r as any).visible_to_friends as any),
        media_urls: JSON.parse(r.media_json || "[]"),
        community_id: r.community_id ?? null,
        attributed_community_id: r.attributed_community_id ?? null,
      } as any
      : null;
  };

  const listPostsByCommunity = async (community_id: string) => {
    // Restrict community timelines to posts explicitly authored for the community.
    const res = await (prisma as any).posts.findMany({
      where: { community_id },
    });
    return res.map((r: any) => ({
      ...r,
      pinned: toBool(r.pinned),
      broadcast_all: toBool(r.broadcast_all),
      visible_to_friends: toBool(r.visible_to_friends),
      community_id: r.community_id ?? null,
      attributed_community_id: r.attributed_community_id ?? null,
      media_urls: JSON.parse(r.media_json || "[]"),
    })) as any;
  };

  const listGlobalPostsForUser = async (user_id: string) => {
    const relations: any[] = await (prisma as any).friendships.findMany({
      where: {
        status: "accepted",
        OR: [
          { requester_id: user_id },
          { addressee_id: user_id },
        ],
      },
    });
    const friendIds = new Set<string>();
    for (const rel of relations) {
      if (rel.requester_id === user_id && rel.addressee_id) {
        friendIds.add(rel.addressee_id);
      } else if (rel.addressee_id === user_id && rel.requester_id) {
        friendIds.add(rel.requester_id);
      }
    }
    const authorIds = [user_id, ...friendIds];
    const res = await (prisma as any).posts.findMany({
      where: {
        community_id: null,
        author_id: { in: authorIds as any },
      },
    });
    const posts = res.map((r: any) => ({
      ...r,
      pinned: toBool(r.pinned),
      broadcast_all: toBool(r.broadcast_all),
      visible_to_friends: toBool(r.visible_to_friends),
      community_id: r.community_id ?? null,
      attributed_community_id: r.attributed_community_id ?? null,
      media_urls: JSON.parse(r.media_json || "[]"),
    })) as any[];
    return posts.filter((post: any) => {
      if (post.author_id === user_id) return true;
      const visibleToFriends = (post as any).visible_to_friends ?? true;
      if (!visibleToFriends) return false;
      return friendIds.has(post.author_id);
    });
  };

  const updatePost = async (id: string, fields: Record<string, any>) => {
    const data: any = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k === "media_urls") data["media_json"] = JSON.stringify(v ?? []);
      else if (k === "pinned") data["pinned"] = v ? 1 : 0;
      else if (k === "broadcast_all") data["broadcast_all"] = v ? 1 : 0;
      else if (k === "visible_to_friends")
        data["visible_to_friends"] = v ? 1 : 0;
      else data[k] = v;
    }
    await (prisma as any).posts.update({
      where: { id },
      data,
    });
    return getPost(id);
  };

  // -------------- Reactions --------------
  const addReaction = async (
    r: {
      id: string;
      post_id: string;
      user_id: string;
      emoji: string;
      created_at: string | Date;
      ap_activity_id?: string | null;
    },
  ) => {
    await (prisma as any).post_reactions.create({
      data: {
        ...r,
        created_at: new Date(r.created_at),
        ap_activity_id: r.ap_activity_id || null,
      },
    });
    return r;
  };

  const listReactionsByPost = async (post_id: string) =>
    (prisma as any).post_reactions.findMany({ where: { post_id } });

  // -------------- Comments --------------
  const addComment = async (
    cmt: {
      id: string;
      post_id: string;
      author_id: string;
      text: string;
      created_at: string | Date;
      ap_object_id?: string | null;
      ap_activity_id?: string | null;
    },
  ) => {
    await (prisma as any).comments.create({
      data: {
        ...cmt,
        created_at: new Date(cmt.created_at),
        ap_object_id: cmt.ap_object_id || null,
        ap_activity_id: cmt.ap_activity_id || null,
      },
    });
    return cmt;
  };

  const listCommentsByPost = async (post_id: string) =>
    (prisma as any).comments.findMany({ where: { post_id } });

  // -------------- Stories --------------
  const createStory = async (
    story: {
      id: string;
      community_id: string | null;
      author_id: string;
      created_at: string | Date;
      expires_at: string | Date;
      items: any[];
      broadcast_all?: boolean;
      visible_to_friends?: boolean;
      attributed_community_id?: string | null;
    },
  ) => {
    const broadcastAll =
      story.broadcast_all === undefined ? true : !!story.broadcast_all;
    const visibleToFriends =
      story.visible_to_friends === undefined
        ? broadcastAll
        : !!story.visible_to_friends;
    await (prisma as any).stories.create({
      data: {
        id: story.id,
        community_id: story.community_id ?? null,
        author_id: story.author_id,
        created_at: new Date(story.created_at),
        expires_at: new Date(story.expires_at),
        items_json: JSON.stringify(story.items ?? []),
        broadcast_all: broadcastAll ? 1 : 0,
        visible_to_friends: visibleToFriends ? 1 : 0,
        attributed_community_id: story.attributed_community_id ?? null,
      } as any,
    });
    return {
      ...story,
      broadcast_all: broadcastAll,
      visible_to_friends: visibleToFriends,
      attributed_community_id: story.attributed_community_id ?? null,
    };
  };

  const getStory = async (id: string) => {
    const r = await (prisma as any).stories.findUnique({
      where: { id },
    });
    return r
      ? {
          ...r,
          items: normalizeStoryItems(JSON.parse(r.items_json || "[]")),
          broadcast_all: toBool((r as any).broadcast_all as any),
          visible_to_friends: toBool((r as any).visible_to_friends as any),
          attributed_community_id: (r as any).attributed_community_id ?? null,
        } as any
      : null;
  };

  const listStoriesByCommunity = async (community_id: string) => {
    const mems: any[] = await (prisma as any).memberships.findMany({
      where: { community_id },
    });
    const memberIds = Array.from(new Set(mems.map((m: any) => m.user_id)));
    const orConds: any[] = [{ community_id }];
    if (memberIds.length) {
      orConds.push({ broadcast_all: 1, author_id: { in: memberIds as any } });
    }
    const res = await (prisma as any).stories.findMany({
      where: { OR: orConds as any },
    });
    return res.map((r: any) => ({
      ...r,
      items: normalizeStoryItems(JSON.parse(r.items_json || "[]")),
      broadcast_all: toBool(r.broadcast_all),
      visible_to_friends: toBool(r.visible_to_friends),
      attributed_community_id: r.attributed_community_id ?? null,
    })) as any;
  };

  const listGlobalStoriesForUser = async (user_id: string) => {
    const relations: any[] = await (prisma as any).friendships.findMany({
      where: {
        status: "accepted",
        OR: [
          { requester_id: user_id },
          { addressee_id: user_id },
        ],
      },
    });
    const friendIds = new Set<string>();
    for (const rel of relations) {
      if (rel.requester_id === user_id && rel.addressee_id) {
        friendIds.add(rel.addressee_id);
      } else if (rel.addressee_id === user_id && rel.requester_id) {
        friendIds.add(rel.requester_id);
      }
    }
    const authorIds = [user_id, ...friendIds];
    const res = await (prisma as any).stories.findMany({
      where: {
        community_id: null,
        author_id: { in: authorIds as any },
      },
    });
    const stories = res.map((r: any) => ({
      ...r,
      items: normalizeStoryItems(JSON.parse(r.items_json || "[]")),
      broadcast_all: toBool(r.broadcast_all),
      visible_to_friends: toBool(r.visible_to_friends),
      attributed_community_id: r.attributed_community_id ?? null,
    })) as any[];
    return stories.filter((story: any) => {
      if (story.author_id === user_id) return true;
      const visibleToFriends = (story as any).visible_to_friends ?? true;
      if (!visibleToFriends) return false;
      return friendIds.has(story.author_id);
    });
  };

  const updateStory = async (id: string, fields: Record<string, any>) => {
    const data: any = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k === "items") data["items_json"] = JSON.stringify(v ?? []);
      else if (k === "broadcast_all") data["broadcast_all"] = v ? 1 : 0;
      else if (k === "visible_to_friends") data["visible_to_friends"] = v ? 1 : 0;
      else data[k] = v;
    }
    await (prisma as any).stories.update({
      where: { id },
      data,
    });
    return getStory(id);
  };

  const deleteStory = async (id: string) => {
    await (prisma as any).stories.delete({
      where: { id },
    });
  };

  // -------------- Push devices --------------
  type PushDeviceInput = {
    user_id: string;
    token: string;
    platform: string;
    device_name?: string | null;
    locale?: string | null;
  };

  const registerPushDevice = async (device: PushDeviceInput) => {
    const now = new Date();
    return (prisma as any).push_devices.upsert({
      where: { token: device.token },
      update: {
        user_id: device.user_id,
        platform: device.platform,
        device_name: device.device_name ?? "",
        locale: device.locale ?? "",
        updated_at: now,
      },
      create: {
        id: crypto.randomUUID(),
        user_id: device.user_id,
        token: device.token,
        platform: device.platform,
        device_name: device.device_name ?? "",
        locale: device.locale ?? "",
        created_at: now,
        updated_at: now,
      },
    });
  };

  const listPushDevicesByUser = async (user_id: string) =>
    (prisma as any).push_devices.findMany({ where: { user_id } });

  const removePushDevice = async (token: string) => {
    try {
      await (prisma as any).push_devices.delete({
        where: { token },
      });
    } catch (error) {
      // Ignore missing token errors so callers can fire-and-forget.
      if ((error as any)?.code !== "P2025") {
        throw error;
      }
    }
  };

  // -------------- Chat: DM --------------
  const upsertDmThread = async (
    participantsHash: string,
    participantsJson: string,
  ) => {
    const thread = await (prisma as any).chat_dm_threads.upsert({
      where: {
        participants_hash: participantsHash,
      },
      create: {
        id: participantsHash,
        participants_hash: participantsHash,
        participants_json: participantsJson,
      },
      update: {
        participants_json: participantsJson,
      },
    });
    return thread;
  };

  const createDmMessage = async (
    threadId: string,
    authorId: string,
    contentHtml: string,
    rawActivity: any,
  ) => {
    return (prisma as any).chat_dm_messages.create({
      data: {
        id: crypto.randomUUID(),
        thread_id: threadId,
        author_id: authorId,
        content_html: contentHtml,
        raw_activity_json: JSON.stringify(rawActivity),
      },
    });
  };

  const listDmMessages = async (threadId: string, limit = 50) =>
    (prisma as any).chat_dm_messages.findMany({
      where: { thread_id: threadId },
      orderBy: { created_at: "desc" },
      take: limit,
    });

  // -------------- Chat: Channel --------------
  const createChannelMessageRecord = async (
    communityId: string,
    channelId: string,
    authorId: string,
    contentHtml: string,
    rawActivity: any,
  ) =>
    (prisma as any).chat_channel_messages.create({
      data: {
        id: crypto.randomUUID(),
        community_id: communityId,
        channel_id: channelId,
        author_id: authorId,
        content_html: contentHtml,
        raw_activity_json: JSON.stringify(rawActivity),
      },
    });

  const listChannelMessages = async (
    communityId: string,
    channelId: string,
    limit = 50,
  ) =>
    (prisma as any).chat_channel_messages.findMany({
      where: { community_id: communityId, channel_id: channelId },
      orderBy: { created_at: "desc" },
      take: limit,
  });

  // -------------- Sessions --------------
  const createSession = async (session: {
    id: string;
    user_id: string;
    created_at?: string | Date;
    last_seen?: string | Date;
    expires_at?: string | Date | null;
  }) => {
    const now = new Date();
    return (prisma as any).sessions.create({
      data: {
        id: session.id,
        user_id: session.user_id,
        created_at: session.created_at ? new Date(session.created_at) : now,
        last_seen: session.last_seen ? new Date(session.last_seen) : now,
        expires_at: session.expires_at ? new Date(session.expires_at) : null,
      },
    });
  };

  const getSession = async (id: string) =>
    (prisma as any).sessions.findUnique({
      where: { id },
    });

  const updateSession = async (id: string, data: {
    last_seen?: string | Date;
    expires_at?: string | Date | null;
  }) => {
    const updateData: Record<string, any> = {};
    if (data.last_seen !== undefined) {
      updateData.last_seen = data.last_seen ? new Date(data.last_seen) : new Date();
    }
    if (data.expires_at !== undefined) {
      updateData.expires_at = data.expires_at ? new Date(data.expires_at) : null;
    }
    return (prisma as any).sessions.update({
      where: { id },
      data: updateData,
    });
  };

  const deleteSession = async (id: string) => {
    try {
      await (prisma as any).sessions.delete({
        where: { id },
      });
    } catch (error) {
      if ((error as any)?.code !== "P2025") throw error;
    }
  };

  // Raw SQL query helper for ActivityPub operations
  const query = async (sql: string, params: any[] = []) => {
    return runStatement(sql, params);
  };

  const disconnect = () => (prisma as any).$disconnect();

  // ========== ActivityPub Methods ==========

  // ActivityPub - Followers
  const upsertApFollower = async (input: import("./types").ApFollowerInput) => {
    const data = {
      id: input.id || crypto.randomUUID(),
      local_user_id: input.local_user_id,
      remote_actor_id: input.remote_actor_id,
      activity_id: input.activity_id,
      status: input.status,
      created_at: input.created_at ? new Date(input.created_at) : new Date(),
      accepted_at: input.accepted_at ? new Date(input.accepted_at) : null,
    };
    return (prisma as any).ap_followers.upsert({
      where: {
        ap_followers_local_user_id_remote_actor_id_key: {
          local_user_id: input.local_user_id,
          remote_actor_id: input.remote_actor_id,
        },
      },
      update: {
        activity_id: data.activity_id,
        status: data.status,
        accepted_at: data.accepted_at,
      },
      create: data,
    });
  };

  const deleteApFollowers = async (local_user_id: string, remote_actor_id: string) => {
    await (prisma as any).ap_followers.deleteMany({
      where: { local_user_id, remote_actor_id },
    });
  };

  const findApFollower = async (local_user_id: string, remote_actor_id: string) => {
    return (prisma as any).ap_followers.findUnique({
      where: {
        local_user_id_remote_actor_id: { local_user_id, remote_actor_id },
      },
    });
  };

  const countApFollowers = async (local_user_id: string, status?: string) => {
    const where: Record<string, any> = { local_user_id };
    if (status) {
      where.status = status;
    }
    return (prisma as any).ap_followers.count({ where });
  };

  const listApFollowers = async (
    local_user_id: string,
    status: string = "accepted",
    limit = 100,
    offset = 0,
  ) => {
    const where: Record<string, any> = { local_user_id };
    if (status) {
      where.status = status;
    }
    const orderBy =
      status === "accepted"
        ? [{ accepted_at: "desc" }, { created_at: "desc" }]
        : [{ created_at: "desc" }];
    return (prisma as any).ap_followers.findMany({
      where,
      orderBy,
      skip: offset,
      take: limit,
      select: { remote_actor_id: true },
    });
  };

  // ActivityPub - Follows
  const updateApFollowsStatus = async (
    local_user_id: string,
    remote_actor_id: string,
    status: string,
    accepted_at?: Date,
  ) => {
    await (prisma as any).ap_follows.updateMany({
      where: { local_user_id, remote_actor_id, status: "pending" },
      data: {
        status,
        accepted_at: accepted_at || new Date(),
      },
    });
  };

  const countApFollows = async (local_user_id: string, status?: string) => {
    const where: Record<string, any> = { local_user_id };
    if (status) {
      where.status = status;
    }
    return (prisma as any).ap_follows.count({ where });
  };

  const listApFollows = async (
    local_user_id: string,
    status: string = "accepted",
    limit = 100,
    offset = 0,
  ) => {
    const where: Record<string, any> = { local_user_id };
    if (status) {
      where.status = status;
    }
    const orderBy =
      status === "accepted"
        ? [{ accepted_at: "desc" }, { created_at: "desc" }]
        : [{ created_at: "desc" }];
    return (prisma as any).ap_follows.findMany({
      where,
      orderBy,
      skip: offset,
      take: limit,
      select: { remote_actor_id: true },
    });
  };

  // ActivityPub - Inbox Activities
  const createApInboxActivity = async (input: import("./types").ApInboxActivityInput) => {
    const data = {
      id: input.id || crypto.randomUUID(),
      local_user_id: input.local_user_id,
      remote_actor_id: input.remote_actor_id,
      activity_id: input.activity_id,
      activity_type: input.activity_type,
      activity_json: input.activity_json,
      status: input.status || "pending",
      created_at: input.created_at ? new Date(input.created_at) : new Date(),
    };
    try {
      return await (prisma as any).ap_inbox_activities.create({ data });
    } catch (error: any) {
      // Ignore unique constraint violations (already exists)
      if (!error.message?.includes("UNIQUE constraint")) {
        throw error;
      }
      return null;
    }
  };

  const updateApInboxActivityStatus = async (
    id: string,
    status: string,
    error_message?: string,
    processed_at?: Date,
  ) => {
    const data: any = { status };
    if (error_message !== undefined) {
      data.error_message = error_message;
    }
    if (processed_at !== undefined || status === "processed" || status === "failed") {
      data.processed_at = processed_at || new Date();
    }
    await (prisma as any).ap_inbox_activities.update({
      where: { id },
      data,
    });
  };

  const claimPendingInboxActivities = async (
    batchSize: number,
  ): Promise<import("./types").ClaimedInboxBatch> => {
    const activities = await (prisma as any).$transaction(async (tx: any) => {
      const rows = await tx.ap_inbox_activities.findMany({
        where: { status: "pending" },
        orderBy: { created_at: "asc" },
        take: batchSize,
      });

      if (!rows.length) return [] as Array<any>;

      const ids = rows.map((row: any) => row.id);

      await tx.ap_inbox_activities.updateMany({
        where: { id: { in: ids } },
        data: { status: "processing", processed_at: null },
      });

      return rows.map((row: any) => ({
        ...row,
        status: "processing",
        processed_at: null,
      }));
    });

    return {
      activities: activities || [],
    };
  };

  // ActivityPub - Outbox Activities
  const upsertApOutboxActivity = async (input: import("./types").ApOutboxActivityInput) => {
    const data = {
      id: input.id || crypto.randomUUID(),
      local_user_id: input.local_user_id,
      activity_id: input.activity_id,
      activity_type: input.activity_type,
      activity_json: input.activity_json,
      object_id: input.object_id ?? null,
      object_type: input.object_type ?? null,
      created_at: input.created_at ? new Date(input.created_at) : new Date(),
    };
    return (prisma as any).ap_outbox_activities.upsert({
      where: { activity_id: input.activity_id },
      update: {
        activity_json: data.activity_json,
        object_id: data.object_id,
        object_type: data.object_type,
      },
      create: data,
    });
  };

  // ActivityPub - Delivery Queue
  const createApDeliveryQueueItem = async (input: import("./types").ApDeliveryQueueInput) => {
    const data = {
      id: input.id || crypto.randomUUID(),
      activity_id: input.activity_id,
      target_inbox_url: input.target_inbox_url,
      status: input.status || "pending",
      retry_count: input.retry_count || 0,
      last_error: input.last_error ?? null,
      last_attempt_at: input.last_attempt_at ? new Date(input.last_attempt_at) : null,
      delivered_at: input.delivered_at ? new Date(input.delivered_at) : null,
      created_at: input.created_at ? new Date(input.created_at) : new Date(),
    };
    try {
      return await (prisma as any).ap_delivery_queue.create({ data });
    } catch (error: any) {
      // Ignore unique constraint violations
      if (!error.message?.includes("UNIQUE constraint")) {
        throw error;
      }
      return null;
    }
  };

  const updateApDeliveryQueueStatus = async (
    id: string,
    status: string,
    fields?: Partial<import("./types").ApDeliveryQueueInput>,
  ) => {
    const data: any = { status };
    if (fields) {
      if (fields.retry_count !== undefined) data.retry_count = fields.retry_count;
      if (fields.last_error !== undefined) data.last_error = fields.last_error;
      if (fields.last_attempt_at !== undefined) {
        data.last_attempt_at = fields.last_attempt_at ? new Date(fields.last_attempt_at) : new Date();
      }
      if (fields.delivered_at !== undefined) {
        data.delivered_at = fields.delivered_at ? new Date(fields.delivered_at) : new Date();
      }
    }
    await (prisma as any).ap_delivery_queue.update({
      where: { id },
      data,
    });
  };

  const claimPendingDeliveries = async (
    batchSize: number,
  ): Promise<import("./types").ClaimedDeliveryBatch> => {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const claim = await (prisma as any).$transaction(async (tx: any) => {
      const candidates = await tx.ap_delivery_queue.findMany({
        where: {
          status: "pending",
          OR: [
            { last_attempt_at: null },
            { last_attempt_at: { lt: fiveMinutesAgo } },
          ],
        },
        orderBy: { created_at: "asc" },
        take: batchSize,
      });

      if (!candidates.length) {
        return { ids: [] as string[], deliveries: [] as any[] };
      }

      const ids = candidates.map((row: any) => row.id);
      await tx.ap_delivery_queue.updateMany({
        where: { id: { in: ids } },
        data: { status: "processing", last_attempt_at: now },
      });

      const activityIds = Array.from(
        new Set(candidates.map((row: any) => row.activity_id)),
      );
      const activities = activityIds.length
        ? await tx.ap_outbox_activities.findMany({
            where: { activity_id: { in: activityIds } },
          })
        : [];
      const activityMap = new Map<string, any>();
      for (const activity of activities) {
        activityMap.set(activity.activity_id, activity);
      }

      const deliveries = candidates.map((row: any) => {
        const activity = activityMap.get(row.activity_id) || {};
        return {
          id: row.id,
          activity_id: row.activity_id,
          target_inbox_url: row.target_inbox_url,
          retry_count: row.retry_count,
          activity_json: activity.activity_json ?? null,
          local_user_id: activity.local_user_id ?? null,
        };
      });

      return { ids, deliveries };
    });

    return claim as import("./types").ClaimedDeliveryBatch;
  };

  const resetStaleDeliveries = async (minutes: number) => {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    await (prisma as any).ap_delivery_queue.updateMany({
      where: {
        status: "processing",
        OR: [
          { last_attempt_at: null },
          { last_attempt_at: { lt: cutoff } },
        ],
      },
      data: {
        status: "pending",
        last_attempt_at: null,
      },
    });
  };

  const getApInboxStats = async () => {
    const [pending, processed] = await Promise.all([
      (prisma as any).ap_inbox_activities.count({ where: { status: "pending" } }),
      (prisma as any).ap_inbox_activities.count({ where: { status: "processed" } }),
    ]);
    return {
      pending,
      processed,
    };
  };

  const getApDeliveryQueueStats = async () => {
    const [pending, delivered, failed] = await Promise.all([
      (prisma as any).ap_delivery_queue.count({ where: { status: "pending" } }),
      (prisma as any).ap_delivery_queue.count({ where: { status: "delivered" } }),
      (prisma as any).ap_delivery_queue.count({ where: { status: "failed" } }),
    ]);
    return {
      pending,
      delivered,
      failed,
    };
  };

  const countApRateLimits = async () => {
    const rows = (await runStatement(
      "SELECT COUNT(*) as total FROM ap_rate_limits",
      [],
      true,
    )) as Array<{ total: number }>;
    return Number(rows?.[0]?.total ?? 0);
  };

  // -------------- ActivityPub - Rate Limiting --------------
  const deleteOldRateLimits = async (key: string, windowStart: number) => {
    await runStatement(
      "DELETE FROM ap_rate_limits WHERE key = ? AND window_start < ?",
      [key, windowStart],
    );
  };

  const countRateLimits = async (key: string, windowStart: number) => {
    const rows = (await runStatement(
      `SELECT COUNT(*) as count, MIN(window_start) as oldest_window
       FROM ap_rate_limits
       WHERE key = ? AND window_start >= ?`,
      [key, windowStart],
      true,
    )) as Array<{ count: number; oldest_window: number }>;
    return {
      count: Number(rows?.[0]?.count ?? 0),
      oldestWindow: Number(rows?.[0]?.oldest_window ?? Date.now()),
    };
  };

  const createRateLimitEntry = async (
    id: string,
    key: string,
    windowStart: number,
    createdAt: number,
  ) => {
    await runStatement(
      `INSERT INTO ap_rate_limits (id, key, window_start, created_at)
       VALUES (?, ?, ?, ?)`,
      [id, key, windowStart, createdAt],
    );
  };

  // ActivityPub - Posts & Reactions
  const findPostByApObjectId = async (ap_object_id: string) => {
    return (prisma as any).posts.findUnique({
      where: { ap_object_id },
    });
  };

  const createApReaction = async (input: import("./types").ApReactionInput) => {
    const data = {
      id: input.id || crypto.randomUUID(),
      post_id: input.post_id,
      user_id: input.user_id,
      emoji: input.emoji,
      created_at: input.created_at ? new Date(input.created_at) : new Date(),
      ap_activity_id: input.ap_activity_id ?? null,
    };
    try {
      return await (prisma as any).post_reactions.create({ data });
    } catch (error: any) {
      // Ignore unique constraint violations
      if (!error.message?.includes("UNIQUE constraint")) {
        throw error;
      }
      return null;
    }
  };

  const deleteApReactionsByActivityId = async (ap_activity_id: string) => {
    await (prisma as any).post_reactions.deleteMany({
      where: { ap_activity_id },
    });
  };

  const createApRemotePost = async (input: import("./types").ApRemotePostInput) => {
    const id = input.id || crypto.randomUUID();
    const createdAt = input.created_at ? new Date(input.created_at) : new Date();
    const mediaJson = JSON.stringify(input.media_urls ?? []);
    try {
      await runStatement(
        `INSERT INTO posts (
          id,
          community_id,
          author_id,
          type,
          text,
          media_json,
          created_at,
          attributed_community_id,
          ap_object_id,
          ap_attributed_to,
          in_reply_to,
          ap_activity_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.community_id ?? null,
          input.author_id,
          input.type ?? "text",
          input.text ?? "",
          mediaJson,
          createdAt.toISOString(),
          input.attributed_community_id ?? null,
          input.ap_object_id ?? null,
          input.ap_attributed_to ?? null,
          input.in_reply_to ?? null,
          input.ap_activity_id ?? null,
        ],
      );
      return { id, inserted: true };
    } catch (error: any) {
      if (!String(error?.message ?? "").includes("UNIQUE constraint")) {
        throw error;
      }
      return { id, inserted: false };
    }
  };

  const createApRemoteComment = async (input: import("./types").ApRemoteCommentInput) => {
    const id = input.id || crypto.randomUUID();
    const createdAt = input.created_at ? new Date(input.created_at) : new Date();
    try {
      await runStatement(
        `INSERT INTO comments (
          id,
          post_id,
          author_id,
          text,
          created_at,
          ap_object_id,
          ap_activity_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.post_id,
          input.author_id,
          input.text,
          createdAt.toISOString(),
          input.ap_object_id ?? null,
          input.ap_activity_id ?? null,
        ],
      );
      return { id, inserted: true };
    } catch (error: any) {
      if (!String(error?.message ?? "").includes("UNIQUE constraint")) {
        throw error;
      }
      return { id, inserted: false };
    }
  };

  // ActivityPub - Announces
  const findApAnnounce = async (activity_id: string) => {
    return (prisma as any).ap_announces.findUnique({
      where: { activity_id },
    });
  };

  const createApAnnounce = async (input: import("./types").ApAnnounceInput) => {
    const data = {
      id: input.id || crypto.randomUUID(),
      activity_id: input.activity_id,
      actor_id: input.actor_id,
      object_id: input.object_id,
      local_post_id: input.local_post_id,
      created_at: input.created_at ? new Date(input.created_at) : new Date(),
    };
    return (prisma as any).ap_announces.create({ data });
  };

  const deleteApAnnouncesByActivityId = async (activity_id: string) => {
    await (prisma as any).ap_announces.deleteMany({
      where: { activity_id },
    });
  };

  // ActivityPub - Actor Cache
  const findApActor = async (id: string) => {
    return (prisma as any).ap_actors.findUnique({
      where: { id },
    });
  };

  const upsertApActor = async (actor: Record<string, any>) => {
    return (prisma as any).ap_actors.upsert({
      where: { id: actor.id },
      update: {
        handle: actor.handle,
        display_name: actor.display_name,
        domain: actor.domain,
        summary: actor.summary,
        icon_url: actor.icon_url,
        inbox_url: actor.inbox_url,
        outbox_url: actor.outbox_url,
        followers_url: actor.followers_url,
        following_url: actor.following_url,
        public_key_pem: actor.public_key_pem,
        last_fetched_at: actor.last_fetched_at,
      },
      create: actor,
    });
  };

  // -------------- ActivityPub - Keypairs --------------
  const getApKeypair = async (user_id: string) => {
    return (prisma as any).ap_keypairs.findFirst({
      where: { user_id },
      select: { public_key_pem: true, private_key_pem: true },
    });
  };

  // -------------- ActivityPub - Outbox stats --------------
  const countApOutboxActivities = async (local_user_id: string) => {
    const result = await (prisma as any).ap_outbox_activities.count({
      where: { local_user_id },
    });
    return result;
  };

  const listApOutboxActivitiesPage = async (
    local_user_id: string,
    limit: number,
    offset: number,
  ) => {
    return (prisma as any).ap_outbox_activities.findMany({
      where: { local_user_id },
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
      select: { activity_json: true },
    });
  };

  const countPostsByCommunity = async (community_id: string) => {
    const result = await (prisma as any).posts.count({
      where: { community_id },
    });
    return result;
  };

  const listPostsByCommunityPage = async (
    community_id: string,
    limit: number,
    offset: number,
  ) => {
    return (prisma as any).posts.findMany({
      where: { community_id },
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
      include: {
        users: {
          select: {
            display_name: true,
            avatar_url: true,
          },
        },
      },
    });
  };

  const getPostWithAuthor = async (post_id: string, author_id: string) => {
    return (prisma as any).posts.findFirst({
      where: {
        id: post_id,
        author_id: author_id,
      },
      include: {
        users: {
          select: {
            display_name: true,
            avatar_url: true,
          },
        },
      },
    });
  };

  // -------------- Reports --------------
  const createReport = async (report: any) => {
    return await (prisma as any).reports.create({
      data: {
        id: report.id,
        reporter_actor_id: report.reporter_actor_id,
        target_actor_id: report.target_actor_id,
        target_object_id: report.target_object_id,
        reason: report.reason,
        status: report.status || "pending",
        created_at: report.created_at ? new Date(report.created_at) : new Date(),
        updated_at: report.updated_at ? new Date(report.updated_at) : new Date(),
      },
    });
  };

  const listReports = async (status?: string, limit = 20, offset = 0) => {
    const where: any = {};
    if (status) {
      where.status = status;
    }
    return await (prisma as any).reports.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { created_at: "desc" },
    });
  };

  const updateReportStatus = async (id: string, status: string) => {
    await (prisma as any).reports.update({
      where: { id },
      data: {
        status,
        updated_at: new Date(),
      },
    });
  };

  // Low-level operations
  const transaction = async <T>(fn: (tx: import("./types").DatabaseAPI) => Promise<T>): Promise<T> => {
    return (prisma as any).$transaction(async (txPrisma: any) => {
      // Create a temporary DatabaseAPI with the transaction prisma client
      const txApi = createDatabaseAPI({ ...config, DB: config.DB });
      // Replace the prisma instance with the transaction one
      (txApi as any).prisma = txPrisma;
      return fn(txApi);
    });
  };

  const executeRaw = async (sql: string, ...params: any[]): Promise<number> => {
    if (params.length > 0) {
      return (prisma as any).$executeRawUnsafe(sql, ...params);
    }
    return (prisma as any).$executeRaw([sql] as any);
  };

  const queryRaw = async <T = any>(sql: string, ...params: any[]): Promise<T[]> => {
    if (params.length > 0) {
      return (prisma as any).$queryRawUnsafe(sql, ...params);
    }
    return (prisma as any).$queryRaw([sql] as any);
  };

  return {
    // users
    getUser,
    getUserByHandle,
    searchUsersByName,
    createUser,
    updateUser,
    renameUserId,
    getAccountByProvider,
    createUserAccount,
    updateAccountUser,
    updateUserAccountPassword,
    listAccountsByUser,
    // friendships
    getFriendRequest,
    getFriendshipBetween,
    createFriendRequest,
    setFriendStatus,
    listFriendships,
    // notifications
    addNotification,
    listNotifications,
    markNotificationRead,
    countUnreadNotifications,
    // communities & memberships
    createCommunity,
    getCommunity,
    updateCommunity,
    setMembership,
    hasMembership,
    listMembershipsByCommunity,
    listUserCommunities,
    listCommunityMembersWithUsers,
    // invites
    createInvite,
    listInvites,
    getInvite,
    updateInvite,
    disableInvite,
    resetInvites,
    // direct member invites
    createMemberInvite,
    listMemberInvitesByCommunity,
    listMemberInvitesForUser,
    getMemberInvite,
    setMemberInviteStatus,
    // channels
    listChannelsByCommunity,
    createChannel,
    getChannel,
    deleteChannel,
    // posts
    createPost,
    getPost,
    listPostsByCommunity,
    listGlobalPostsForUser,
    updatePost,
    // reactions
    addReaction,
    listReactionsByPost,
    // comments
    addComment,
    listCommentsByPost,
    // stories
    createStory,
    getStory,
    listStoriesByCommunity,
    listGlobalStoriesForUser,
    updateStory,
    deleteStory,
    // Reports
    createReport,
    listReports,
    updateReportStatus,
    // JWT
    getUserJwtSecret,
    setUserJwtSecret,
    // push devices
    registerPushDevice,
    listPushDevicesByUser,
    removePushDevice,
    // chat messages
    upsertDmThread,
    createDmMessage,
    listDmMessages,
    createChannelMessageRecord,
    listChannelMessages,
    // sessions
    createSession,
    getSession,
    updateSession,
    deleteSession,
    // ActivityPub
    upsertApFollower,
    deleteApFollowers,
    findApFollower,
    countApFollowers,
    listApFollowers,
    updateApFollowsStatus,
    countApFollows,
    listApFollows,
    createApInboxActivity,
    updateApInboxActivityStatus,
    claimPendingInboxActivities,
    upsertApOutboxActivity,
    createApDeliveryQueueItem,
    updateApDeliveryQueueStatus,
    claimPendingDeliveries,
    resetStaleDeliveries,
    getApInboxStats,
    getApDeliveryQueueStats,
    countApRateLimits,
    // ActivityPub - Rate Limiting
    deleteOldRateLimits,
    countRateLimits,
    createRateLimitEntry,
    findPostByApObjectId,
    createApReaction,
    deleteApReactionsByActivityId,
    createApRemotePost,
    createApRemoteComment,
    findApAnnounce,
    createApAnnounce,
    deleteApAnnouncesByActivityId,
    findApActor,
    upsertApActor,
    // ActivityPub - Keypairs
    getApKeypair,
    // ActivityPub - Outbox stats
    countApOutboxActivities,
    listApOutboxActivitiesPage,
    countPostsByCommunity,
    listPostsByCommunityPage,
    getPostWithAuthor,
    // Low-level operations
    transaction,
    executeRaw,
    queryRaw,
    // raw query (deprecated)
    query,
    disconnect,
  };
}
