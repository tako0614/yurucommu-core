// Database API implementation for takos v1.8 (actors/objects centric)

/// <reference types="@cloudflare/workers-types" />

import type { PrismaClient } from "@prisma/client";
import {
  APP_MANIFEST_SCHEMA_VERSION,
  DEFAULT_TAKOS_AI_CONFIG,
  TAKOS_CORE_VERSION,
  checkSemverCompatibility,
  mergeTakosAiConfig,
} from "@takos/platform/server";
import type { TakosAiConfig } from "@takos/platform/server";
import type { DatabaseConfig } from "./prisma-factory";
import type { DatabaseAPI } from "./types";
import type * as Types from "./types";

const toBool = (v: number | boolean | null | undefined) => !!(v && Number(v) !== 0);

const toDate = (v: Types.NullableDate): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const toIso = (v: Types.NullableDate): string | null => {
  const d = toDate(v);
  return d ? d.toISOString() : null;
};

const toArray = (value: any): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => `${v}`);
  if (typeof value === "string") return [value];
  return [];
};

const mapActor = (row: any): Types.ActorRecord | null => {
  if (!row) return null;
  return {
    id: row.id,
    local_id: row.local_id ?? null,
    handle: row.handle,
    type: row.type,
    display_name: row.display_name ?? null,
    summary: row.summary ?? null,
    avatar_url: row.avatar_url ?? null,
    header_url: row.header_url ?? null,
    inbox: row.inbox ?? null,
    outbox: row.outbox ?? null,
    followers: row.followers ?? null,
    following: row.following ?? null,
    public_key: row.public_key ?? null,
    private_key: row.private_key ?? null,
    is_local: row.is_local,
    is_bot: row.is_bot,
    manually_approves_followers: row.manually_approves_followers,
    owner_id: row.owner_id ?? null,
    visibility: row.visibility ?? null,
    profile_completed_at: row.profile_completed_at ?? null,
    jwt_secret: row.jwt_secret ?? null,
    metadata_json: row.metadata_json ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
};

const mapAudit = (row: any): Types.AuditLogRecord | null => {
  if (!row) return null;
  return {
    id: row.id,
    timestamp: row.timestamp ?? row.created_at ?? null,
    actor_type: row.actor_type,
    actor_id: row.actor_id ?? null,
    action: row.action,
    target: row.target ?? null,
    details_json: row.details_json ?? null,
    checksum: row.checksum,
    prev_checksum: row.prev_checksum ?? null,
    created_at: row.created_at ?? row.timestamp ?? null,
  };
};

const mapObject = (row: any): Types.ObjectRecord | null => {
  if (!row) return null;
  const parse = (value: any) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  };
  return {
    id: row.id,
    local_id: row.local_id ?? null,
    type: row.type,
    actor: row.actor,
    published: row.published ?? null,
    updated: row.updated ?? null,
    to: parse(row.to),
    cc: parse(row.cc),
    bto: parse(row.bto),
    bcc: parse(row.bcc),
    context: row.context ?? null,
    in_reply_to: row.in_reply_to ?? null,
    content: parse(row.content) ?? {},
    is_local: row.is_local,
    visibility: row.visibility ?? null,
    deleted_at: row.deleted_at ?? null,
    created_at: row.created_at ?? null,
  };
};

const notImplemented = async () => {
  throw new Error("Not implemented for v1.8 schema");
};

const asArray = (value: any) => (Array.isArray(value) ? value : value ? [value] : []);

const buildRecipients = (
  objectId: string,
  input: { to?: any; cc?: any; bto?: any; bcc?: any },
): Types.ObjectRecipientInput[] => {
  const recipients: Types.ObjectRecipientInput[] = [];
  const push = (values: any, type: string) => {
    for (const recipient of toArray(values)) {
      if (!recipient) continue;
      recipients.push({ object_id: objectId, recipient, recipient_type: type });
    }
  };
  push(input.to, "to");
  push(input.cc, "cc");
  push(input.bto, "bto");
  push(input.bcc, "bcc");
  return recipients;
};

function pickActorId(input: { actor_id?: string | null; user_id?: string | null; id?: string | null }): string {
  return (input.actor_id ?? input.user_id ?? input.id ?? "").trim();
}

function normalizeHandle(id: string): string {
  return (id || "").replace(/^@+/, "").trim();
}

function buildNoteObject(input: Types.PostInput, instanceDomain?: string): Types.ObjectWriteInput {
  const actor = normalizeHandle(input.author_id);
  const objectId = input.ap_object_id ?? input.id;
  const content = {
    id: objectId,
    type: input.type || "Note",
    actor,
    content: input.text ?? "",
    summary: input.content_warning ?? undefined,
    "takos:sensitive": !!input.sensitive,
    attributedTo: input.attributed_community_id ?? undefined,
    inReplyTo: null,
  };
  const visibility = input.visible_to_friends ? "followers" : input.broadcast_all ? "public" : input.community_id ? "community" : "public";
  return {
    id: objectId,
    local_id: input.id,
    type: input.type || "Note",
    actor,
    published: toIso(input.created_at) ?? new Date().toISOString(),
    to: null,
    cc: null,
    bto: null,
    bcc: null,
    context: input.community_id ?? null,
    in_reply_to: null,
    content,
    visibility,
    is_local: true,
  };
}

