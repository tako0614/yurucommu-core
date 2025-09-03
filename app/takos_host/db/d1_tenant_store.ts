import type { DataStore, SortSpec } from "../../core/db/types.ts";
import type { AccountDoc, SessionDoc, DirectMessageDoc, GroupDoc, ListedGroup } from "@takos/types";

export interface D1Database {
  prepare(sql: string): {
    bind: (...args: unknown[]) => {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<unknown>;
  };
}

type Row = Record<string, unknown>;

function now(): number { return Date.now(); }
function toBool(v: unknown): boolean { return v === 1 || v === true || v === "1"; }
function json<T = unknown>(v: unknown): T | undefined {
  if (v == null) return undefined; try { return JSON.parse(String(v)) as T; } catch { return undefined; }
}

function mapAccountRow(row: Row): AccountDoc {
  return {
    _id: String(row.id),
    userName: String(row.user_name),
    displayName: String(row.display_name),
    avatarInitial: String(row.avatar_initial),
    privateKey: row.private_key != null ? String(row.private_key) : undefined,
    publicKey: String(row.public_key),
    followers: json<string[]>(row.followers_json) ?? [],
    following: json<string[]>(row.following_json) ?? [],
  };
}

function mapDMConversationRow(row: Row): DirectMessageDoc {
  return {
    _id: String(row.id),
    owner: String(row.owner),
    id: String(row.participant_id),
  };
}

function mapPostRow(row: Row): Record<string, unknown> {
  return {
    _id: String(row.id),
    id: String(row.id),
    type: String(row.type),
    actor: String(row.actor),
    actor_id: String(row.actor), // actor_id を明示的に設定
    content: row.content ? String(row.content) : undefined,
    extra: json<Record<string, unknown>>(row.extra_json) ?? {},
    to: json<string[]>(row.to_json) ?? [],
    cc: json<string[]>(row.cc_json) ?? [],
    published: new Date(Number(row.created_at)).toISOString(),
    updated: new Date(Number(row.updated_at)).toISOString(),
  };
}

function mapNotificationRow(row: Row): Record<string, unknown> {
  return {
    _id: String(row.id),
    owner: String(row.owner),
    title: String(row.title),
    message: String(row.message),
    type: String(row.type),
    read: toBool(row.read_status),
    createdAt: new Date(Number(row.created_at)),
  };
}

function mapRemoteActorRow(row: Row): Record<string, unknown> {
  return {
    _id: String(row.id),
    id: String(row.actor_url),
    name: String(row.name),
    preferredUsername: String(row.preferred_username),
    icon: json<Record<string, unknown>>(row.icon_json),
    summary: String(row.summary),
    updatedAt: new Date(Number(row.updated_at)),
  };
}

function mapGroupRow(row: Row): GroupDoc {
  return {
    _id: String(row.id),
    groupName: String(row.group_name),
    displayName: String(row.display_name),
    summary: row.summary ? String(row.summary) : undefined,
    icon: json<Record<string, unknown>>(row.icon_json),
    image: json<Record<string, unknown>>(row.image_json),
    membershipPolicy: row.membership_policy ? String(row.membership_policy) : undefined,
    invitePolicy: row.invite_policy ? String(row.invite_policy) : undefined,
    visibility: row.visibility ? String(row.visibility) : undefined,
    allowInvites: toBool(row.allow_invites),
    followers: json<string[]>(row.followers_json) ?? [],
    outbox: json<Record<string, unknown>[]>(row.outbox_json) ?? [],
    privateKey: row.private_key ? String(row.private_key) : undefined,
    publicKey: String(row.public_key),
  };
}

function mapListedGroupRow(row: Row): ListedGroup {
  return {
    id: String(row.group_name),
    name: String(row.display_name),
    icon: json<Record<string, unknown>>(row.icon_json),
    members: json<string[]>(row.followers_json) ?? [],
  };
}

function mapInviteRow(row: Row): Record<string, unknown> {
  return {
    _id: String(row.id),
    inviter: String(row.inviter),
    invitee: String(row.invitee),
    groupName: row.group_name ? String(row.group_name) : undefined,
    status: String(row.status),
    extra: json<Record<string, unknown>>(row.extra_json),
    createdAt: new Date(Number(row.created_at)),
    updatedAt: new Date(Number(row.updated_at)),
  };
}

function mapApprovalRow(row: Row): Record<string, unknown> {
  return {
    _id: String(row.id),
    requester: String(row.requester),
    target: String(row.target),
    type: String(row.type),
    status: String(row.status),
    extra: json<Record<string, unknown>>(row.extra_json),
    createdAt: new Date(Number(row.created_at)),
    updatedAt: new Date(Number(row.updated_at)),
  };
}

// R2 互換バケツ（Workers 環境のバインディングを利用）
type R2BucketLike = {
  put(key: string, data: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
};

function createR2Storage(env: Record<string, string>) {
  const bucketName = env["R2_BUCKET"];
  const binding = bucketName
    ? (globalThis as unknown as Record<string, unknown>)[bucketName]
    : undefined;
  const bucket = binding as R2BucketLike | undefined;
  if (!bucket) {
    return {
      async put(_key: string, _data: Uint8Array) { return ""; },
      async get(_key: string) { return null as Uint8Array | null; },
      async delete(_key: string) { /* noop */ },
    };
  }
  return {
    async put(key: string, data: Uint8Array) {
      await bucket.put(key, data);
      return key;
    },
    async get(key: string) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      const buf = await obj.arrayBuffer();
      return new Uint8Array(buf);
    },
    async delete(key: string) {
      await bucket.delete(key);
    },
  };
}

export function createD1TenantDataStore(env: Record<string, string>, d1: D1Database): DataStore {
  const storage = createR2Storage(env);
  const tenant = (env["ACTIVITYPUB_DOMAIN"] ?? "").toLowerCase();
  return {
    storage,
    // ---- accounts ----
    accounts: {
      list: async () => {
        const { results } = await d1.prepare(
          "SELECT * FROM t_accounts WHERE tenant_host = ?1 ORDER BY created_at DESC"
        ).bind(tenant).all<Row>();
        return (results ?? []).map(mapAccountRow);
      },
      create: async (data) => {
        const id = crypto.randomUUID();
        const followers = JSON.stringify((data.followers ?? []) as unknown[]);
        const following = JSON.stringify((data.following ?? []) as unknown[]);
        await d1.prepare(
          "INSERT INTO t_accounts (id, tenant_host, user_name, display_name, avatar_initial, private_key, public_key, followers_json, following_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        ).bind(
          id,
          tenant,
          String(data.userName),
          String(data.displayName ?? data.userName),
          String(data.avatarInitial ?? "/api/image/people.png"),
          (data.privateKey ?? null),
          String(data.publicKey),
          followers,
          following,
          now(),
        ).run();
        return {
          _id: id,
          userName: String(data.userName),
          displayName: String(data.displayName ?? data.userName),
          avatarInitial: String(data.avatarInitial ?? "/api/image/people.png"),
          privateKey: data.privateKey,
          publicKey: String(data.publicKey),
          followers: (data.followers as string[]) ?? [],
          following: (data.following as string[]) ?? [],
        } as AccountDoc;
      },
      findById: async (id) => {
        const row = await d1.prepare("SELECT * FROM t_accounts WHERE tenant_host = ?1 AND id = ?2").bind(tenant, id).first<Row>();
        return row ? mapAccountRow(row) : null;
      },
      findByUserName: async (username) => {
        const row = await d1.prepare("SELECT * FROM t_accounts WHERE tenant_host = ?1 AND user_name = ?2").bind(tenant, username).first<Row>();
        return row ? mapAccountRow(row) : null;
      },
      updateById: async (id, update) => {
        const row = await d1.prepare("SELECT * FROM t_accounts WHERE tenant_host = ?1 AND id = ?2").bind(tenant, id).first<Row>();
        if (!row) return null;
        const merged = mapAccountRow(row);
        const next: AccountDoc = {
          ...merged,
          displayName: (update.displayName as string) ?? merged.displayName,
          avatarInitial: (update.avatarInitial as string) ?? merged.avatarInitial,
          privateKey: (update.privateKey as string | undefined) ?? merged.privateKey,
          publicKey: (update.publicKey as string) ?? merged.publicKey,
          followers: (update.followers as string[] | undefined) ?? merged.followers,
          following: (update.following as string[] | undefined) ?? merged.following,
        };
        await d1.prepare(
          "UPDATE t_accounts SET display_name=?2, avatar_initial=?3, private_key=?4, public_key=?5, followers_json=?6, following_json=?7 WHERE id=?1 AND tenant_host=?8"
        ).bind(
          id,
          next.displayName,
          next.avatarInitial,
          next.privateKey ?? null,
          next.publicKey,
          JSON.stringify(next.followers ?? []),
          JSON.stringify(next.following ?? []),
          tenant,
        ).run();
        return next;
      },
      deleteById: async (id) => {
        const r = await d1.prepare("DELETE FROM t_accounts WHERE tenant_host = ?1 AND id = ?2").bind(tenant, id).run();
        return !!r;
      },
      addFollower: async (id, follower) => {
        const row = await d1.prepare("SELECT followers_json FROM t_accounts WHERE tenant_host = ?1 AND id = ?2").bind(tenant, id).first<{ followers_json?: string }>();
        const list = json<string[]>(row?.followers_json) ?? [];
        if (!list.includes(follower)) list.push(follower);
        await d1.prepare("UPDATE t_accounts SET followers_json = ?3 WHERE tenant_host = ?1 AND id = ?2").bind(tenant, id, JSON.stringify(list)).run();
        return list;
      },
      removeFollower: async (id, follower) => {
        const row = await d1.prepare("SELECT followers_json FROM t_accounts WHERE tenant_host = ?1 AND id = ?2").bind(tenant, id).first<{ followers_json?: string }>();
        const list = (json<string[]>(row?.followers_json) ?? []).filter((x) => x !== follower);
        await d1.prepare("UPDATE t_accounts SET followers_json = ?3 WHERE tenant_host = ?1 AND id = ?2").bind(tenant, id, JSON.stringify(list)).run();
        return list;
      },
      addFollowing: async (id, target) => {
        const row = await d1.prepare("SELECT following_json FROM t_accounts WHERE tenant_host = ?1 AND id = ?2").bind(tenant, id).first<{ following_json?: string }>();
        const list = json<string[]>(row?.following_json) ?? [];
        if (!list.includes(target)) list.push(target);
        await d1.prepare("UPDATE t_accounts SET following_json = ?3 WHERE tenant_host = ?1 AND id = ?2").bind(tenant, id, JSON.stringify(list)).run();
        return list;
      },
      removeFollowing: async (id, target) => {
        const row = await d1.prepare("SELECT following_json FROM t_accounts WHERE tenant_host = ?1 AND id = ?2").bind(tenant, id).first<{ following_json?: string }>();
        const list = (json<string[]>(row?.following_json) ?? []).filter((x) => x !== target);
        await d1.prepare("UPDATE t_accounts SET following_json = ?3 WHERE tenant_host = ?1 AND id = ?2").bind(tenant, id, JSON.stringify(list)).run();
        return list;
      },
      addFollowerByName: async (username, follower) => {
        const row = await d1.prepare("SELECT id, followers_json FROM t_accounts WHERE tenant_host = ?1 AND user_name = ?2").bind(tenant, username).first<Row>();
        if (!row) return;
        const id = String(row.id);
        const list = json<string[]>(row.followers_json) ?? [];
        if (!list.includes(follower)) list.push(follower);
        await d1.prepare("UPDATE t_accounts SET followers_json = ?3 WHERE id = ?1 AND tenant_host = ?2").bind(id, tenant, JSON.stringify(list)).run();
      },
      removeFollowerByName: async (username, follower) => {
        const row = await d1.prepare("SELECT id, followers_json FROM t_accounts WHERE tenant_host = ?1 AND user_name = ?2").bind(tenant, username).first<Row>();
        if (!row) return;
        const id = String(row.id);
        const list = (json<string[]>(row.followers_json) ?? []).filter((x) => x !== follower);
        await d1.prepare("UPDATE t_accounts SET followers_json = ?3 WHERE id = ?1 AND tenant_host = ?2").bind(id, tenant, JSON.stringify(list)).run();
      },
      search: async (query, limit = 20) => {
        const like = `%${String(query).replace(/^\/(.*)\/$/, "$1")}%`;
        const { results } = await d1.prepare(
          "SELECT * FROM t_accounts WHERE tenant_host = ?1 AND (user_name LIKE ?2 OR display_name LIKE ?2) LIMIT ?3"
        ).bind(tenant, like, limit).all<Row>();
        return (results ?? []).map(mapAccountRow);
      },
      updateByUserName: async (username, update) => {
        const row = await d1.prepare("SELECT * FROM t_accounts WHERE tenant_host = ?1 AND user_name = ?2").bind(tenant, username).first<Row>();
        if (!row) return;
        const current = mapAccountRow(row);
        const next: AccountDoc = {
          ...current,
          displayName: (update.displayName as string) ?? current.displayName,
          avatarInitial: (update.avatarInitial as string) ?? current.avatarInitial,
          privateKey: (update.privateKey as string | undefined) ?? current.privateKey,
          publicKey: (update.publicKey as string) ?? current.publicKey,
          followers: (update.followers as string[] | undefined) ?? current.followers,
          following: (update.following as string[] | undefined) ?? current.following,
        };
        await d1.prepare(
          "UPDATE t_accounts SET display_name=?2, avatar_initial=?3, private_key=?4, public_key=?5, followers_json=?6, following_json=?7 WHERE id=?1 AND tenant_host=?8"
        ).bind(
          current._id,
          next.displayName,
          next.avatarInitial,
          next.privateKey ?? null,
          next.publicKey,
          JSON.stringify(next.followers ?? []),
          JSON.stringify(next.following ?? []),
          tenant,
        ).run();
      },
      findByUserNames: async (usernames) => {
        if (usernames.length === 0) return [] as AccountDoc[];
        const placeholders = usernames.map((_x, i) => `?${i + 2}`).join(",");
        const sql = `SELECT * FROM t_accounts WHERE tenant_host = ?1 AND user_name IN (${placeholders})`;
        const { results } = await d1.prepare(sql).bind(tenant, ...usernames).all<Row>();
        return (results ?? []).map(mapAccountRow);
      },
      count: async () => {
        const row = await d1.prepare("SELECT COUNT(1) as cnt FROM t_accounts WHERE tenant_host = ?1").bind(tenant).first<{ cnt: number }>();
        return Number(row?.cnt ?? 0);
      },
    },
    // ---- posts (未実装) ----
    posts: {
      findNoteById: async (id: string) => {
        const row = await d1.prepare(
          "SELECT * FROM t_posts WHERE tenant_host = ?1 AND id = ?2 AND type = 'Note'"
        ).bind(tenant, id).first<Row>();
        return row ? mapPostRow(row) : null;
      },
      findMessageById: async (id: string) => {
        const row = await d1.prepare(
          "SELECT * FROM t_posts WHERE tenant_host = ?1 AND id = ?2"
        ).bind(tenant, id).first<Row>();
        return row ? mapPostRow(row) : null;
      },
      findAttachmentById: async (id: string) => {
        const row = await d1.prepare(
          "SELECT * FROM t_posts WHERE tenant_host = ?1 AND id = ?2"
        ).bind(tenant, id).first<Row>();
        return row ? mapPostRow(row) : null;
      },
      saveObject: async (obj: Record<string, unknown>) => {
        const id = obj.id ? String(obj.id) : crypto.randomUUID();
        const createdAt = now();
        const extraJson = JSON.stringify(obj.extra ?? {});
        const toJson = JSON.stringify(obj.to ?? []);
        const ccJson = JSON.stringify(obj.cc ?? []);
        
        await d1.prepare(
          "INSERT OR REPLACE INTO t_posts (id, tenant_host, type, actor, content, extra_json, to_json, cc_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        ).bind(
          id,
          tenant,
          String(obj.type ?? "Object"),
          String(obj.actor ?? ""),
          obj.content ? String(obj.content) : null,
          extraJson,
          toJson,
          ccJson,
          createdAt,
          createdAt
        ).run();
        
        return { ...obj, _id: id, id };
      },
      listTimeline: async (actor: string, opts: { limit?: number; before?: Date }) => {
        const limit = opts.limit ?? 20;
        const beforeTime = opts.before ? opts.before.getTime() : Date.now();
        
        const { results } = await d1.prepare(
          "SELECT * FROM t_posts WHERE tenant_host = ?1 AND actor = ?2 AND created_at < ?3 ORDER BY created_at DESC LIMIT ?4"
        ).bind(tenant, actor, beforeTime, limit).all<Row>();
        
        return (results ?? []).map(mapPostRow);
      },
      follow: async (follower: string, target: string) => {
        // Follow関係は accounts テーブルで管理されるため、ここでは何もしない
      },
      unfollow: async (follower: string, target: string) => {
        // Unfollow関係は accounts テーブルで管理されるため、ここでは何もしない
      },
      saveNote: async (
        domain: string,
        author: string,
        content: string,
        extra: Record<string, unknown>,
        aud?: { to: string[]; cc: string[] }
      ) => {
        const id = extra.id ? String(extra.id) : crypto.randomUUID();
        const createdAt = now();
        const extraJson = JSON.stringify(extra);
        const toJson = JSON.stringify(aud?.to ?? []);
        const ccJson = JSON.stringify(aud?.cc ?? []);
        
        await d1.prepare(
          "INSERT OR REPLACE INTO t_posts (id, tenant_host, type, actor, content, extra_json, to_json, cc_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        ).bind(
          id,
          tenant,
          "Note",
          author,
          content,
          extraJson,
          toJson,
          ccJson,
          createdAt,
          createdAt
        ).run();
        
        return mapPostRow({
          id,
          tenant_host: tenant,
          type: "Note",
          actor: author,
          content,
          extra_json: extraJson,
          to_json: toJson,
          cc_json: ccJson,
          created_at: createdAt,
          updated_at: createdAt,
        });
      },
      updateNote: async (id: string, update: Record<string, unknown>) => {
        const existing = await d1.prepare(
          "SELECT * FROM t_posts WHERE tenant_host = ?1 AND id = ?2"
        ).bind(tenant, id).first<Row>();
        
        if (!existing) return null;
        
        const updatedAt = now();
        const content = update.content ? String(update.content) : existing.content;
        const extraJson = update.extra ? JSON.stringify(update.extra) : existing.extra_json;
        
        await d1.prepare(
          "UPDATE t_posts SET content = ?1, extra_json = ?2, updated_at = ?3 WHERE tenant_host = ?4 AND id = ?5"
        ).bind(content, extraJson, updatedAt, tenant, id).run();
        
        return mapPostRow({
          ...existing,
          content,
          extra_json: extraJson,
          updated_at: updatedAt,
        });
      },
      deleteNote: async (id: string) => {
        const result = await d1.prepare(
          "DELETE FROM t_posts WHERE tenant_host = ?1 AND id = ?2 AND type = 'Note'"
        ).bind(tenant, id).run();
        
        return (result as { changes?: number })?.changes === 1;
      },
      findNotes: async (filter: Record<string, unknown>, sort?: { [key: string]: 1 | -1 | "asc" | "desc" }) => {
        // 基本的なフィルタリングを実装（簡略化）
        let query = "SELECT * FROM t_posts WHERE tenant_host = ?1 AND type = 'Note'";
        const params = [tenant];
        
        if (filter["extra.inReplyTo"]) {
          query += " AND extra_json LIKE ?2";
          params.push(`%"inReplyTo":"${filter["extra.inReplyTo"]}"%`);
        }
        
        if (sort) {
          const sortKey = Object.keys(sort)[0];
          const sortOrder = sort[sortKey] === -1 || sort[sortKey] === "desc" ? "DESC" : "ASC";
          if (sortKey === "created_at") {
            query += ` ORDER BY created_at ${sortOrder}`;
          }
        }
        
        const { results } = await d1.prepare(query).bind(...params).all<Row>();
        return (results ?? []).map(mapPostRow);
      },
      getPublicNotes: async (limit: number, before?: Date) => {
        const beforeTime = before ? before.getTime() : Date.now();
        
        const { results } = await d1.prepare(
          "SELECT * FROM t_posts WHERE tenant_host = ?1 AND type = 'Note' AND created_at < ?2 ORDER BY created_at DESC LIMIT ?3"
        ).bind(tenant, beforeTime, limit).all<Row>();
        
        return (results ?? []).map(mapPostRow);
      },
      saveMessage: async (
        domain: string,
        author: string,
        content: string,
        extra: Record<string, unknown>,
        aud: { to: string[]; cc: string[] }
      ) => {
        const id = extra.id ? String(extra.id) : crypto.randomUUID();
        const createdAt = now();
        const extraJson = JSON.stringify(extra);
        const toJson = JSON.stringify(aud.to);
        const ccJson = JSON.stringify(aud.cc);
        
        await d1.prepare(
          "INSERT OR REPLACE INTO t_posts (id, tenant_host, type, actor, content, extra_json, to_json, cc_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        ).bind(
          id,
          tenant,
          "Create",
          author,
          content,
          extraJson,
          toJson,
          ccJson,
          createdAt,
          createdAt
        ).run();
        
        return mapPostRow({
          id,
          tenant_host: tenant,
          type: "Create",
          actor: author,
          content,
          extra_json: extraJson,
          to_json: toJson,
          cc_json: ccJson,
          created_at: createdAt,
          updated_at: createdAt,
        });
      },
      updateMessage: async (id: string, update: Record<string, unknown>) => {
        return await d1.prepare("SELECT 1").first(); // 簡略実装
      },
      deleteMessage: async (id: string) => {
        const result = await d1.prepare(
          "DELETE FROM t_posts WHERE tenant_host = ?1 AND id = ?2"
        ).bind(tenant, id).run();
        
        return (result as { changes?: number })?.changes === 1;
      },
      findMessages: async (filter: Record<string, unknown>) => {
        const { results } = await d1.prepare(
          "SELECT * FROM t_posts WHERE tenant_host = ?1"
        ).bind(tenant).all<Row>();
        
        return (results ?? []).map(mapPostRow);
      },
      updateObject: async (id: string, update: Record<string, unknown>) => {
        const existing = await d1.prepare(
          "SELECT * FROM t_posts WHERE tenant_host = ?1 AND id = ?2"
        ).bind(tenant, id).first<Row>();
        
        if (!existing) return null;
        
        const updatedAt = now();
        const extraJson = update.extra ? JSON.stringify(update.extra) : existing.extra_json;
        
        await d1.prepare(
          "UPDATE t_posts SET extra_json = ?1, updated_at = ?2 WHERE tenant_host = ?3 AND id = ?4"
        ).bind(extraJson, updatedAt, tenant, id).run();
        
        return mapPostRow({
          ...existing,
          extra_json: extraJson,
          updated_at: updatedAt,
        });
      },
      deleteObject: async (id: string) => {
        const result = await d1.prepare(
          "DELETE FROM t_posts WHERE tenant_host = ?1 AND id = ?2"
        ).bind(tenant, id).run();
        
        return (result as { changes?: number })?.changes === 1;
      },
      deleteManyObjects: async (filter: Record<string, unknown>) => {
        // 簡略実装 - 実際の使用に応じて拡張
        const result = await d1.prepare(
          "DELETE FROM t_posts WHERE tenant_host = ?1"
        ).bind(tenant).run();
        
        return { deletedCount: (result as { changes?: number })?.changes ?? 0 };
      },
    },
    dms: {
      save: async (
        from: string,
        to: string,
        type: string,
        content?: string,
        attachments?: Record<string, unknown>[],
        url?: string,
        mediaType?: string,
        key?: string,
        iv?: string,
        preview?: Record<string, unknown>,
      ) => {
        const id = crypto.randomUUID();
        const createdAt = now();
        const attachmentsJson = attachments ? JSON.stringify(attachments) : null;
        const previewJson = preview ? JSON.stringify(preview) : null;
        
        await d1.prepare(
          "INSERT INTO t_dms (id, tenant_host, from_user, to_user, type, content, attachments_json, url, media_type, encryption_key, encryption_iv, preview_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)"
        ).bind(
          id,
          tenant,
          from,
          to,
          type,
          content,
          attachmentsJson,
          url,
          mediaType,
          key,
          iv,
          previewJson,
          createdAt
        ).run();
        
        return {
          _id: id,
          from,
          to,
          type,
          content,
          attachments,
          url,
          mediaType,
          key,
          iv,
          preview,
          createdAt: new Date(createdAt),
        };
      },
      listBetween: async (user1: string, user2: string) => {
        const { results } = await d1.prepare(
          "SELECT * FROM t_dms WHERE tenant_host = ?1 AND ((from_user = ?2 AND to_user = ?3) OR (from_user = ?3 AND to_user = ?2)) ORDER BY created_at ASC"
        ).bind(tenant, user1, user2).all<Row>();
        
        return (results ?? []).map(row => ({
          _id: String(row.id),
          from: String(row.from_user),
          to: String(row.to_user),
          type: String(row.type),
          content: row.content ? String(row.content) : undefined,
          attachments: json<Record<string, unknown>[]>(row.attachments_json),
          url: row.url ? String(row.url) : undefined,
          mediaType: row.media_type ? String(row.media_type) : undefined,
          key: row.encryption_key ? String(row.encryption_key) : undefined,
          iv: row.encryption_iv ? String(row.encryption_iv) : undefined,
          preview: json<Record<string, unknown>>(row.preview_json),
          createdAt: new Date(Number(row.created_at)),
        }));
      },
      list: async (owner: string) => {
        const { results } = await d1.prepare(
          "SELECT * FROM t_dm_conversations WHERE tenant_host = ?1 AND owner = ?2 ORDER BY created_at DESC"
        ).bind(tenant, owner).all<Row>();
        return (results ?? []).map(mapDMConversationRow);
      },
      create: async (data: DirectMessageDoc) => {
        const id = crypto.randomUUID();
        const createdAt = now();
        await d1.prepare(
          "INSERT OR REPLACE INTO t_dm_conversations (id, tenant_host, owner, participant_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
        ).bind(
          id,
          tenant,
          data.owner,
          data.id,
          createdAt
        ).run();
        
        return {
          _id: id,
          owner: data.owner,
          id: data.id,
        };
      },
      update: async (owner: string, id: string, update: Record<string, unknown>) => {
        // DM conversations don't typically need updates, but implement for completeness
        const existing = await d1.prepare(
          "SELECT * FROM t_dm_conversations WHERE tenant_host = ?1 AND owner = ?2 AND participant_id = ?3"
        ).bind(tenant, owner, id).first<Row>();
        
        if (!existing) return null;
        
        return mapDMConversationRow(existing);
      },
      delete: async (owner: string, id: string) => {
        const result = await d1.prepare(
          "DELETE FROM t_dm_conversations WHERE tenant_host = ?1 AND owner = ?2 AND participant_id = ?3"
        ).bind(tenant, owner, id).run();
        
        return (result as { changes?: number })?.changes === 1;
      },
    },
    groups: {
      list: async (member: string) => {
        const { results } = await d1.prepare(
          "SELECT * FROM t_groups WHERE tenant_host = ?1 AND followers_json LIKE ?2 ORDER BY created_at DESC"
        ).bind(tenant, `%"${member}"%`).all<Row>();
        return (results ?? []).map(mapListedGroupRow);
      },
      findByName: async (name: string) => {
        const row = await d1.prepare(
          "SELECT * FROM t_groups WHERE tenant_host = ?1 AND group_name = ?2"
        ).bind(tenant, name).first<Row>();
        return row ? mapGroupRow(row) : null;
      },
      create: async (data: Record<string, unknown>) => {
        const id = crypto.randomUUID();
        const createdAt = now();
        const followersJson = JSON.stringify(data.followers ?? []);
        const outboxJson = JSON.stringify(data.outbox ?? []);
        const iconJson = data.icon ? JSON.stringify(data.icon) : null;
        const imageJson = data.image ? JSON.stringify(data.image) : null;
        
        await d1.prepare(
          "INSERT INTO t_groups (id, tenant_host, group_name, display_name, summary, icon_json, image_json, membership_policy, invite_policy, visibility, allow_invites, followers_json, outbox_json, private_key, public_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)"
        ).bind(
          id,
          tenant,
          String(data.groupName),
          String(data.displayName),
          data.summary ? String(data.summary) : null,
          iconJson,
          imageJson,
          data.membershipPolicy ? String(data.membershipPolicy) : "open",
          data.invitePolicy ? String(data.invitePolicy) : "members",
          data.visibility ? String(data.visibility) : "public",
          data.allowInvites ? 1 : 0,
          followersJson,
          outboxJson,
          data.privateKey ? String(data.privateKey) : null,
          String(data.publicKey),
          createdAt,
          createdAt
        ).run();
        
        return mapGroupRow({
          id,
          tenant_host: tenant,
          group_name: String(data.groupName),
          display_name: String(data.displayName),
          summary: data.summary ? String(data.summary) : null,
          icon_json: iconJson,
          image_json: imageJson,
          membership_policy: data.membershipPolicy ? String(data.membershipPolicy) : "open",
          invite_policy: data.invitePolicy ? String(data.invitePolicy) : "members",
          visibility: data.visibility ? String(data.visibility) : "public",
          allow_invites: data.allowInvites ? 1 : 0,
          followers_json: followersJson,
          outbox_json: outboxJson,
          private_key: data.privateKey ? String(data.privateKey) : null,
          public_key: String(data.publicKey),
          created_at: createdAt,
          updated_at: createdAt,
        });
      },
      updateByName: async (name: string, update: Record<string, unknown>) => {
        const existing = await d1.prepare(
          "SELECT * FROM t_groups WHERE tenant_host = ?1 AND group_name = ?2"
        ).bind(tenant, name).first<Row>();
        
        if (!existing) return null;
        
        const updatedAt = now();
        const displayName = update.displayName ? String(update.displayName) : existing.display_name;
        const summary = update.summary !== undefined ? (update.summary ? String(update.summary) : null) : existing.summary;
        const iconJson = update.icon ? JSON.stringify(update.icon) : existing.icon_json;
        const imageJson = update.image ? JSON.stringify(update.image) : existing.image_json;
        const followersJson = update.followers ? JSON.stringify(update.followers) : existing.followers_json;
        const outboxJson = update.outbox ? JSON.stringify(update.outbox) : existing.outbox_json;
        
        await d1.prepare(
          "UPDATE t_groups SET display_name = ?1, summary = ?2, icon_json = ?3, image_json = ?4, followers_json = ?5, outbox_json = ?6, updated_at = ?7 WHERE tenant_host = ?8 AND group_name = ?9"
        ).bind(displayName, summary, iconJson, imageJson, followersJson, outboxJson, updatedAt, tenant, name).run();
        
        return mapGroupRow({
          ...existing,
          display_name: displayName,
          summary,
          icon_json: iconJson,
          image_json: imageJson,
          followers_json: followersJson,
          outbox_json: outboxJson,
          updated_at: updatedAt,
        });
      },
      addFollower: async (name: string, actor: string) => {
        const existing = await d1.prepare(
          "SELECT followers_json FROM t_groups WHERE tenant_host = ?1 AND group_name = ?2"
        ).bind(tenant, name).first<Row>();
        
        if (!existing) return [];
        
        const followers = json<string[]>(existing.followers_json) ?? [];
        if (!followers.includes(actor)) {
          followers.push(actor);
        }
        
        const followersJson = JSON.stringify(followers);
        await d1.prepare(
          "UPDATE t_groups SET followers_json = ?1, updated_at = ?2 WHERE tenant_host = ?3 AND group_name = ?4"
        ).bind(followersJson, now(), tenant, name).run();
        
        return followers;
      },
      removeFollower: async (name: string, actor: string) => {
        const existing = await d1.prepare(
          "SELECT followers_json FROM t_groups WHERE tenant_host = ?1 AND group_name = ?2"
        ).bind(tenant, name).first<Row>();
        
        if (!existing) return [];
        
        const followers = json<string[]>(existing.followers_json) ?? [];
        const index = followers.indexOf(actor);
        if (index > -1) {
          followers.splice(index, 1);
        }
        
        const followersJson = JSON.stringify(followers);
        await d1.prepare(
          "UPDATE t_groups SET followers_json = ?1, updated_at = ?2 WHERE tenant_host = ?3 AND group_name = ?4"
        ).bind(followersJson, now(), tenant, name).run();
        
        return followers;
      },
      pushOutbox: async (name: string, activity: Record<string, unknown>) => {
        const existing = await d1.prepare(
          "SELECT outbox_json FROM t_groups WHERE tenant_host = ?1 AND group_name = ?2"
        ).bind(tenant, name).first<Row>();
        
        if (!existing) return;
        
        const outbox = json<Record<string, unknown>[]>(existing.outbox_json) ?? [];
        outbox.push(activity);
        
        // 最新100件のみ保持
        if (outbox.length > 100) {
          outbox.splice(0, outbox.length - 100);
        }
        
        const outboxJson = JSON.stringify(outbox);
        await d1.prepare(
          "UPDATE t_groups SET outbox_json = ?1, updated_at = ?2 WHERE tenant_host = ?3 AND group_name = ?4"
        ).bind(outboxJson, now(), tenant, name).run();
      },
    },
    invites: {
      findOne: async (filter: Record<string, unknown>) => {
        let query = "SELECT * FROM t_invites WHERE tenant_host = ?1";
        const params = [tenant];
        
        if (filter.invitee) {
          query += " AND invitee = ?2";
          params.push(String(filter.invitee));
        }
        if (filter.inviter) {
          query += " AND inviter = ?3";
          params.push(String(filter.inviter));
        }
        if (filter.status) {
          query += " AND status = ?4";
          params.push(String(filter.status));
        }
        
        const row = await d1.prepare(query).bind(...params).first<Row>();
        return row ? mapInviteRow(row) : null;
      },
      findOneAndUpdate: async (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options?: { upsert?: boolean }
      ) => {
        const existing = await d1.prepare(
          "SELECT * FROM t_invites WHERE tenant_host = ?1 AND invitee = ?2"
        ).bind(tenant, String(filter.invitee)).first<Row>();
        
        if (!existing && options?.upsert) {
          const id = crypto.randomUUID();
          const createdAt = now();
          const extraJson = update.extra ? JSON.stringify(update.extra) : null;
          
          await d1.prepare(
            "INSERT INTO t_invites (id, tenant_host, inviter, invitee, group_name, status, extra_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
          ).bind(
            id,
            tenant,
            String(update.inviter ?? ""),
            String(filter.invitee),
            update.groupName ? String(update.groupName) : null,
            String(update.status ?? "pending"),
            extraJson,
            createdAt,
            createdAt
          ).run();
          
          return mapInviteRow({
            id,
            tenant_host: tenant,
            inviter: String(update.inviter ?? ""),
            invitee: String(filter.invitee),
            group_name: update.groupName ? String(update.groupName) : null,
            status: String(update.status ?? "pending"),
            extra_json: extraJson,
            created_at: createdAt,
            updated_at: createdAt,
          });
        }
        
        if (!existing) return null;
        
        const updatedAt = now();
        const status = update.status ? String(update.status) : existing.status;
        const extraJson = update.extra ? JSON.stringify(update.extra) : existing.extra_json;
        
        await d1.prepare(
          "UPDATE t_invites SET status = ?1, extra_json = ?2, updated_at = ?3 WHERE tenant_host = ?4 AND id = ?5"
        ).bind(status, extraJson, updatedAt, tenant, existing.id).run();
        
        return mapInviteRow({
          ...existing,
          status,
          extra_json: extraJson,
          updated_at: updatedAt,
        });
      },
      save: async (data: Record<string, unknown>) => {
        const id = crypto.randomUUID();
        const createdAt = now();
        const extraJson = data.extra ? JSON.stringify(data.extra) : null;
        
        await d1.prepare(
          "INSERT INTO t_invites (id, tenant_host, inviter, invitee, group_name, status, extra_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
        ).bind(
          id,
          tenant,
          String(data.inviter),
          String(data.invitee),
          data.groupName ? String(data.groupName) : null,
          String(data.status ?? "pending"),
          extraJson,
          createdAt,
          createdAt
        ).run();
        
        return mapInviteRow({
          id,
          tenant_host: tenant,
          inviter: String(data.inviter),
          invitee: String(data.invitee),
          group_name: data.groupName ? String(data.groupName) : null,
          status: String(data.status ?? "pending"),
          extra_json: extraJson,
          created_at: createdAt,
          updated_at: createdAt,
        });
      },
      deleteOne: async (filter: Record<string, unknown>) => {
        await d1.prepare(
          "DELETE FROM t_invites WHERE tenant_host = ?1 AND invitee = ?2"
        ).bind(tenant, String(filter.invitee)).run();
      },
    },
    approvals: {
      findOne: async (filter: Record<string, unknown>) => {
        let query = "SELECT * FROM t_approvals WHERE tenant_host = ?1";
        const params = [tenant];
        
        if (filter.target) {
          query += " AND target = ?2";
          params.push(String(filter.target));
        }
        if (filter.requester) {
          query += " AND requester = ?3";
          params.push(String(filter.requester));
        }
        if (filter.type) {
          query += " AND type = ?4";
          params.push(String(filter.type));
        }
        
        const row = await d1.prepare(query).bind(...params).first<Row>();
        return row ? mapApprovalRow(row) : null;
      },
      findOneAndUpdate: async (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options?: { upsert?: boolean }
      ) => {
        const existing = await d1.prepare(
          "SELECT * FROM t_approvals WHERE tenant_host = ?1 AND target = ?2 AND type = ?3"
        ).bind(tenant, String(filter.target), String(filter.type)).first<Row>();
        
        if (!existing && options?.upsert) {
          const id = crypto.randomUUID();
          const createdAt = now();
          const extraJson = update.extra ? JSON.stringify(update.extra) : null;
          
          await d1.prepare(
            "INSERT INTO t_approvals (id, tenant_host, requester, target, type, status, extra_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
          ).bind(
            id,
            tenant,
            String(update.requester ?? ""),
            String(filter.target),
            String(filter.type),
            String(update.status ?? "pending"),
            extraJson,
            createdAt,
            createdAt
          ).run();
          
          return mapApprovalRow({
            id,
            tenant_host: tenant,
            requester: String(update.requester ?? ""),
            target: String(filter.target),
            type: String(filter.type),
            status: String(update.status ?? "pending"),
            extra_json: extraJson,
            created_at: createdAt,
            updated_at: createdAt,
          });
        }
        
        if (!existing) return null;
        
        const updatedAt = now();
        const status = update.status ? String(update.status) : existing.status;
        const extraJson = update.extra ? JSON.stringify(update.extra) : existing.extra_json;
        
        await d1.prepare(
          "UPDATE t_approvals SET status = ?1, extra_json = ?2, updated_at = ?3 WHERE tenant_host = ?4 AND id = ?5"
        ).bind(status, extraJson, updatedAt, tenant, existing.id).run();
        
        return mapApprovalRow({
          ...existing,
          status,
          extra_json: extraJson,
          updated_at: updatedAt,
        });
      },
      deleteOne: async (filter: Record<string, unknown>) => {
        await d1.prepare(
          "DELETE FROM t_approvals WHERE tenant_host = ?1 AND target = ?2"
        ).bind(tenant, String(filter.target)).run();
      },
    },
    notifications: {
      list: async (owner: string) => {
        const { results } = await d1.prepare(
          "SELECT * FROM t_notifications WHERE tenant_host = ?1 AND owner = ?2 ORDER BY created_at DESC"
        ).bind(tenant, owner).all<Row>();
        return (results ?? []).map(mapNotificationRow);
      },
      create: async (owner: string, title: string, message: string, type: string) => {
        const id = crypto.randomUUID();
        const createdAt = now();
        
        await d1.prepare(
          "INSERT INTO t_notifications (id, tenant_host, owner, title, message, type, read_status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
        ).bind(
          id,
          tenant,
          owner,
          title,
          message,
          type,
          0, // unread
          createdAt
        ).run();
        
        return {
          _id: id,
          owner,
          title,
          message,
          type,
          read: false,
          createdAt: new Date(createdAt),
        };
      },
      markRead: async (id: string) => {
        const result = await d1.prepare(
          "UPDATE t_notifications SET read_status = 1 WHERE tenant_host = ?1 AND id = ?2"
        ).bind(tenant, id).run();
        
        return (result as { changes?: number })?.changes === 1;
      },
      delete: async (id: string) => {
        const result = await d1.prepare(
          "DELETE FROM t_notifications WHERE tenant_host = ?1 AND id = ?2"
        ).bind(tenant, id).run();
        
        return (result as { changes?: number })?.changes === 1;
      },
    },
    system: {
      findKey: async (domain: string) => {
        const row = await d1.prepare(
          "SELECT * FROM t_system_keys WHERE tenant_host = ?1 AND domain = ?2"
        ).bind(tenant, domain).first<Row>();
        
        if (!row) return null;
        
        return {
          domain: String(row.domain),
          privateKey: String(row.private_key),
          publicKey: String(row.public_key),
        };
      },
      saveKey: async (domain: string, privateKey: string, publicKey: string) => {
        const id = crypto.randomUUID();
        const createdAt = now();
        
        await d1.prepare(
          "INSERT OR REPLACE INTO t_system_keys (id, tenant_host, domain, private_key, public_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
        ).bind(
          id,
          tenant,
          domain,
          privateKey,
          publicKey,
          createdAt
        ).run();
      },
      findRemoteActorByUrl: async (url: string) => {
        const row = await d1.prepare(
          "SELECT * FROM t_remote_actors WHERE tenant_host = ?1 AND actor_url = ?2"
        ).bind(tenant, url).first<Row>();
        
        return row ? mapRemoteActorRow(row) : null;
      },
      findRemoteActorsByUrls: async (urls: string[]) => {
        if (urls.length === 0) return [];
        
        const placeholders = urls.map(() => "?").join(",");
        const { results } = await d1.prepare(
          `SELECT * FROM t_remote_actors WHERE tenant_host = ?1 AND actor_url IN (${placeholders})`
        ).bind(tenant, ...urls).all<Row>();
        
        return (results ?? []).map(mapRemoteActorRow);
      },
      upsertRemoteActor: async (data: {
        actorUrl: string;
        name: string;
        preferredUsername: string;
        icon: unknown;
        summary: string;
      }) => {
        const id = crypto.randomUUID();
        const createdAt = now();
        const iconJson = JSON.stringify(data.icon);
        
        await d1.prepare(
          "INSERT OR REPLACE INTO t_remote_actors (id, tenant_host, actor_url, name, preferred_username, icon_json, summary, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
        ).bind(
          id,
          tenant,
          data.actorUrl,
          data.name,
          data.preferredUsername,
          iconJson,
          data.summary,
          createdAt,
          createdAt
        ).run();
      },
    },
    sessions: {
      create: async (sessionId: string, expiresAt: Date, deviceId: string) => {
        await d1.prepare(
          "INSERT INTO t_sessions (session_id, tenant_host, device_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
        ).bind(sessionId, tenant, deviceId, expiresAt.getTime(), now()).run();
        return { sessionId, deviceId, expiresAt } as SessionDoc;
      },
      findById: async (sessionId: string) => {
        const row = await d1.prepare(
          "SELECT session_id, device_id, expires_at, created_at FROM t_sessions WHERE tenant_host = ?1 AND session_id = ?2"
        ).bind(tenant, sessionId).first<{ session_id: string; device_id: string; expires_at: number; created_at: number }>();
        return row ? { sessionId: row.session_id, deviceId: row.device_id, expiresAt: new Date(Number(row.expires_at)), createdAt: new Date(Number(row.created_at)) } as SessionDoc : null;
      },
      deleteById: async (sessionId: string) => {
        await d1.prepare("DELETE FROM t_sessions WHERE tenant_host = ?1 AND session_id = ?2").bind(tenant, sessionId).run();
      },
      updateExpires: async (sessionId: string, expires: Date) => {
        await d1.prepare("UPDATE t_sessions SET expires_at = ?3 WHERE tenant_host = ?1 AND session_id = ?2").bind(tenant, sessionId, expires.getTime()).run();
      },
      updateActivity: async (_sessionId: string, _date?: Date) => { /* noop */ },
    },
    fcm: {
      register: async () => {},
      unregister: async () => {},
      list: async () => [],
    },
    faspProviders: {
      getSettings: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      findOne: () => Promise.resolve(null),
      upsertByBaseUrl: () => Promise.resolve(),
      updateByBaseUrl: () => Promise.resolve(),
      deleteOne: () => Promise.resolve({ deletedCount: 0 }),
      registrationUpsert: () => Promise.resolve(),
      listProviders: () => Promise.resolve([]),
      insertEventSubscription: () => Promise.resolve(),
      deleteEventSubscription: () => Promise.resolve(),
      createBackfill: () => Promise.resolve(),
      continueBackfill: () => Promise.resolve(),
    },
  };
}
