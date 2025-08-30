// Cloudflare D1 実装: Takos Host 用 DataStore
// - Host 側の API（ユーザー/セッション/インスタンス/ドメイン/OAuth）を D1 で提供
// - コア側（accounts/posts/...）は未対応のため、未使用であることを前提に例外を投げます

import type { HostDataStore } from "./types.ts";

// D1 の最小型（Workers の実行環境で提供される）
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

function notImplemented(name: string): never {
  throw new Error(`D1 store does not implement: ${name}`);
}

function now(): number {
  return Date.now();
}

function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === "1";
}

function json<T = unknown>(v: unknown): T | undefined {
  if (v == null) return undefined;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return undefined;
  }
}

// R2 互換バケット最小型
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
    // フォールバック: ダミー実装（開発時にエラーを避ける）
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

export function createD1DataStore(
  env: Record<string, string>,
  d1: D1Database,
  options?: { tenantId?: string; multiTenant?: boolean },
): HostDataStore {
  const tenantId = options?.tenantId ?? env["ACTIVITYPUB_DOMAIN"] ?? "";

  // OBJECT_STORAGE_PROVIDER が r2 の場合のみ R2 ストレージを構築
  const storage = (env["OBJECT_STORAGE_PROVIDER"]?.toLowerCase() === "r2")
    ? createR2Storage(env)
    : {
      async put() { return ""; },
      async get() { return null; },
      async delete() { /* noop */ },
    };

  return {
    storage,
    multiTenant: options?.multiTenant === true,
    tenantId,

    // -------------- コア側は未実装（使用禁止） --------------
    accounts: {
      list: () => notImplemented("accounts.list"),
      create: () => notImplemented("accounts.create"),
      findById: () => notImplemented("accounts.findById"),
      findByUserName: () => notImplemented("accounts.findByUserName"),
      updateById: () => notImplemented("accounts.updateById"),
      deleteById: () => notImplemented("accounts.deleteById"),
      addFollower: () => notImplemented("accounts.addFollower"),
      removeFollower: () => notImplemented("accounts.removeFollower"),
      addFollowing: () => notImplemented("accounts.addFollowing"),
      removeFollowing: () => notImplemented("accounts.removeFollowing"),
      addFollowerByName: () => notImplemented("accounts.addFollowerByName"),
      removeFollowerByName: () => notImplemented("accounts.removeFollowerByName"),
      search: () => notImplemented("accounts.search"),
      updateByUserName: () => notImplemented("accounts.updateByUserName"),
      findByUserNames: () => notImplemented("accounts.findByUserNames"),
      count: () => notImplemented("accounts.count"),
    },
    posts: {
      findNoteById: () => notImplemented("posts.findNoteById"),
      findMessageById: () => notImplemented("posts.findMessageById"),
      findAttachmentById: () => notImplemented("posts.findAttachmentById"),
      saveObject: () => notImplemented("posts.saveObject"),
      listTimeline: () => notImplemented("posts.listTimeline"),
      follow: () => notImplemented("posts.follow"),
      unfollow: () => notImplemented("posts.unfollow"),
      saveNote: () => notImplemented("posts.saveNote"),
      updateNote: () => notImplemented("posts.updateNote"),
      deleteNote: () => notImplemented("posts.deleteNote"),
      findNotes: () => notImplemented("posts.findNotes"),
      getPublicNotes: () => notImplemented("posts.getPublicNotes"),
      saveMessage: () => notImplemented("posts.saveMessage"),
      updateMessage: () => notImplemented("posts.updateMessage"),
      deleteMessage: () => notImplemented("posts.deleteMessage"),
      findMessages: () => notImplemented("posts.findMessages"),
      updateObject: () => notImplemented("posts.updateObject"),
      deleteObject: () => notImplemented("posts.deleteObject"),
      deleteManyObjects: () => notImplemented("posts.deleteManyObjects"),
    },
    dms: {
      save: () => notImplemented("dms.save"),
      listBetween: () => notImplemented("dms.listBetween"),
      list: () => notImplemented("dms.list"),
      create: () => notImplemented("dms.create"),
      update: () => notImplemented("dms.update"),
      delete: () => notImplemented("dms.delete"),
    },
    groups: {
      list: () => notImplemented("groups.list"),
      findByName: () => notImplemented("groups.findByName"),
      create: () => notImplemented("groups.create"),
      updateByName: () => notImplemented("groups.updateByName"),
      addFollower: () => notImplemented("groups.addFollower"),
      removeFollower: () => notImplemented("groups.removeFollower"),
      pushOutbox: () => notImplemented("groups.pushOutbox"),
    },
    invites: {
      findOne: () => notImplemented("invites.findOne"),
      findOneAndUpdate: () => notImplemented("invites.findOneAndUpdate"),
      save: () => notImplemented("invites.save"),
      deleteOne: () => notImplemented("invites.deleteOne"),
    },
    approvals: {
      findOne: () => notImplemented("approvals.findOne"),
      findOneAndUpdate: () => notImplemented("approvals.findOneAndUpdate"),
      deleteOne: () => notImplemented("approvals.deleteOne"),
    },
    notifications: {
      list: () => notImplemented("notifications.list"),
      create: () => notImplemented("notifications.create"),
      markRead: () => notImplemented("notifications.markRead"),
      delete: () => notImplemented("notifications.delete"),
    },
    system: {
      findKey: () => notImplemented("system.findKey"),
      saveKey: () => notImplemented("system.saveKey"),
      findRemoteActorByUrl: () => notImplemented("system.findRemoteActorByUrl"),
      findRemoteActorsByUrls: () => notImplemented("system.findRemoteActorsByUrls"),
      upsertRemoteActor: () => notImplemented("system.upsertRemoteActor"),
    },
    sessions: {
      create: () => notImplemented("sessions.create"),
      findById: () => notImplemented("sessions.findById"),
      deleteById: () => notImplemented("sessions.deleteById"),
      updateExpires: () => notImplemented("sessions.updateExpires"),
      updateActivity: () => notImplemented("sessions.updateActivity"),
    },
    fcm: {
      register: () => notImplemented("fcm.register"),
      unregister: () => notImplemented("fcm.unregister"),
      list: () => notImplemented("fcm.list"),
    },
    faspProviders: {
      getSettings: async () => null,
      list: () => notImplemented("faspProviders.list"),
      findOne: () => notImplemented("faspProviders.findOne"),
      upsertByBaseUrl: () => notImplemented("faspProviders.upsertByBaseUrl"),
      updateByBaseUrl: () => notImplemented("faspProviders.updateByBaseUrl"),
      deleteOne: () => notImplemented("faspProviders.deleteOne"),
      registrationUpsert: () => notImplemented("faspProviders.registrationUpsert"),
      listProviders: () => notImplemented("faspProviders.listProviders"),
      insertEventSubscription: () => notImplemented("faspProviders.insertEventSubscription"),
      deleteEventSubscription: () => notImplemented("faspProviders.deleteEventSubscription"),
      createBackfill: () => notImplemented("faspProviders.createBackfill"),
      continueBackfill: () => notImplemented("faspProviders.continueBackfill"),
    },

    // -------------- Host 側（D1 実装） --------------
    tenant: {
      ensure: async (id: string) => {
        await d1.prepare(
          "INSERT OR IGNORE INTO tenants (id, domain, created_at) VALUES (?1, ?2, ?3)"
        ).bind(id, id, now()).run();
      },
    },
    host: {
      listInstances: async (owner: string) => {
        const { results } = await d1.prepare(
          "SELECT host FROM instances WHERE owner = ?1 ORDER BY created_at DESC"
        ).bind(owner).all<{ host: string }>();
        return results ?? [];
      },
      countInstances: async (owner: string) => {
        const row = await d1.prepare(
          "SELECT COUNT(1) as cnt FROM instances WHERE owner = ?1"
        ).bind(owner).first<{ cnt: number }>();
        return Number((row?.cnt ?? 0));
      },
      findInstanceByHost: async (host: string) => {
        const row = await d1.prepare(
          "SELECT id, host, owner, env_json FROM instances WHERE host = ?1"
        ).bind(host).first<Row>();
        if (!row) return null;
        return {
          _id: String(row.id),
          host: String(row.host),
          owner: String(row.owner),
          env: json<Record<string, string>>(row.env_json) ?? {},
        };
      },
      findInstanceByHostAndOwner: async (host: string, owner: string) => {
        const row = await d1.prepare(
          "SELECT id, host, env_json FROM instances WHERE host = ?1 AND owner = ?2"
        ).bind(host, owner).first<Row>();
        if (!row) return null;
        return {
          _id: String(row.id),
          host: String(row.host),
          env: json<Record<string, string>>(row.env_json) ?? {},
        };
      },
      createInstance: async (data) => {
        await d1.prepare(
          "INSERT INTO instances (host, owner, env_json, created_at) VALUES (?1, ?2, ?3, ?4)"
        ).bind(data.host, data.owner, JSON.stringify(data.env ?? {}), now()).run();
      },
      updateInstanceEnv: async (id, envMap) => {
        await d1.prepare(
          "UPDATE instances SET env_json = ?2 WHERE id = ?1"
        ).bind(id, JSON.stringify(envMap ?? {})).run();
      },
      deleteInstance: async (host, owner) => {
        await d1.prepare(
          "DELETE FROM instances WHERE host = ?1 AND owner = ?2"
        ).bind(host, owner).run();
      },
    },
    oauth: {
      list: async () => {
        const { results } = await d1.prepare(
          "SELECT client_id as clientId, redirect_uri as redirectUri FROM oauth_clients ORDER BY client_id"
        ).all<{ clientId: string; redirectUri: string }>();
        return results ?? [];
      },
      find: async (clientId: string) => {
        const row = await d1.prepare(
          "SELECT client_secret as clientSecret FROM oauth_clients WHERE client_id = ?1"
        ).bind(clientId).first<{ clientSecret: string }>();
        return row ?? null;
      },
      create: async (data) => {
        await d1.prepare(
          "INSERT OR REPLACE INTO oauth_clients (client_id, client_secret, redirect_uri) VALUES (?1, ?2, ?3)"
        ).bind(data.clientId, data.clientSecret, data.redirectUri).run();
      },
    },
    domains: {
      list: async (user: string) => {
        const { results } = await d1.prepare(
          "SELECT domain, verified FROM host_domains WHERE user_id = ?1 ORDER BY domain"
        ).bind(user).all<{ domain: string; verified: number }>();
        return (results ?? []).map((r) => ({ domain: r.domain, verified: toBool(r.verified) }));
      },
      find: async (domain: string, user?: string) => {
        const sql = user
          ? "SELECT id, token, verified FROM host_domains WHERE domain = ?1 AND user_id = ?2"
          : "SELECT id, token, verified FROM host_domains WHERE domain = ?1";
        const row = user
          ? await d1.prepare(sql).bind(domain, user).first<Row>()
          : await d1.prepare(sql).bind(domain).first<Row>();
        if (!row) return null;
        return {
          _id: String(row.id),
          token: String(row.token),
          verified: toBool(row.verified),
        };
      },
      create: async (domain: string, user: string, token: string) => {
        await d1.prepare(
          "INSERT INTO host_domains (user_id, domain, token, verified, created_at) VALUES (?1, ?2, ?3, 0, ?4)"
        ).bind(user, domain, token, now()).run();
      },
      verify: async (id: string) => {
        await d1.prepare(
          "UPDATE host_domains SET verified = 1 WHERE id = ?1"
        ).bind(id).run();
      },
    },
    hostUsers: {
      findByUserName: async (userName: string) => {
        const row = await d1.prepare(
          "SELECT * FROM host_users WHERE user_name = ?1"
        ).bind(userName).first<Row>();
        if (!row) return null;
        return {
          _id: String(row.id),
          userName: String(row.user_name),
          email: String(row.email),
          emailVerified: toBool(row.email_verified),
          verifyCode: row.verify_code ? String(row.verify_code) : undefined,
          verifyCodeExpires: row.verify_expires ? new Date(Number(row.verify_expires)) : undefined,
          hashedPassword: String(row.hashed_password),
          salt: String(row.salt),
        };
      },
      findByUserNameOrEmail: async (userName: string, email: string) => {
        const row = await d1.prepare(
          "SELECT * FROM host_users WHERE user_name = ?1 OR email = ?2"
        ).bind(userName, email).first<Row>();
        if (!row) return null;
        return {
          _id: String(row.id),
          userName: String(row.user_name),
          email: String(row.email),
          emailVerified: toBool(row.email_verified),
          verifyCode: row.verify_code ? String(row.verify_code) : undefined,
          verifyCodeExpires: row.verify_expires ? new Date(Number(row.verify_expires)) : undefined,
          hashedPassword: String(row.hashed_password),
          salt: String(row.salt),
        };
      },
      create: async (data) => {
        const id = crypto.randomUUID();
        await d1.prepare(
          "INSERT INTO host_users (id, user_name, email, email_verified, verify_code, verify_expires, hashed_password, salt, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
        ).bind(
          id,
          data.userName,
          data.email,
          data.emailVerified === true ? 1 : 0,
          data.verifyCode ?? null,
          data.verifyCodeExpires ? data.verifyCodeExpires.getTime() : null,
          data.hashedPassword,
          data.salt,
          now(),
        ).run();
        return {
          _id: id,
          userName: data.userName,
          email: data.email,
          emailVerified: data.emailVerified === true,
          hashedPassword: data.hashedPassword,
          salt: data.salt,
        };
      },
      update: async (id, data) => {
        const sets: string[] = [];
        const vals: unknown[] = [];
        const push = (col: string, val: unknown) => { sets.push(`${col} = ?${sets.length + 1}`); vals.push(val); };
        if (data.userName !== undefined) push("user_name", data.userName);
        if (data.email !== undefined) push("email", data.email);
        if (data.hashedPassword !== undefined) push("hashed_password", data.hashedPassword);
        if (data.salt !== undefined) push("salt", data.salt);
        if (data.verifyCode !== undefined) push("verify_code", data.verifyCode);
        if (data.verifyCodeExpires !== undefined) push("verify_expires", data.verifyCodeExpires ? data.verifyCodeExpires.getTime() : null);
        if (data.emailVerified !== undefined) push("email_verified", data.emailVerified ? 1 : 0);
        if (sets.length === 0) return;
        const sql = `UPDATE host_users SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`;
        vals.push(id);
        await d1.prepare(sql).bind(...vals).run();
      },
    },
    hostSessions: {
      findById: async (sessionId: string) => {
        const row = await d1.prepare(
          "SELECT session_id, user_id, expires_at FROM host_sessions WHERE session_id = ?1"
        ).bind(sessionId).first<{ session_id: string; user_id: string; expires_at: number }>();
        return row
          ? { sessionId: row.session_id, user: row.user_id, expiresAt: new Date(Number(row.expires_at)) }
          : null;
      },
      create: async (data) => {
        await d1.prepare(
          "INSERT INTO host_sessions (session_id, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)"
        ).bind(data.sessionId, data.user, data.expiresAt.getTime(), now()).run();
        return { sessionId: data.sessionId, user: data.user, expiresAt: data.expiresAt };
      },
      update: async (sessionId, data) => {
        await d1.prepare(
          "UPDATE host_sessions SET expires_at = ?2 WHERE session_id = ?1"
        ).bind(sessionId, data.expiresAt.getTime()).run();
      },
      delete: async (sessionId: string) => {
        await d1.prepare(
          "DELETE FROM host_sessions WHERE session_id = ?1"
        ).bind(sessionId).run();
      },
    },
  };
}
