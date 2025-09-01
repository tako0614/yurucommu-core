import type { DataStore, SortSpec } from "../../core/db/types.ts";
import type { AccountDoc, SessionDoc } from "@takos/types";
import { createObjectStorage } from "../../takos/storage/providers.ts";

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
function notImpl(name: string): never { throw new Error(`D1 tenant store does not implement: ${name}`); }

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

export function createD1TenantDataStore(env: Record<string, string>, d1: D1Database): DataStore {
  const storage = createObjectStorage(env);
  return {
    storage,
    // ---- accounts ----
    accounts: {
      list: async () => {
        const { results } = await d1.prepare(
          "SELECT * FROM t_accounts ORDER BY created_at DESC"
        ).all<Row>();
        return (results ?? []).map(mapAccountRow);
      },
      create: async (data) => {
        const id = crypto.randomUUID();
        const followers = JSON.stringify((data.followers ?? []) as unknown[]);
        const following = JSON.stringify((data.following ?? []) as unknown[]);
        await d1.prepare(
          "INSERT INTO t_accounts (id, user_name, display_name, avatar_initial, private_key, public_key, followers_json, following_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
        ).bind(
          id,
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
        const row = await d1.prepare("SELECT * FROM t_accounts WHERE id = ?1").bind(id).first<Row>();
        return row ? mapAccountRow(row) : null;
      },
      findByUserName: async (username) => {
        const row = await d1.prepare("SELECT * FROM t_accounts WHERE user_name = ?1").bind(username).first<Row>();
        return row ? mapAccountRow(row) : null;
      },
      updateById: async (id, update) => {
        const row = await d1.prepare("SELECT * FROM t_accounts WHERE id = ?1").bind(id).first<Row>();
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
          "UPDATE t_accounts SET display_name=?2, avatar_initial=?3, private_key=?4, public_key=?5, followers_json=?6, following_json=?7 WHERE id=?1"
        ).bind(
          id,
          next.displayName,
          next.avatarInitial,
          next.privateKey ?? null,
          next.publicKey,
          JSON.stringify(next.followers ?? []),
          JSON.stringify(next.following ?? []),
        ).run();
        return next;
      },
      deleteById: async (id) => {
        const r = await d1.prepare("DELETE FROM t_accounts WHERE id = ?1").bind(id).run();
        return !!r;
      },
      addFollower: async (id, follower) => {
        const row = await d1.prepare("SELECT followers_json FROM t_accounts WHERE id = ?1").bind(id).first<{ followers_json?: string }>();
        const list = json<string[]>(row?.followers_json) ?? [];
        if (!list.includes(follower)) list.push(follower);
        await d1.prepare("UPDATE t_accounts SET followers_json = ?2 WHERE id = ?1").bind(id, JSON.stringify(list)).run();
        return list;
      },
      removeFollower: async (id, follower) => {
        const row = await d1.prepare("SELECT followers_json FROM t_accounts WHERE id = ?1").bind(id).first<{ followers_json?: string }>();
        const list = (json<string[]>(row?.followers_json) ?? []).filter((x) => x !== follower);
        await d1.prepare("UPDATE t_accounts SET followers_json = ?2 WHERE id = ?1").bind(id, JSON.stringify(list)).run();
        return list;
      },
      addFollowing: async (id, target) => {
        const row = await d1.prepare("SELECT following_json FROM t_accounts WHERE id = ?1").bind(id).first<{ following_json?: string }>();
        const list = json<string[]>(row?.following_json) ?? [];
        if (!list.includes(target)) list.push(target);
        await d1.prepare("UPDATE t_accounts SET following_json = ?2 WHERE id = ?1").bind(id, JSON.stringify(list)).run();
        return list;
      },
      removeFollowing: async (id, target) => {
        const row = await d1.prepare("SELECT following_json FROM t_accounts WHERE id = ?1").bind(id).first<{ following_json?: string }>();
        const list = (json<string[]>(row?.following_json) ?? []).filter((x) => x !== target);
        await d1.prepare("UPDATE t_accounts SET following_json = ?2 WHERE id = ?1").bind(id, JSON.stringify(list)).run();
        return list;
      },
      addFollowerByName: async (username, follower) => {
        const row = await d1.prepare("SELECT id, followers_json FROM t_accounts WHERE user_name = ?1").bind(username).first<Row>();
        if (!row) return;
        const id = String(row.id);
        const list = json<string[]>(row.followers_json) ?? [];
        if (!list.includes(follower)) list.push(follower);
        await d1.prepare("UPDATE t_accounts SET followers_json = ?2 WHERE id = ?1").bind(id, JSON.stringify(list)).run();
      },
      removeFollowerByName: async (username, follower) => {
        const row = await d1.prepare("SELECT id, followers_json FROM t_accounts WHERE user_name = ?1").bind(username).first<Row>();
        if (!row) return;
        const id = String(row.id);
        const list = (json<string[]>(row.followers_json) ?? []).filter((x) => x !== follower);
        await d1.prepare("UPDATE t_accounts SET followers_json = ?2 WHERE id = ?1").bind(id, JSON.stringify(list)).run();
      },
      search: async (query, limit = 20) => {
        const like = `%${String(query).replace(/^\/(.*)\/$/, "$1")}%`;
        const { results } = await d1.prepare(
          "SELECT * FROM t_accounts WHERE user_name LIKE ?1 OR display_name LIKE ?1 LIMIT ?2"
        ).bind(like, limit).all<Row>();
        return (results ?? []).map(mapAccountRow);
      },
      updateByUserName: async (username, update) => {
        const row = await d1.prepare("SELECT * FROM t_accounts WHERE user_name = ?1").bind(username).first<Row>();
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
          "UPDATE t_accounts SET display_name=?2, avatar_initial=?3, private_key=?4, public_key=?5, followers_json=?6, following_json=?7 WHERE id=?1"
        ).bind(
          current._id,
          next.displayName,
          next.avatarInitial,
          next.privateKey ?? null,
          next.publicKey,
          JSON.stringify(next.followers ?? []),
          JSON.stringify(next.following ?? []),
        ).run();
      },
      findByUserNames: async (usernames) => {
        if (usernames.length === 0) return [] as AccountDoc[];
        const placeholders = usernames.map((_x, i) => `?${i + 1}`).join(",");
        const sql = `SELECT * FROM t_accounts WHERE user_name IN (${placeholders})`;
        const { results } = await d1.prepare(sql).bind(...usernames).all<Row>();
        return (results ?? []).map(mapAccountRow);
      },
      count: async () => {
        const row = await d1.prepare("SELECT COUNT(1) as cnt FROM t_accounts").first<{ cnt: number }>();
        return Number(row?.cnt ?? 0);
      },
    },
    // ---- posts (未実装) ----
    posts: {
      findNoteById: () => notImpl("posts.findNoteById"),
      findMessageById: () => notImpl("posts.findMessageById"),
      findAttachmentById: () => notImpl("posts.findAttachmentById"),
      saveObject: () => notImpl("posts.saveObject"),
      listTimeline: () => notImpl("posts.listTimeline"),
      follow: async () => {},
      unfollow: async () => {},
      saveNote: () => notImpl("posts.saveNote"),
      updateNote: () => notImpl("posts.updateNote"),
      deleteNote: () => notImpl("posts.deleteNote"),
      findNotes: () => notImpl("posts.findNotes"),
      getPublicNotes: () => notImpl("posts.getPublicNotes"),
      saveMessage: () => notImpl("posts.saveMessage"),
      updateMessage: () => notImpl("posts.updateMessage"),
      deleteMessage: () => notImpl("posts.deleteMessage"),
      findMessages: () => notImpl("posts.findMessages"),
      updateObject: () => notImpl("posts.updateObject"),
      deleteObject: () => notImpl("posts.deleteObject"),
      deleteManyObjects: () => notImpl("posts.deleteManyObjects"),
    },
    dms: {
      save: () => notImpl("dms.save"),
      listBetween: () => notImpl("dms.listBetween"),
      list: () => notImpl("dms.list"),
      create: () => notImpl("dms.create"),
      update: () => notImpl("dms.update"),
      delete: () => notImpl("dms.delete"),
    },
    groups: {
      list: () => notImpl("groups.list"),
      findByName: () => notImpl("groups.findByName"),
      create: () => notImpl("groups.create"),
      updateByName: () => notImpl("groups.updateByName"),
      addFollower: () => notImpl("groups.addFollower"),
      removeFollower: () => notImpl("groups.removeFollower"),
      pushOutbox: () => notImpl("groups.pushOutbox"),
    },
    invites: {
      findOne: () => notImpl("invites.findOne"),
      findOneAndUpdate: () => notImpl("invites.findOneAndUpdate"),
      save: () => notImpl("invites.save"),
      deleteOne: async () => {},
    },
    approvals: {
      findOne: () => notImpl("approvals.findOne"),
      findOneAndUpdate: () => notImpl("approvals.findOneAndUpdate"),
      deleteOne: async () => {},
    },
    notifications: {
      list: () => notImpl("notifications.list"),
      create: () => notImpl("notifications.create"),
      markRead: () => notImpl("notifications.markRead"),
      delete: () => notImpl("notifications.delete"),
    },
    system: {
      findKey: () => notImpl("system.findKey"),
      saveKey: async () => {},
      findRemoteActorByUrl: () => notImpl("system.findRemoteActorByUrl"),
      findRemoteActorsByUrls: () => notImpl("system.findRemoteActorsByUrls"),
      upsertRemoteActor: async () => {},
    },
    sessions: {
      create: async (sessionId: string, expiresAt: Date, deviceId: string) => {
        await d1.prepare(
          "INSERT INTO t_sessions (session_id, device_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)"
        ).bind(sessionId, deviceId, expiresAt.getTime(), now()).run();
        return { sessionId, deviceId, expiresAt } as SessionDoc;
      },
      findById: async (sessionId: string) => {
        const row = await d1.prepare(
          "SELECT session_id, device_id, expires_at, created_at FROM t_sessions WHERE session_id = ?1"
        ).bind(sessionId).first<{ session_id: string; device_id: string; expires_at: number; created_at: number }>();
        return row ? { sessionId: row.session_id, deviceId: row.device_id, expiresAt: new Date(Number(row.expires_at)), createdAt: new Date(Number(row.created_at)) } as SessionDoc : null;
      },
      deleteById: async (sessionId: string) => {
        await d1.prepare("DELETE FROM t_sessions WHERE session_id = ?1").bind(sessionId).run();
      },
      updateExpires: async (sessionId: string, expires: Date) => {
        await d1.prepare("UPDATE t_sessions SET expires_at = ?2 WHERE session_id = ?1").bind(sessionId, expires.getTime()).run();
      },
      updateActivity: async (_sessionId: string, _date?: Date) => { /* noop */ },
    },
    fcm: {
      register: async () => {},
      unregister: async () => {},
      list: async () => [],
    },
    faspProviders: {
      getSettings: async () => null,
      list: () => notImpl("faspProviders.list"),
      findOne: () => notImpl("faspProviders.findOne"),
      upsertByBaseUrl: () => notImpl("faspProviders.upsertByBaseUrl"),
      updateByBaseUrl: () => notImpl("faspProviders.updateByBaseUrl"),
      deleteOne: () => notImpl("faspProviders.deleteOne"),
      registrationUpsert: () => notImpl("faspProviders.registrationUpsert"),
      listProviders: () => notImpl("faspProviders.listProviders"),
      insertEventSubscription: () => notImpl("faspProviders.insertEventSubscription"),
      deleteEventSubscription: () => notImpl("faspProviders.deleteEventSubscription"),
      createBackfill: () => notImpl("faspProviders.createBackfill"),
      continueBackfill: () => notImpl("faspProviders.continueBackfill"),
    },
  };
}