export function createDatabaseAPI(config: DatabaseConfig): DatabaseAPI {
  const prisma = config.createPrismaClient(config.DB);
  const db = config.DB;

  const runAll = async (sql: string, params: any[] = []) => {
    let stmt = db.prepare(sql);
    if (params.length) stmt = stmt.bind(...params);
    const res = await stmt.all();
    return res?.results ?? [];
  };

  const runGet = async (sql: string, params: any[] = []) => {
    const rows = await runAll(sql, params);
    return rows[0] ?? null;
  };

  const actorById = async (id: string) => {
    if (!id) return null;
    const row = await (prisma as any).actors.findFirst({
      where: {
        OR: [{ id }, { local_id: id }, { handle: id }],
      },
    });
    return mapActor(row);
  };

  const actorByHandle = async (handle: string) => {
    const id = normalizeHandle(handle);
    const row = await (prisma as any).actors.findFirst({
      where: {
        OR: [{ handle: id }, { local_id: id }, { id }],
      },
    });
    return mapActor(row);
  };

  const searchActorsByName = async (q: string, limit = 20) => {
    const needle = q.trim();
    if (!needle) return [];
    const rows = await (prisma as any).actors.findMany({
      where: {
        OR: [
          { handle: { contains: needle } },
          { display_name: { contains: needle } },
        ],
      },
      take: limit,
    });
    return rows.map(mapActor).filter(Boolean) as Types.ActorRecord[];
  };

  const createActor = async (actor: Types.ActorInput) => {
    const handle = normalizeHandle(actor.handle);
    const data: any = {
      id: actor.id ?? handle,
      local_id: actor.local_id ?? handle,
      handle,
      type: actor.type ?? "Person",
      display_name: actor.display_name ?? "",
      summary: actor.summary ?? null,
      avatar_url: actor.avatar_url ?? null,
      header_url: actor.header_url ?? null,
      inbox: actor.inbox ?? null,
      outbox: actor.outbox ?? null,
      followers: actor.followers ?? null,
      following: actor.following ?? null,
      public_key: actor.public_key ?? null,
      private_key: actor.private_key ?? null,
      is_local: actor.is_local === undefined ? 1 : Number(actor.is_local ? 1 : 0),
      is_bot: actor.is_bot === undefined ? 0 : Number(actor.is_bot ? 1 : 0),
      manually_approves_followers:
        actor.manually_approves_followers === undefined ? 0 : Number(actor.manually_approves_followers ? 1 : 0),
      owner_id: actor.owner_id ?? null,
      visibility: actor.visibility ?? "public",
      profile_completed_at: actor.profile_completed_at ? new Date(actor.profile_completed_at as any) : null,
      jwt_secret: actor.jwt_secret ?? null,
      metadata_json: actor.metadata_json ?? null,
      created_at: actor.created_at ? new Date(actor.created_at) : undefined,
      updated_at: actor.updated_at ? new Date(actor.updated_at) : undefined,
    };
    const row = await (prisma as any).actors.create({ data });
    return mapActor(row)!;
  };

  const updateActor = async (id: string, data: Types.ActorUpdateFields) => {
    const row = await (prisma as any).actors.update({
      where: { id },
      data,
    });
    return mapActor(row)!;
  };

  const ensureActorId = (id: string) => normalizeHandle(id);

  const createFollow = async (follower: string, following: string, status = "pending"): Promise<void> => {
    const data = {
      id: crypto.randomUUID(),
      follower_id: follower,
      following_id: following,
      status,
      created_at: new Date(),
    };
    await (prisma as any).follows.upsert({
      where: { follower_id_following_id: { follower_id: follower, following_id: following } },
      update: { status },
      create: data,
    });
  };

  const getObject = async (id: string) => {
    const row = await (prisma as any).objects.findUnique({ where: { id } });
    return mapObject(row);
  };

  const getObjectByLocalId = async (localId: string) => {
    const row = await (prisma as any).objects.findUnique({ where: { local_id: localId } });
    return mapObject(row);
  };

  const replaceObjectRecipients = async (objectId: string, recipients: Types.ObjectRecipientInput[]) => {
    await (prisma as any).object_recipients.deleteMany({ where: { object_id: objectId } });
    if (!recipients.length) return;
    await (prisma as any).object_recipients.createMany({
      data: recipients.map((r) => ({
        object_id: objectId,
        recipient: r.recipient,
        recipient_type: r.recipient_type,
      })),
      skipDuplicates: true,
    });
  };

  const listObjectRecipients = async (objectId: string) => {
    const rows = await (prisma as any).object_recipients.findMany({ where: { object_id: objectId } });
    return rows.map((row: any) => ({
      object_id: row.object_id,
      recipient: row.recipient,
      recipient_type: row.recipient_type,
    })) as Types.ObjectRecipientInput[];
  };

  const createObject = async (input: Types.ObjectWriteInput) => {
    const data: any = {
      id: input.id,
      local_id: input.local_id ?? null,
      type: input.type,
      actor: input.actor,
      published: toIso(input.published),
      updated: toIso(input.updated),
      to: input.to ?? null,
      cc: input.cc ?? null,
      bto: input.bto ?? null,
      bcc: input.bcc ?? null,
      context: input.context ?? null,
      in_reply_to: input.in_reply_to ?? null,
      content: input.content ?? {},
      is_local: input.is_local === undefined ? 1 : Number(input.is_local ? 1 : 0),
      visibility: input.visibility ?? null,
      deleted_at: input.deleted_at ? toIso(input.deleted_at) : null,
      created_at: input.created_at ? toIso(input.created_at) : undefined,
    };
    const row = await (prisma as any).objects.create({ data });
    try {
      const recipients = buildRecipients(row.id, {
        to: input.to,
        cc: input.cc,
        bto: input.bto,
        bcc: input.bcc,
      });
      await replaceObjectRecipients(row.id, recipients);
    } catch (error) {
      console.error("failed to store object recipients", error);
    }
    return mapObject(row)!;
  };

  const updateObject = async (id: string, data: Types.ObjectUpdateInput) => {
    const current = await getObject(id);
    const row = await (prisma as any).objects.update({
      where: { id },
      data: {
        published: data.published ? toIso(data.published) : undefined,
        updated: data.updated ? toIso(data.updated) : undefined,
        to: data.to === undefined ? undefined : data.to,
        cc: data.cc === undefined ? undefined : data.cc,
        bto: data.bto === undefined ? undefined : data.bto,
        bcc: data.bcc === undefined ? undefined : data.bcc,
        context: data.context === undefined ? undefined : data.context,
        in_reply_to: data.in_reply_to === undefined ? undefined : data.in_reply_to,
        content: data.content === undefined ? undefined : data.content,
        visibility: data.visibility === undefined ? undefined : data.visibility,
        deleted_at: data.deleted_at ? toIso(data.deleted_at) : undefined,
      },
    });
    try {
      const recipients = buildRecipients(id, {
        to: data.to === undefined ? current?.to : data.to,
        cc: data.cc === undefined ? current?.cc : data.cc,
        bto: data.bto === undefined ? current?.bto : data.bto,
        bcc: data.bcc === undefined ? current?.bcc : data.bcc,
      });
      await replaceObjectRecipients(id, recipients);
    } catch (error) {
      console.error("failed to update object recipients", error);
    }
    return mapObject(row)!;
  };

  const queryObjects = async (params: Types.ObjectQueryParams) => {
    const filters: any = { };
    const notFilters: any[] = [];
    if (params.type) {
      if (Array.isArray(params.type)) filters.type = { in: params.type };
      else filters.type = params.type;
    }
    if (params.actor) filters.actor = params.actor;
    if (params.context) filters.context = params.context;
    if (params.in_reply_to) filters.in_reply_to = params.in_reply_to;
    if (params.visibility) {
      if (Array.isArray(params.visibility)) filters.visibility = { in: params.visibility };
      else filters.visibility = params.visibility;
    }
    if (params.exclude_direct || (!params.include_direct && !params.visibility)) {
      notFilters.push({ visibility: "direct" });
    }
    if (notFilters.length === 1) filters.NOT = notFilters[0];
    if (notFilters.length > 1) filters.NOT = notFilters;
    if (params.participant) {
      filters.OR = [
        { actor: params.participant },
        { recipients: { some: { recipient: params.participant } } },
      ];
    }
    if (params.since || params.until) {
      filters.published = {};
      if (params.since) filters.published.gte = params.since;
      if (params.until) filters.published.lte = params.until;
    }
    if (!params.include_deleted) {
      filters.deleted_at = null;
    }
    const rows = await (prisma as any).objects.findMany({
      where: filters,
      orderBy: { published: params.order === "asc" ? "asc" : "desc" },
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
    });
    return rows.map(mapObject).filter(Boolean) as Types.ObjectRecord[];
  };

  const deleteObject = async (id: string) => {
    await (prisma as any).objects.update({
      where: { id },
      data: { deleted_at: new Date().toISOString() },
    });
  };

  // Legacy user helpers mapped to actors
  const getUser = async (id: string) => actorById(id);
  const getUserByHandle = async (handle: string) => actorByHandle(handle);
  const createUser = async (user: Types.UserInput) =>
    createActor({
      handle: user.handle ?? user.id ?? "",
      local_id: user.id ?? user.handle ?? "",
      display_name: user.display_name,
      avatar_url: user.avatar_url ?? "",
      type: "Person",
      is_local: user.is_private === undefined ? 1 : Number(!user.is_private ? 1 : 0),
      profile_completed_at: user.profile_completed_at ?? null,
    });

  const updateUser = async (id: string, fields: Types.UserUpdateFields) => {
    const data: any = {};
    if (fields.display_name !== undefined) data.display_name = fields.display_name ?? "";
    if (fields.avatar_url !== undefined) data.avatar_url = fields.avatar_url ?? "";
    if (fields.is_private !== undefined) data.is_local = Number(!fields.is_private ? 1 : 0);
    if (fields.profile_completed_at !== undefined) data.profile_completed_at = fields.profile_completed_at ? new Date(fields.profile_completed_at) : null;
    return updateActor(id, data);
  };

  const renameUserId = async (oldId: string, newId: string) => {
    const actor = await actorById(oldId);
    if (!actor) return null;
    const row = await (prisma as any).actors.update({
      where: { id: actor.id },
      data: { id: newId, handle: newId, local_id: newId },
    });
    return mapActor(row);
  };

  const getAccountByProvider = async (provider: string, providerAccountId: string) =>
    (prisma as any).user_accounts.findUnique({
      where: {
        provider_provider_account_id: {
          provider,
          provider_account_id: providerAccountId,
        },
      },
    });

  const createUserAccount = async (account: Types.UserAccountInput) =>
    (prisma as any).user_accounts.create({
      data: {
        id: account.id,
        actor_id: ensureActorId(account.user_id),
        provider: account.provider,
        provider_account_id: account.provider_account_id,
        password_hash: (account as any).password_hash ?? null,
        created_at: account.created_at ? new Date(account.created_at) : new Date(),
        updated_at: account.updated_at ? new Date(account.updated_at) : new Date(),
      },
    });

  const updateAccountUser = async (provider: string, providerAccountId: string, user_id: string) =>
    (prisma as any).user_accounts.update({
      where: {
        provider_provider_account_id: {
          provider,
          provider_account_id: providerAccountId,
        },
      },
      data: { actor_id: ensureActorId(user_id) },
    });

  const updateUserAccountPassword = async (accountId: string, newPasswordHash: string) =>
    (prisma as any).user_accounts.update({
      where: { id: accountId },
      data: { password_hash: newPasswordHash, updated_at: new Date() },
    });

  const listAccountsByUser = async (user_id: string) =>
    (prisma as any).user_accounts.findMany({ where: { actor_id: ensureActorId(user_id) } });

  const getUserJwtSecret = async (userId: string) => {
    const actor = await actorById(userId);
    return actor?.jwt_secret ?? null;
  };

  const setUserJwtSecret = async (userId: string, secret: string) => {
    await (prisma as any).actors.update({
      where: { id: userId },
      data: { jwt_secret: secret },
    });
  };

  const areFriends = async (userId1: string, userId2: string) => {
    const follow1 = await (prisma as any).follows.findUnique({
      where: { follower_id_following_id: { follower_id: userId1, following_id: userId2 } },
    });
    const follow2 = await (prisma as any).follows.findUnique({
      where: { follower_id_following_id: { follower_id: userId2, following_id: userId1 } },
    });
    return !!(follow1 && follow2 && follow1.status === "accepted" && follow2.status === "accepted");
  };

  const listFriends = async (userId: string) => {
    const rows = await (prisma as any).follows.findMany({
      where: { follower_id: userId, status: "accepted" },
    });
    return rows.map((r: any) => r.following_id);
  };

  const listFollowers = async (userId: string, limit = 20, offset = 0) => {
    const rows = await (prisma as any).follows.findMany({
      where: { following_id: userId, NOT: { status: "rejected" } },
      include: { follower: true },
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    });
    return rows.map((r: any) => r.follower).filter(Boolean);
  };

  const listFollowing = async (userId: string, limit = 20, offset = 0) => {
    const rows = await (prisma as any).follows.findMany({
      where: { follower_id: userId, NOT: { status: "rejected" } },
      include: { following: true },
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    });
    return rows.map((r: any) => r.following).filter(Boolean);
  };

  const deleteFollow = async (follower_id: string, following_id: string) =>
    (prisma as any).follows.deleteMany({ where: { follower_id, following_id } });

  const blockUser = async (blocker_id: string, blocked_id: string) =>
    (prisma as any).blocks.upsert({
      where: { blocker_id_blocked_id: { blocker_id, blocked_id } },
      update: {},
      create: { blocker_id, blocked_id },
    });

  const unblockUser = async (blocker_id: string, blocked_id: string) =>
    (prisma as any).blocks.deleteMany({ where: { blocker_id, blocked_id } });

  const listBlockedUsers = async (blocker_id: string) =>
    (prisma as any).blocks.findMany({ where: { blocker_id } });

  const listUsersBlocking = async (user_id: string) => {
    const rows = await (prisma as any).blocks.findMany({ where: { blocked_id: user_id } });
    return rows.map((r: any) => r.blocker_id);
  };

  const isBlocked = async (blocker_id: string, target_id: string) => {
    const row = await (prisma as any).blocks.findUnique({
      where: { blocker_id_blocked_id: { blocker_id, blocked_id: target_id } },
    });
    return !!row;
  };

  const muteUser = async (muter_id: string, muted_id: string) =>
    (prisma as any).mutes.upsert({
      where: { muter_id_muted_id: { muter_id, muted_id } },
      update: {},
      create: { muter_id, muted_id },
    });

  const unmuteUser = async (muter_id: string, muted_id: string) =>
    (prisma as any).mutes.deleteMany({ where: { muter_id, muted_id } });

  const listMutedUsers = async (muter_id: string) => (prisma as any).mutes.findMany({ where: { muter_id } });

  const isMuted = async (muter_id: string, target_id: string) => {
    const row = await (prisma as any).mutes.findUnique({
      where: { muter_id_muted_id: { muter_id, muted_id: target_id } },
    });
    return !!row;
  };

  const addNotification = async (notification: Types.NotificationInput) =>
    (prisma as any).notifications.create({
      data: {
        id: notification.id,
        recipient_id: pickActorId({ actor_id: notification.user_id, user_id: notification.user_id }),
        type: notification.type,
        actor_id: notification.actor_id ?? null,
        object_id: notification.object_id ?? null,
        ref_type: notification.ref_type,
        ref_id: notification.ref_id,
        message: notification.message ?? "",
        data_json: notification.data_json ? JSON.stringify(notification.data_json) : null,
        created_at: notification.created_at ? new Date(notification.created_at) : new Date(),
        read: notification.read ? 1 : 0,
      },
    });

  const listNotifications = async (user_id: string) =>
    (prisma as any).notifications.findMany({
      where: { recipient_id: user_id },
      orderBy: { created_at: "desc" },
    });

  const listNotificationsSince = async (user_id: string, since: Date | string) =>
    (prisma as any).notifications.findMany({
      where: { recipient_id: user_id, created_at: { gt: since instanceof Date ? since : new Date(since) } },
      orderBy: { created_at: "desc" },
    });

  const markNotificationRead = async (id: string) =>
    (prisma as any).notifications.update({ where: { id }, data: { read: 1 } });

  const countUnreadNotifications = async (user_id: string) => {
    const res = await (prisma as any).notifications.count({ where: { recipient_id: user_id, read: 0 } });
    return res ?? 0;
  };

  const createCommunity = async (community: Types.CommunityInput) =>
    createActor({
      id: community.id,
      handle: community.id,
      local_id: community.id,
      type: "Group",
      display_name: community.name,
      avatar_url: community.icon_url ?? "",
      visibility: community.visibility ?? "public",
      owner_id: community.created_by,
      metadata_json: JSON.stringify({
        icon_url: community.icon_url ?? "",
        visibility: community.visibility ?? "public",
        created_at: community.created_at ?? new Date().toISOString(),
      }),
    });

  const getCommunity = async (id: string) => actorById(id);

  const updateCommunity = async (id: string, fields: Record<string, any>) => updateActor(id, fields);

  const setMembership = async (community_id: string, user_id: string, membership: Types.MembershipInput) =>
    (prisma as any).memberships.upsert({
      where: { community_id_actor_id: { community_id, actor_id: user_id } },
      update: {
        role: membership.role ?? "member",
        status: membership.status ?? "active",
      },
      create: {
        community_id,
        actor_id: user_id,
        role: membership.role ?? "member",
        status: membership.status ?? "active",
        joined_at: membership.joined_at ? new Date(membership.joined_at) : new Date(),
      },
    });

  const removeMembership = async (community_id: string, user_id: string) =>
    (prisma as any).memberships.deleteMany({ where: { community_id, actor_id: user_id } });

  const hasMembership = async (community_id: string, user_id: string) => {
    const row = await (prisma as any).memberships.findUnique({
      where: { community_id_actor_id: { community_id, actor_id: user_id } },
    });
    return !!row;
  };

  const listMembershipsByCommunity = async (community_id: string) =>
    (prisma as any).memberships.findMany({ where: { community_id } });

  const listUserCommunities = async (user_id: string) =>
    (prisma as any).memberships.findMany({ where: { actor_id: user_id } });

  const listCommunityMembersWithUsers = async (community_id: string) => {
    const memberships = await listMembershipsByCommunity(community_id);
    const actors = await (prisma as any).actors.findMany({
      where: { id: { in: memberships.map((m: any) => m.actor_id) } },
    });
    return actors.map(mapActor).filter(Boolean);
  };

  const listChannelsByCommunity = async (community_id: string) =>
    (prisma as any).channels.findMany({ where: { actor_id: community_id }, orderBy: { position: "asc" } });

  const createChannel = async (community_id: string, channel: Types.ChannelInput) =>
    (prisma as any).channels.create({
      data: {
        id: channel.id,
        actor_id: community_id,
        name: channel.name,
        created_at: channel.created_at ? new Date(channel.created_at) : new Date(),
      },
    });

  const getChannel = async (community_id: string, id: string) =>
    (prisma as any).channels.findUnique({
      where: { id },
    });

  const updateChannel = async (community_id: string, id: string, fields: { name?: string }) =>
    (prisma as any).channels.update({
      where: { id },
      data: { name: fields.name },
    });

  const deleteChannel = async (community_id: string, id: string) =>
    (prisma as any).channels.delete({ where: { id } });

  const createList = async (list: Types.ListInput) =>
    (prisma as any).lists.create({
      data: {
        id: list.id,
        owner_id: list.owner_id,
        name: list.name,
        description: list.description ?? "",
        is_public: Number(list.is_public ? 1 : 0),
        created_at: list.created_at ? new Date(list.created_at) : new Date(),
        updated_at: list.updated_at ? new Date(list.updated_at) : new Date(),
      },
    });

  const updateList = async (id: string, fields: Partial<Types.ListInput>) =>
    (prisma as any).lists.update({
      where: { id },
      data: {
        name: fields.name,
        description: fields.description,
        is_public: fields.is_public === undefined ? undefined : Number(fields.is_public ? 1 : 0),
        updated_at: fields.updated_at ? new Date(fields.updated_at) : new Date(),
      },
    });

  const getList = async (id: string) => (prisma as any).lists.findUnique({ where: { id } });

  const listListsByOwner = async (owner_id: string) => (prisma as any).lists.findMany({ where: { owner_id } });

  const addListMember = async (member: Types.ListMemberInput) =>
    (prisma as any).list_members.upsert({
      where: { list_id_actor_id: { list_id: member.list_id, actor_id: member.actor_id ?? member.user_id! } },
      update: {},
      create: {
        list_id: member.list_id,
        actor_id: member.actor_id ?? member.user_id!,
        added_at: member.added_at ? new Date(member.added_at) : new Date(),
      },
    });

  const removeListMember = async (list_id: string, user_id: string) =>
    (prisma as any).list_members.deleteMany({ where: { list_id, actor_id: user_id } });

  const listMembersByList = async (list_id: string) => (prisma as any).list_members.findMany({ where: { list_id } });

  const createInvite = async (invite: Types.InviteInput) =>
    (prisma as any).invites.create({
      data: {
        code: invite.code,
        community_id: invite.community_id,
        expires_at: invite.expires_at ? new Date(invite.expires_at) : null,
        created_by: invite.created_by,
        max_uses: invite.max_uses ?? 0,
        uses: invite.uses ?? 0,
        active: Number(invite.active === undefined ? 1 : invite.active ? 1 : 0),
        created_at: new Date(),
      },
    });

  const listInvites = async (community_id: string) => (prisma as any).invites.findMany({ where: { community_id } });

  const getInvite = async (code: string) => (prisma as any).invites.findUnique({ where: { code } });

  const updateInvite = async (code: string, fields: Record<string, any>) =>
    (prisma as any).invites.update({ where: { code }, data: fields });

  const disableInvite = async (code: string) => updateInvite(code, { active: 0 });

  const resetInvites = async (community_id: string) =>
    (prisma as any).invites.updateMany({ where: { community_id }, data: { active: 0 } });

  const createMemberInvite = async (invite: Types.MemberInviteInput) =>
    (prisma as any).member_invites.create({
      data: {
        id: invite.id,
        community_id: invite.community_id,
        invited_actor_id: invite.invited_actor_id ?? invite.invited_user_id!,
        invited_by: invite.invited_by_actor_id ?? invite.invited_by ?? "",
        status: invite.status ?? "pending",
        created_at: invite.created_at ? new Date(invite.created_at) : new Date(),
      },
    });

  const listMemberInvitesByCommunity = async (community_id: string) =>
    (prisma as any).member_invites.findMany({ where: { community_id } });

  const listMemberInvitesForUser = async (user_id: string) =>
    (prisma as any).member_invites.findMany({ where: { invited_actor_id: user_id } });

  const getMemberInvite = async (id: string) => (prisma as any).member_invites.findUnique({ where: { id } });

  const setMemberInviteStatus = async (id: string, status: string) =>
    (prisma as any).member_invites.update({ where: { id }, data: { status } });

  const createPost = async (post: Types.PostInput) => createObject(buildNoteObject(post));
  const getPost = async (id: string) => {
    const obj = await getObject(id);
    if (!obj) return null;
    const content = obj.content || {};
    return {
      id: obj.local_id ?? obj.id,
      ap_object_id: obj.id,
      author_id: obj.actor,
      community_id: obj.context ?? null,
      type: obj.type,
      text: content.content ?? content.summary ?? "",
      content_warning: content.summary ?? null,
      sensitive: !!content["takos:sensitive"],
      created_at: obj.published ?? obj.created_at,
    };
  };

  const listPostsByCommunity = async (community_id: string) =>
    queryObjects({ type: ["Note", "Article", "Question"], context: community_id, include_deleted: false });

  const listGlobalPostsForUser = async (_user_id: string) =>
    queryObjects({ type: ["Note", "Article", "Question"], visibility: ["public", "followers"], include_deleted: false, limit: 200 });

  const listGlobalPostsSince = async (
    _user_id: string,
    since: Date | string,
    options?: { authorIds?: string[]; friendIds?: string[]; limit?: number },
  ) => {
    const sinceDate = since instanceof Date ? since.toISOString() : String(since);
    const limit = options?.limit ?? 100;
    const authorIds = options?.authorIds ?? [];
    if (authorIds.length > 0) {
      const placeholders = authorIds.map(() => "?").join(",");
      const rows = await runAll(
        `SELECT * FROM objects WHERE type IN ('Note','Article','Question') AND deleted_at IS NULL AND published >= ? AND actor IN (${placeholders}) ORDER BY published DESC LIMIT ?`,
        [sinceDate, ...authorIds, limit],
      );
      return rows.map(mapObject).filter(Boolean);
    }
    const rows = await runAll(
      `SELECT * FROM objects WHERE type IN ('Note','Article','Question') AND deleted_at IS NULL AND published >= ? ORDER BY published DESC LIMIT ?`,
      [sinceDate, limit],
    );
    return rows.map(mapObject).filter(Boolean);
  };

  const listPostsByAuthors = async (author_ids: string[], _includeCommunity = false) => {
    if (!author_ids.length) return [];
    const placeholders = author_ids.map(() => "?").join(",");
    const rows = await runAll(
      `SELECT * FROM objects WHERE type IN ('Note','Article','Question') AND deleted_at IS NULL AND actor IN (${placeholders}) ORDER BY published DESC`,
      author_ids,
    );
    return rows.map(mapObject).filter(Boolean);
  };

  const searchPublicPosts = async (query: string, limit = 20, offset = 0) => {
    const needle = `%${query}%`;
    const rows = await runAll(
      `SELECT * FROM objects WHERE type IN ('Note','Article','Question') AND deleted_at IS NULL AND content LIKE ? ORDER BY published DESC LIMIT ? OFFSET ?`,
      [needle, limit, offset],
    );
    return rows.map(mapObject).filter(Boolean);
  };

  const updatePost = async (id: string, fields: Record<string, any>) => updateObject(id, fields);

  const deletePost = async (id: string) => deleteObject(id);

  const addReaction = async (reaction: Types.ReactionInput) =>
    createObject({
      id: reaction.ap_activity_id ?? reaction.id,
      local_id: reaction.id,
      type: "Like",
      actor: reaction.user_id,
      content: { object: reaction.post_id },
      published: toIso(reaction.created_at) ?? new Date().toISOString(),
      visibility: "public",
      is_local: true,
    });

  const listReactionsByPost = async (post_id: string) =>
    queryObjects({ type: "Like", include_deleted: false, visibility: ["public", "followers", "direct"], limit: 200, offset: 0 }).then((items) =>
      items.filter((o) => o.content?.object === post_id),
    );

  const getReaction = async (id: string) => getObject(id);

  const deleteReaction = async (id: string) => deleteObject(id);

  const addComment = async (comment: Types.CommentInput) =>
    createObject({
      id: comment.ap_object_id ?? comment.id,
      local_id: comment.id,
      type: "Note",
      actor: comment.author_id,
      in_reply_to: comment.post_id,
      content: { content: comment.text },
      published: toIso(comment.created_at) ?? new Date().toISOString(),
      visibility: "public",
      is_local: true,
    });

  const listCommentsByPost = async (post_id: string) => queryObjects({ in_reply_to: post_id, type: "Note" });

  const getComment = async (id: string) => getObject(id);

  const deleteComment = async (id: string) => deleteObject(id);

  const addBookmark = async (input: Types.BookmarkInput) =>
    (prisma as any).object_bookmarks.upsert({
      where: { object_id_actor_id: { object_id: input.object_id ?? input.id ?? "", actor_id: input.actor_id ?? input.user_id! } },
      update: {},
      create: {
        id: input.id ?? crypto.randomUUID(),
        object_id: input.object_id ?? input.id ?? "",
        actor_id: input.actor_id ?? input.user_id!,
        created_at: input.created_at ? new Date(input.created_at) : new Date(),
      },
    });

  const deleteBookmark = async (post_id: string, user_id: string) =>
    (prisma as any).object_bookmarks.deleteMany({ where: { object_id: post_id, actor_id: user_id } });

  const listBookmarksByUser = async (user_id: string, limit = 50, offset = 0) => {
    const rows = await (prisma as any).object_bookmarks.findMany({
      where: { actor_id: user_id },
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    });
    return rows;
  };

  const getBookmarkedPostIds = async (user_id: string, postIds: string[]): Promise<Set<string>> => {
    const rows = await (prisma as any).object_bookmarks.findMany({
      where: { actor_id: user_id, object_id: { in: postIds } },
    });
    return new Set(rows.map((r: any) => r.object_id as string));
  };

  const isPostBookmarked = async (post_id: string, user_id: string) => {
    const row = await (prisma as any).object_bookmarks.findUnique({
      where: { object_id_actor_id: { object_id: post_id, actor_id: user_id } },
    });
    return !!row;
  };

  const addObjectBookmark = addBookmark;
  const removeObjectBookmark = deleteBookmark;
  const listObjectBookmarksByActor = async (actor_id: string, limit = 50, offset = 0) => {
    const rows = await listBookmarksByUser(actor_id, limit, offset);
    const objectIds = rows.map((r: any) => r.object_id);
    const objects = await (prisma as any).objects.findMany({ where: { id: { in: objectIds } } });
    return objects.map(mapObject).filter(Boolean) as Types.ObjectRecord[];
  };
  const getBookmarkedObjectIds = async (actor_id: string, objectIds: string[]) => getBookmarkedPostIds(actor_id, objectIds);

  const createStory = async (story: Types.StoryInput) =>
    createObject({
      id: story.id,
      local_id: story.id,
      type: "Note",
      actor: story.author_id,
      context: story.community_id,
      content: { "takos:story": { items: story.items, expiresAt: story.expires_at } },
      visibility: story.visible_to_friends ? "followers" : "public",
      published: toIso(story.created_at) ?? new Date().toISOString(),
    });

  const getStory = async (id: string) => getObject(id);
  const listStoriesByCommunity = async (community_id: string) =>
    queryObjects({ type: "Note", context: community_id, include_deleted: false, limit: 100 }).then((items) =>
      items.filter((o) => o.content?.["takos:story"]),
    );
  const listGlobalStoriesForUser = async (_user_id: string) =>
    queryObjects({ type: "Note", include_deleted: false, limit: 100 }).then((items) =>
      items.filter((o) => o.content?.["takos:story"]),
    );
  const updateStory = async (id: string, fields: Record<string, any>) => updateObject(id, fields);
  const deleteStory = async (id: string) => deleteObject(id);

  const upsertDmThread = notImplemented;
  const createDmMessage = notImplemented;
  const listDmMessages = notImplemented;
  const listDirectThreadContexts = async (actor_id: string, limit = 20, offset = 0) => {
    const rows = await (prisma as any).objects.groupBy({
      by: ["context"],
      where: {
        visibility: "direct",
        deleted_at: null,
        context: { not: null },
        OR: [
          { actor: actor_id },
          { recipients: { some: { recipient: actor_id } } },
        ],
      },
      _max: { published: true },
      orderBy: { _max: { published: "desc" } },
      take: limit,
      skip: offset,
    });
    return (rows as any[])
      .filter((row) => row.context)
      .map((row) => ({
        context: row.context as string,
        latest: row._max?.published ?? null,
      }));
  };
  const createChannelMessageRecord = notImplemented;
  const listChannelMessages = notImplemented;

  const registerPushDevice = async (device: Types.PushDeviceInput) =>
    (prisma as any).push_devices.upsert({
      where: { token: device.token },
      update: {
        actor_id: device.actor_id ?? device.user_id ?? "",
        platform: device.platform,
        device_name: device.device_name ?? "",
        locale: device.locale ?? "",
        updated_at: new Date(),
      },
      create: {
        id: crypto.randomUUID(),
        actor_id: device.actor_id ?? device.user_id ?? "",
        token: device.token,
        platform: device.platform,
        device_name: device.device_name ?? "",
        locale: device.locale ?? "",
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

  const listPushDevicesByUser = async (user_id: string) => (prisma as any).push_devices.findMany({ where: { actor_id: user_id } });
  const removePushDevice = async (token: string) => (prisma as any).push_devices.deleteMany({ where: { token } });

  const upsertMedia = async (media: Types.MediaRecordInput) =>
    (prisma as any).media.upsert({
      where: { key: media.key },
      update: {
        actor_id: media.user_id,
        url: media.url,
        description: media.description ?? "",
        content_type: media.content_type ?? "",
        updated_at: media.updated_at ? new Date(media.updated_at) : new Date(),
      },
      create: {
        key: media.key,
        actor_id: media.user_id,
        url: media.url,
        description: media.description ?? "",
        content_type: media.content_type ?? "",
        created_at: media.created_at ? new Date(media.created_at) : new Date(),
        updated_at: media.updated_at ? new Date(media.updated_at) : new Date(),
      },
    });

  const getMedia = async (key: string) => (prisma as any).media.findUnique({ where: { key } });
  const listMediaByUser = async (user_id: string) => (prisma as any).media.findMany({ where: { actor_id: user_id } });
  const deleteMedia = async (key: string) => (prisma as any).media.delete({ where: { key } });
  const adjustMediaRefCounts = async (urls: string[], delta: number) => {
    const unique = Array.from(new Set((urls || []).map((u) => `${u}`.trim()).filter(Boolean)));
    if (!unique.length) return;
    const columns = await runAll(`PRAGMA table_info(media)`);
    const hasRefCount = (columns as any[])?.some((c: any) => c.name === "ref_count");
    if (!hasRefCount) return;
    for (const url of unique) {
      await db.prepare(`UPDATE media SET ref_count = MAX(COALESCE(ref_count, 0) + ?, 0) WHERE url = ?`).bind(delta, url).run();
    }
  };

  const createSession = async (session: Types.SessionInput) =>
    (prisma as any).sessions.create({
      data: {
        id: session.id,
        actor_id: session.actor_id ?? session.user_id ?? "",
        created_at: session.created_at ? new Date(session.created_at) : new Date(),
        last_seen: session.last_seen ? new Date(session.last_seen) : new Date(),
        expires_at: session.expires_at ? new Date(session.expires_at) : null,
      },
    });
  const getSession = async (id: string) => (prisma as any).sessions.findUnique({ where: { id } });
  const updateSession = async (id: string, data: Types.SessionUpdateData) =>
    (prisma as any).sessions.update({
      where: { id },
      data: {
        last_seen: data.last_seen ? new Date(data.last_seen) : undefined,
        expires_at: data.expires_at ? new Date(data.expires_at) : undefined,
      },
    });
  const deleteSession = async (id: string) => (prisma as any).sessions.delete({ where: { id } });

  const getOwnerPasswordHash = async () => {
    const row = await (prisma as any).owner_password.findUnique({ where: { id: 1 } });
    return row?.password_hash ?? null;
  };
  const setOwnerPasswordHash = async (hash: string) =>
    (prisma as any).owner_password.upsert({
      where: { id: 1 },
      update: { password_hash: hash, updated_at: new Date() },
      create: { id: 1, password_hash: hash, updated_at: new Date() },
    });

  const upsertApFollower = async (input: Types.ApFollowerInput) =>
    (prisma as any).ap_followers.upsert({
      where: {
        local_actor_id_remote_actor_id: {
          local_actor_id: input.local_actor_id ?? input.local_user_id,
          remote_actor_id: input.remote_actor_id,
        },
      },
      update: {
        status: input.status,
        activity_id: input.activity_id,
        accepted_at: input.accepted_at ? new Date(input.accepted_at) : null,
      },
      create: {
        id: input.id ?? crypto.randomUUID(),
        local_actor_id: input.local_actor_id ?? input.local_user_id,
        remote_actor_id: input.remote_actor_id,
        activity_id: input.activity_id,
        status: input.status,
        created_at: input.created_at ? new Date(input.created_at) : new Date(),
        accepted_at: input.accepted_at ? new Date(input.accepted_at) : null,
      },
    });

  const deleteApFollowers = async (local_user_id: string, remote_actor_id: string) =>
    (prisma as any).ap_followers.deleteMany({ where: { local_actor_id: local_user_id, remote_actor_id } });

  const findApFollower = async (local_user_id: string, remote_actor_id: string) =>
    (prisma as any).ap_followers.findUnique({
      where: { local_actor_id_remote_actor_id: { local_actor_id: local_user_id, remote_actor_id } },
    });

  const countApFollowers = async (local_user_id: string, status?: string) =>
    (prisma as any).ap_followers.count({
      where: { local_actor_id: local_user_id, status: status ?? undefined },
    });

  const listApFollowers = async (local_user_id: string, status?: string | null, limit = 50, offset = 0) =>
    (prisma as any).ap_followers.findMany({
      where: { local_actor_id: local_user_id, status: status ?? undefined },
      take: limit,
      skip: offset,
    });

  const upsertApFollow = async (input: Types.ApFollowerInput) =>
    (prisma as any).ap_follows.upsert({
      where: {
        local_actor_id_remote_actor_id: {
          local_actor_id: input.local_actor_id ?? input.local_user_id,
          remote_actor_id: input.remote_actor_id,
        },
      },
      update: {
        status: input.status,
        activity_id: input.activity_id,
        accepted_at: input.accepted_at ? new Date(input.accepted_at) : null,
      },
      create: {
        id: input.id ?? crypto.randomUUID(),
        local_actor_id: input.local_actor_id ?? input.local_user_id,
        remote_actor_id: input.remote_actor_id,
        activity_id: input.activity_id,
        status: input.status,
        created_at: input.created_at ? new Date(input.created_at) : new Date(),
        accepted_at: input.accepted_at ? new Date(input.accepted_at) : null,
      },
    });

  const deleteApFollows = async (local_user_id: string, remote_actor_id: string) =>
    (prisma as any).ap_follows.deleteMany({ where: { local_actor_id: local_user_id, remote_actor_id } });

  const findApFollow = async (local_user_id: string, remote_actor_id: string) =>
    (prisma as any).ap_follows.findUnique({
      where: { local_actor_id_remote_actor_id: { local_actor_id: local_user_id, remote_actor_id } },
    });

  const updateApFollowersStatus = async (local_user_id: string, remote_actor_id: string, status: string, accepted_at?: Date) =>
    (prisma as any).ap_followers.update({
      where: { local_actor_id_remote_actor_id: { local_actor_id: local_user_id, remote_actor_id } },
      data: { status, accepted_at },
    });

  const updateApFollowsStatus = async (local_user_id: string, remote_actor_id: string, status: string, accepted_at?: Date) =>
    (prisma as any).ap_follows.update({
      where: { local_actor_id_remote_actor_id: { local_actor_id: local_user_id, remote_actor_id } },
      data: { status, accepted_at },
    });

  const countApFollows = async (local_user_id: string, status?: string | null) =>
    (prisma as any).ap_follows.count({ where: { local_actor_id: local_user_id, status: status ?? undefined } });

  const listApFollows = async (local_user_id: string, status?: string | null, limit = 50, offset = 0) =>
    (prisma as any).ap_follows.findMany({
      where: { local_actor_id: local_user_id, status: status ?? undefined },
      take: limit,
      skip: offset,
    });

  const createApInboxActivity = async (input: Types.ApInboxActivityInput) =>
    (prisma as any).ap_inbox_activities.create({
      data: {
        id: input.id ?? crypto.randomUUID(),
        local_actor_id: input.local_actor_id ?? input.local_user_id,
        remote_actor_id: input.remote_actor_id ?? null,
        activity_id: input.activity_id,
        activity_type: input.activity_type,
        activity_json: input.activity_json,
        status: input.status ?? "pending",
        created_at: input.created_at ? new Date(input.created_at) : new Date(),
      },
    });

  const updateApInboxActivityStatus = async (id: string, status: string, error_message?: string, processed_at?: Date) =>
    (prisma as any).ap_inbox_activities.update({
      where: { id },
      data: { status, error_message, processed_at: processed_at ?? new Date() },
    });

  const claimPendingInboxActivities = async (batchSize: number) => {
    const rows = await (prisma as any).ap_inbox_activities.findMany({
      where: { status: "pending" },
      take: batchSize,
      orderBy: { created_at: "asc" },
    });
    return {
      activities: rows.map((r: any) => ({
        id: r.id,
        activity_json: r.activity_json,
        local_user_id: r.local_actor_id,
      })),
    } as Types.ClaimedInboxBatch;
  };

  const upsertApOutboxActivity = async (input: Types.ApOutboxActivityInput) =>
    (prisma as any).ap_outbox_activities.upsert({
      where: { activity_id: input.activity_id },
      update: {
        activity_type: input.activity_type,
        activity_json: input.activity_json,
        object_id: input.object_id ?? null,
        object_type: input.object_type ?? null,
      },
      create: {
        id: input.id ?? crypto.randomUUID(),
        local_actor_id: input.local_actor_id ?? input.local_user_id,
        activity_id: input.activity_id,
        activity_type: input.activity_type,
        activity_json: input.activity_json,
        object_id: input.object_id ?? null,
        object_type: input.object_type ?? null,
        created_at: input.created_at ? new Date(input.created_at) : new Date(),
      },
    });

  const createApDeliveryQueueItem = async (input: Types.ApDeliveryQueueInput) =>
    (prisma as any).ap_delivery_queue.upsert({
      where: { activity_id_target_inbox_url: { activity_id: input.activity_id, target_inbox_url: input.target_inbox_url } },
      update: {
        status: input.status ?? "pending",
        retry_count: input.retry_count ?? 0,
        last_error: input.last_error ?? null,
        last_attempt_at: input.last_attempt_at ? new Date(input.last_attempt_at) : null,
        delivered_at: input.delivered_at ? new Date(input.delivered_at) : null,
      },
      create: {
        id: input.id ?? crypto.randomUUID(),
        activity_id: input.activity_id,
        target_inbox_url: input.target_inbox_url,
        status: input.status ?? "pending",
        retry_count: input.retry_count ?? 0,
        last_error: input.last_error ?? null,
        last_attempt_at: input.last_attempt_at ? new Date(input.last_attempt_at) : null,
        delivered_at: input.delivered_at ? new Date(input.delivered_at) : null,
        created_at: input.created_at ? new Date(input.created_at) : new Date(),
      },
    });

  const updateApDeliveryQueueStatus = async (id: string, status: string, fields?: Partial<Types.ApDeliveryQueueInput>) =>
    (prisma as any).ap_delivery_queue.update({
      where: { id },
      data: { status, ...fields },
    });

  const claimPendingDeliveries = async (batchSize: number) => {
    const rows = await runAll(
      `SELECT dq.id, dq.activity_id, dq.target_inbox_url, dq.retry_count, dq.status, dq.last_attempt_at,
              oa.activity_json, oa.local_actor_id
       FROM ap_delivery_queue dq
       LEFT JOIN ap_outbox_activities oa ON dq.activity_id = oa.activity_id
       WHERE dq.status = 'pending'
       ORDER BY dq.created_at ASC
       LIMIT ?`,
      [batchSize],
    );
    return {
      ids: rows.map((r: any) => r.id),
      deliveries: rows.map((r: any) => ({
        id: r.id,
        activity_id: r.activity_id,
        target_inbox_url: r.target_inbox_url,
        retry_count: r.retry_count ?? 0,
        activity_json: r.activity_json ?? "",
        local_actor_id: r.local_actor_id ?? null,
        local_user_id: r.local_actor_id ?? null,
      })),
    } as Types.ClaimedDeliveryBatch;
  };

  const resetStaleDeliveries = async (_minutes: number) => undefined;

  const getApInboxStats = async () => {
    const pending = await (prisma as any).ap_inbox_activities.count({ where: { status: "pending" } });
    const processed = await (prisma as any).ap_inbox_activities.count({ where: { status: "processed" } });
    return { pending, processed };
  };

  const getApDeliveryQueueStats = async () => {
    const pending = await (prisma as any).ap_delivery_queue.count({ where: { status: "pending" } });
    const delivered = await (prisma as any).ap_delivery_queue.count({ where: { status: "delivered" } });
    const failed = await (prisma as any).ap_delivery_queue.count({ where: { status: "failed" } });
    return { pending, delivered, failed };
  };

  const getApDeliveryQueueHealth = async () => getApDeliveryQueueStats() as any;
  const getApInboxQueueHealth = async () => getApInboxStats() as any;

  const deleteOldRateLimits = async (key: string, windowStart: number) =>
    (prisma as any).ap_rate_limits.deleteMany({ where: { key, window_start: { lt: windowStart } } });
  const countRateLimits = async (key: string, windowStart: number) => {
    const count = await (prisma as any).ap_rate_limits.count({ where: { key, window_start: windowStart } });
    const oldest = await (prisma as any).ap_rate_limits.findFirst({
      where: { key },
      orderBy: { window_start: "asc" },
    });
    return { count, oldestWindow: oldest?.window_start ?? windowStart };
  };
  const createRateLimitEntry = async (id: string, key: string, windowStart: number, createdAt: number) =>
    (prisma as any).ap_rate_limits.create({
      data: { id, key, window_start: windowStart, created_at: createdAt },
    });

  const countApRateLimits = async () => (prisma as any).ap_rate_limits.count();

  const getLatestAuditLog = async () => {
    const row = await (prisma as any).audit_log.findFirst({
      orderBy: { timestamp: "desc" },
    });
    return mapAudit(row);
  };

  const appendAuditLog = async (entry: Types.AuditLogInput) => {
    if (!entry.checksum) {
      throw new Error("checksum is required for audit_log entry");
    }
    const timestamp = toIso(entry.timestamp) ?? new Date().toISOString();
    const row = await (prisma as any).audit_log.create({
      data: {
        id: entry.id ?? crypto.randomUUID(),
        timestamp,
        actor_type: entry.actor_type,
        actor_id: entry.actor_id ?? null,
        action: entry.action,
        target: entry.target ?? null,
        details_json: entry.details ? JSON.stringify(entry.details) : null,
        checksum: entry.checksum,
        prev_checksum: entry.prev_checksum ?? null,
        created_at: timestamp,
      },
    });
    return mapAudit(row)!;
  };

  const findPostByApObjectId = async (ap_object_id: string) => getObject(ap_object_id);

  const createApReaction = async (input: Types.ApReactionInput) =>
    addReaction({
      id: input.id ?? crypto.randomUUID(),
      post_id: input.post_id,
      user_id: input.user_id,
      emoji: input.emoji ?? "👍",
      created_at: input.created_at ?? new Date(),
      ap_activity_id: input.ap_activity_id ?? null,
    });

  const deleteApReactionsByActivityId = async (ap_activity_id: string) => deleteReaction(ap_activity_id);

  const createApRemotePost = async (input: Types.ApRemotePostInput) => {
    const objectId = input.ap_object_id ?? input.id ?? crypto.randomUUID();
    try {
      await createObject({
        id: objectId,
        local_id: input.id ?? null,
        type: input.type ?? "Note",
        actor: input.author_id,
        content: { content: input.text, summary: input.content_warning ?? null, sensitive: !!input.sensitive },
        published: toIso(input.created_at) ?? new Date().toISOString(),
        context: input.community_id ?? null,
        in_reply_to: input.in_reply_to ?? null,
        visibility: "public",
        is_local: false,
      });
      return { id: objectId, inserted: true };
    } catch {
      return { id: objectId, inserted: false };
    }
  };

  const createApRemoteComment = async (input: Types.ApRemoteCommentInput) =>
    createApRemotePost({
      id: input.id,
      post_id: input.post_id,
      author_id: input.author_id,
      text: input.text,
      created_at: input.created_at,
      ap_object_id: input.ap_object_id,
      ap_activity_id: input.ap_activity_id,
      type: "Note",
      in_reply_to: input.post_id,
    } as any);

  const findApAnnounce = async (activity_id: string) => getObject(activity_id);
  const createApAnnounce = async (input: Types.ApAnnounceInput) =>
    createObject({
      id: input.activity_id,
      local_id: input.id ?? input.activity_id,
      type: "Announce",
      actor: input.actor_id,
      content: { object: input.object_id },
      published: toIso(input.created_at) ?? new Date().toISOString(),
      visibility: "public",
      is_local: false,
    });
  const deleteApAnnouncesByActivityId = async (activity_id: string) => deleteObject(activity_id);

  const findApActor = async (id: string) => actorById(id);
  const findApActorByHandleAndDomain = async (handle: string, domain: string) => {
    const normalized = normalizeHandle(handle);
    return actorByHandle(normalized);
  };
  const upsertApActor = async (actor: Record<string, any>) =>
    (prisma as any).actors.upsert({
      where: { id: actor.id },
      update: actor,
      create: {
        id: actor.id,
        handle: actor.handle ?? actor.id,
        local_id: actor.local_id ?? actor.handle ?? actor.id,
        type: actor.type ?? "Person",
        display_name: actor.display_name ?? "",
        summary: actor.summary ?? "",
        avatar_url: actor.avatar_url ?? "",
        is_local: actor.is_local ?? 0,
      },
    });

  const getApKeypair = async (user_id: string) => {
    const row = await (prisma as any).ap_keypairs.findUnique({ where: { actor_id: user_id } });
    if (!row) return null;
    return { public_key_pem: row.public_key_pem, private_key_pem: row.private_key_pem };
  };
  const createApKeypair = async (input: { user_id: string; public_key_pem: string; private_key_pem: string }) =>
    (prisma as any).ap_keypairs.upsert({
      where: { actor_id: input.user_id },
      update: { public_key_pem: input.public_key_pem, private_key_pem: input.private_key_pem },
      create: { actor_id: input.user_id, public_key_pem: input.public_key_pem, private_key_pem: input.private_key_pem },
    });

  const countApOutboxActivities = async (local_user_id: string) =>
    (prisma as any).ap_outbox_activities.count({ where: { local_actor_id: local_user_id } });
  const listApOutboxActivitiesPage = async (local_user_id: string, limit: number, offset: number) =>
    (prisma as any).ap_outbox_activities.findMany({
      where: { local_actor_id: local_user_id },
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    });

  const countPostsByCommunity = async (community_id: string) =>
    (prisma as any).objects.count({ where: { context: community_id, type: { in: ["Note", "Article", "Question"] }, deleted_at: null } });
  const listPostsByCommunityPage = async (community_id: string, limit: number, offset: number) =>
    queryObjects({ context: community_id, type: ["Note", "Article", "Question"], limit, offset });
  const getPostWithAuthor = async (post_id: string, author_id: string) => {
    const post = await getPost(post_id);
    if (post && (post as any).author_id === author_id) return post;
    return null;
  };

  const createReport = async (report: Types.ReportInput) =>
    (prisma as any).reports.create({
      data: {
        id: report.id,
        reporter_actor_id: report.reporter_actor_id,
        target_actor_id: report.target_actor_id,
        target_object_id: report.target_object_id ?? null,
        reason: report.reason ?? null,
        category: report.category ?? "other",
        status: report.status ?? "pending",
        created_at: report.created_at ? new Date(report.created_at) : new Date(),
        updated_at: report.updated_at ? new Date(report.updated_at) : new Date(),
      },
    });
  const listReports = async (status?: string, limit = 50, offset = 0) =>
    (prisma as any).reports.findMany({
      where: { status: status ?? undefined },
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    });
  const listReportsByUser = async (reporterActorId: string, limit = 50, offset = 0) =>
    (prisma as any).reports.findMany({
      where: { reporter_actor_id: reporterActorId },
      orderBy: { created_at: "desc" },
      take: limit,
      skip: offset,
    });
  const updateReportStatus = async (id: string, status: string) =>
    (prisma as any).reports.update({ where: { id }, data: { status, updated_at: new Date() } });

  const getAiConfig = async () => {
    const row = await (prisma as any).ai_config.findUnique({ where: { id: "default" } });
    const config = row?.config_json ? JSON.parse(row.config_json) : DEFAULT_TAKOS_AI_CONFIG;
    return mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, config);
  };
  const updateAiConfig = async (patch: Partial<TakosAiConfig>) => {
    const current = await getAiConfig();
    const next = mergeTakosAiConfig(current, patch);
    await (prisma as any).ai_config.upsert({
      where: { id: "default" },
      update: { config_json: JSON.stringify(next), updated_at: new Date() },
      create: { id: "default", config_json: JSON.stringify(next), updated_at: new Date() },
    });
    return next;
  };
  const setAiEnabledActions = async (actionIds: string[]) => updateAiConfig({ enabled_actions: actionIds } as any);

  const createAppRevision = async (revision: Types.AppRevisionInput) => {
    const schemaVersion =
      typeof revision.schema_version === "string" && revision.schema_version.trim()
        ? revision.schema_version.trim()
        : APP_MANIFEST_SCHEMA_VERSION;
    const coreVersion =
      typeof revision.core_version === "string" && revision.core_version.trim()
        ? revision.core_version.trim()
        : TAKOS_CORE_VERSION;
    return (prisma as any).app_revisions.create({
      data: {
        id: revision.id,
        created_at: revision.created_at ? new Date(revision.created_at) : new Date(),
        author_type: revision.author_type,
        author_name: revision.author_name ?? null,
        message: revision.message ?? null,
        schema_version: schemaVersion,
        core_version: coreVersion,
        manifest_snapshot: revision.manifest_snapshot,
        script_snapshot_ref: revision.script_snapshot_ref,
      },
    });
  };
  const getAppRevision = async (id: string) => (prisma as any).app_revisions.findUnique({ where: { id } });
  const listAppRevisions = async (limit = 50) =>
    (prisma as any).app_revisions.findMany({ orderBy: { created_at: "desc" }, take: limit });
  const setActiveAppRevision = async (revisionId: string | null) => {
    const revision = revisionId ? await getAppRevision(revisionId) : null;
    if (revisionId && !revision) {
      throw new Error("app revision not found");
    }
    const schemaVersionRaw =
      (revision as any)?.schema_version ?? (revision as any)?.schemaVersion ?? null;
    const coreVersionRaw = (revision as any)?.core_version ?? (revision as any)?.coreVersion ?? null;
    const schemaVersion =
      typeof schemaVersionRaw === "string" && schemaVersionRaw.trim()
        ? schemaVersionRaw.trim()
        : APP_MANIFEST_SCHEMA_VERSION;
    const coreVersion =
      typeof coreVersionRaw === "string" && coreVersionRaw.trim()
        ? coreVersionRaw.trim()
        : TAKOS_CORE_VERSION;

    const schemaCheck = checkSemverCompatibility(APP_MANIFEST_SCHEMA_VERSION, schemaVersion, {
      context: "app manifest schema_version",
      action: "activate",
    });
    if (!schemaCheck.ok) {
      throw new Error(schemaCheck.error || "app revision schema_version is not compatible");
    }
    const coreCheck = checkSemverCompatibility(TAKOS_CORE_VERSION, coreVersion, {
      context: "core_version",
      action: "activate",
    });
    if (!coreCheck.ok) {
      throw new Error(coreCheck.error || "app revision core_version is not compatible");
    }
    if (schemaCheck.warnings?.length) {
      console.warn("[app-state] schema_version warnings", schemaCheck.warnings);
    }
    if (coreCheck.warnings?.length) {
      console.warn("[app-state] core_version warnings", coreCheck.warnings);
    }

    const now = new Date();
    await (prisma as any).app_state.upsert({
      where: { id: 1 },
      update: {
        active_revision_id: revisionId,
        schema_version: schemaVersion,
        core_version: coreVersion,
        updated_at: now,
      },
      create: {
        id: 1,
        active_revision_id: revisionId,
        schema_version: schemaVersion,
        core_version: coreVersion,
        updated_at: now,
      },
    });
  };
  const getActiveAppRevision = async () => {
    const row = await (prisma as any).app_state.findUnique({ where: { id: 1 } });
    if (!row?.active_revision_id) return null;
    const rev = await getAppRevision(row.active_revision_id);
    return {
      active_revision_id: row.active_revision_id ?? null,
      schema_version:
        row.schema_version ?? (rev as any)?.schema_version ?? (rev as any)?.schemaVersion ?? null,
      core_version: row.core_version ?? (rev as any)?.core_version ?? null,
      updated_at: row.updated_at ?? new Date().toISOString(),
      revision: rev ?? null,
    };
  };

  const recordAppRevisionAudit = async (_input: Types.AppRevisionAuditInput) => undefined;

  const appendAppLogEntries = async (entries: Types.AppLogEntry[]) => {
    if (!entries.length) return;
    const data = entries.map((e) => ({
      mode: e.mode ?? "dev",
      workspace_id: e.workspaceId ?? null,
      run_id: e.runId,
      handler: e.handler ?? null,
      level: e.level ?? "info",
      message: e.message,
      data_json: e.data ? JSON.stringify(e.data) : null,
    }));
    for (const row of data) {
      await (prisma as any).app_debug_logs.create({
        data: {
          timestamp: new Date(),
          ...row,
        },
      });
    }
  };

  const listAppLogEntries = async (options?: Types.ListAppLogsOptions) => {
    const where: any = {};
    if (options?.workspaceId) where.workspace_id = options.workspaceId;
    if (options?.handler) where.handler = options.handler;
    return (prisma as any).app_debug_logs.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: options?.limit ?? 200,
    }) as Promise<Types.AppLogRecord[]>;
  };

  const createAppWorkspace = async (workspace: Types.AppWorkspaceInput) =>
    (prisma as any).app_workspaces.create({
      data: {
        id: workspace.id,
        base_revision_id: workspace.base_revision_id ?? null,
        status: workspace.status ?? "draft",
        author_type: workspace.author_type,
        author_name: workspace.author_name ?? null,
        created_at: workspace.created_at ? new Date(workspace.created_at) : new Date(),
        updated_at: workspace.updated_at ? new Date(workspace.updated_at) : new Date(),
      },
    });
  const getAppWorkspace = async (id: string) => (prisma as any).app_workspaces.findUnique({ where: { id } });
  const listAppWorkspaces = async (limit = 50) =>
    (prisma as any).app_workspaces.findMany({ orderBy: { created_at: "desc" }, take: limit });
  const updateAppWorkspaceStatus = async (id: string, status: Types.AppWorkspaceStatus) =>
    (prisma as any).app_workspaces.update({
      where: { id },
      data: { status, updated_at: new Date() },
    });

  const createExportRequest = async (input: Types.DataExportRequestInput) =>
    (prisma as any).data_export_requests.create({
      data: {
        id: input.id,
        actor_id: input.user_id ?? "",
        format: input.format ?? "json",
        status: input.status ?? "pending",
        attempt_count: input.attempt_count ?? 0,
        max_attempts: input.max_attempts ?? 3,
        requested_at: input.requested_at ? new Date(input.requested_at) : new Date(),
        processed_at: input.processed_at ? new Date(input.processed_at) : null,
        download_url: input.download_url ?? null,
        result_json: input.result_json ?? null,
        error_message: input.error_message ?? null,
      },
    });
  const updateExportRequest = async (id: string, fields: Partial<Types.DataExportRequestInput>) =>
    (prisma as any).data_export_requests.update({ where: { id }, data: fields });
  const listExportRequestsByUser = async (user_id: string) =>
    (prisma as any).data_export_requests.findMany({ where: { actor_id: user_id }, orderBy: { requested_at: "desc" } });
  const listPendingExportRequests = async (limit = 10) =>
    (prisma as any).data_export_requests.findMany({ where: { status: "pending" }, take: limit, orderBy: { requested_at: "asc" } });
  const getExportRequest = async (id: string) => (prisma as any).data_export_requests.findUnique({ where: { id } });
  const getExportQueueHealth = async () => {
    const pending = await (prisma as any).data_export_requests.count({ where: { status: "pending" } });
    return { pending } as Types.ExportQueueHealth;
  };

  const transaction = async <T>(fn: (tx: Types.DatabaseAPI) => Promise<T>): Promise<T> => {
    return await (prisma as any).$transaction(async () => {
      const txApi = createDatabaseAPI({ ...config, DB: db });
      return fn(txApi);
    });
  };

  const executeRaw = async (sql: string, ...params: any[]) => {
    await runAll(sql, params);
    return 0;
  };
  const queryRaw = async <T = any>(sql: string, ...params: any[]): Promise<T[]> => runAll(sql, params) as Promise<T[]>;
  const query = queryRaw;
  const disconnect = async () => {
    if (prisma && typeof (prisma as any).$disconnect === "function") {
      await (prisma as any).$disconnect();
    }
  };

  const api: DatabaseAPI = {
    // Actors
    getActorByUri: actorById,
    getActorByHandle: actorByHandle,
    searchActorsByName,
    createActor,
    updateActor,

    // Objects
    createObject,
    updateObject,
    getObject,
    getObjectByLocalId,
    queryObjects,
    replaceObjectRecipients,
    listObjectRecipients,
    deleteObject,

    // Audit
    appendAuditLog,
    getLatestAuditLog,

    // Users (legacy)
    getUser,
    getUserByHandle,
    searchUsers: searchActorsByName,
    searchUsersByName: searchActorsByName as any,
    createUser,
    updateUser,
    renameUserId,

    // Accounts
    getAccountByProvider,
    createUserAccount,
    updateAccountUser,
    updateUserAccountPassword,
    listAccountsByUser,

    // AI config
    getAiConfig,
    updateAiConfig,
    setAiEnabledActions,

    // JWT
    getUserJwtSecret,
    setUserJwtSecret,

    // Friends
    areFriends,
    listFriends,
    listFollowers,
    listFollowing,
    createFollow,
    deleteFollow,

    // Blocks & Mutes
    blockUser,
    unblockUser,
    listBlockedUsers,
    listUsersBlocking,
    isBlocked,
    muteUser,
    unmuteUser,
    listMutedUsers,
    isMuted,

    // Notifications
    addNotification,
    listNotifications,
    listNotificationsSince,
    markNotificationRead,
    countUnreadNotifications,

    // Communities & Memberships
    createCommunity,
    getCommunity,
    updateCommunity,
    searchCommunities: searchActorsByName as any,
    setMembership,
    removeMembership,
    hasMembership,
    listMembershipsByCommunity,
    listUserCommunities,
    listCommunityMembersWithUsers,

    // Channels
    listChannelsByCommunity,
    createChannel,
    getChannel,
    getChannelByName: getChannel,
    updateChannel,
    deleteChannel,

    // Lists
    createList,
    updateList,
    getList,
    listListsByOwner,
    addListMember,
    removeListMember,
    listMembersByList,

    // Invites
    createInvite,
    listInvites,
    getInvite,
    updateInvite,
    disableInvite,
    resetInvites,

    // Member Invites
    createMemberInvite,
    listMemberInvitesByCommunity,
    listMemberInvitesForUser,
    getMemberInvite,
    setMemberInviteStatus,

    // Posts
    createPost,
    getPost,
    listPostsByCommunity,
    listPinnedPostsByUser: async () => [],
    countPinnedPostsByUser: async () => 0,
    listGlobalPostsForUser,
    listGlobalPostsSince,
    listPostsByAuthors,
    searchPublicPosts,
    listPostsByHashtag: async () => [],
    listTrendingHashtags: async () => [],
    listHashtagsForPost: async () => [],
    setPostHashtags: async () => {},
    setPostMentions: async () => {},
    listMentionedUsers: async () => [],
    updatePost,
    createPostEditHistory: async () => null,
    listPostEditHistory: async () => [],
    deletePost,

    // Polls
    createPoll: notImplemented,
    getPollByPost: async () => null,
    listPollsByPostIds: async () => [],
    listPollVotes: async () => [],
    listPollVotesByUser: async () => [],
    createPollVotes: notImplemented,

    // Reactions
    addReaction,
    listReactionsByPost,
    listReactionsByUser: async () => [],
    getReaction,
    deleteReaction,

    // Reposts
    addRepost: notImplemented,
    deleteRepost: notImplemented,
    listRepostsByPost: async () => [],
    countRepostsByPost: async () => 0,
    findRepost: async () => null,

    // Comments
    addComment,
    listCommentsByPost,
    getComment,
    deleteComment,

    // Media
    upsertMedia,
    getMedia,
    listMediaByUser,
    deleteMedia,
    adjustMediaRefCounts,

    // Bookmarks
    addBookmark,
    deleteBookmark,
    listBookmarksByUser,
    getBookmarkedPostIds,
    isPostBookmarked,
    addObjectBookmark,
    removeObjectBookmark,
    listObjectBookmarksByActor,
    getBookmarkedObjectIds,

    // Stories
    createStory,
    getStory,
    listStoriesByCommunity,
    listGlobalStoriesForUser,
    updateStory,
    deleteStory,

    // Push Devices
    registerPushDevice,
    listPushDevicesByUser,
    removePushDevice,

    // Chat
    upsertDmThread,
    createDmMessage,
    listDmMessages,
    listDirectThreadContexts,
    createChannelMessageRecord,
    listChannelMessages,
    getDmThread: async () => null,
    listAllDmThreads: async () => [],

    // Sessions
    createSession,
    getSession,
    updateSession,
    deleteSession,
    getOwnerPasswordHash,
    setOwnerPasswordHash,

    // ActivityPub - Followers
    upsertApFollower,
    deleteApFollowers,
    findApFollower,
    updateApFollowersStatus,
    countApFollowers,
    listApFollowers,

    // ActivityPub - Follows
    upsertApFollow,
    deleteApFollows,
    findApFollow,
    updateApFollowsStatus,
    countApFollows,
    listApFollows,

    // ActivityPub - Inbox Activities
    createApInboxActivity,
    updateApInboxActivityStatus,
    claimPendingInboxActivities,

    // ActivityPub - Outbox Activities
    upsertApOutboxActivity,

    // ActivityPub - Delivery Queue
    createApDeliveryQueueItem,
    updateApDeliveryQueueStatus,
    claimPendingDeliveries,
    resetStaleDeliveries,
    getApInboxStats,
    getApDeliveryQueueStats,
    getApDeliveryQueueHealth,
    getApInboxQueueHealth,
    countApRateLimits,

    // ActivityPub - Rate Limiting
    deleteOldRateLimits,
    countRateLimits,
    createRateLimitEntry,

    // ActivityPub - Posts & Reactions
    findPostByApObjectId,
    createApReaction,
    deleteApReactionsByActivityId,
    createApRemotePost,
    createApRemoteComment,

    // ActivityPub - Announces
    findApAnnounce,
    createApAnnounce,
    deleteApAnnouncesByActivityId,

    // ActivityPub - Actor Cache
    findApActor,
    findApActorByHandleAndDomain,
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
    query,
    disconnect,

    // Reports
    createReport,
    listReports,
    listReportsByUser,
    updateReportStatus,

    // App revisions
    createAppRevision,
    getAppRevision,
    listAppRevisions,
    setActiveAppRevision,
    getActiveAppRevision,
    recordAppRevisionAudit,
    appendAppLogEntries,
    listAppLogEntries,
    createAppWorkspace,
    getAppWorkspace,
    listAppWorkspaces,
    updateAppWorkspaceStatus,

    // Data export
    createExportRequest,
    updateExportRequest,
    listExportRequestsByUser,
    listPendingExportRequests,
    getExportRequest,
    getExportQueueHealth,
  };

  return api;
}
