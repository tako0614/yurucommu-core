// Prisma-based HostDataStore implementation for both Deno (libsql adapter)
// and Cloudflare Workers (D1 adapter).

import type { HostDataStore } from "./types.ts";
import type { DataStore } from "../../core/db/types.ts";
import { createObjectStorage } from "../../takos/storage/providers.ts";
import { D1_SCHEMA } from "./d1/schema.ts";

// Dynamic imports keep Workers bundle smaller and avoid env-incompatible code paths.
async function getPrismaClientCtor(): Promise<new (...args: unknown[]) => unknown> {
  // Use Edge client for Deno/Workers
  const mod = await import("@prisma/client/edge");
  // deno-lint-ignore no-explicit-any
  return (mod as any).PrismaClient as new (...args: unknown[]) => unknown;
}

async function createDenoPrisma(env: Record<string, string>) {
  const { PrismaLibSQL } = await import("@prisma/adapter-libsql");
  // DATABASE_URL can be file:./host.db or libsql://...; fall back to file in uploads
  const url = env["DATABASE_URL"] || "file:./host.db";
  const authToken = env["DATABASE_AUTH_TOKEN"]; // for remote Turso/libsql
  // For adapter-libsql, config object is accepted (url/authToken). Cast to any to avoid TS frictions across versions.
  // deno-lint-ignore no-explicit-any
  const adapter = new (PrismaLibSQL as any)({ url, authToken });
  const PrismaClient = await getPrismaClientCtor();
  // deno-lint-ignore no-explicit-any
  return new (PrismaClient as any)({ adapter });
}

async function createWorkersPrisma(d1: unknown) {
  const { PrismaD1 } = await import("@prisma/adapter-d1");
  const PrismaClient = await getPrismaClientCtor();
  // deno-lint-ignore no-explicit-any
  const adapter = new (PrismaD1 as any)(d1 as unknown as { prepare: (sql: string) => unknown });
  // deno-lint-ignore no-explicit-any
  return new (PrismaClient as any)({ adapter });
}

type PrismaLike = {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
  $queryRawUnsafe: (sql: string) => Promise<unknown>;
  tenant: { upsert: (args: unknown) => Promise<unknown> };
  instance: {
    findMany: (args: unknown) => Promise<unknown>;
    count: (args: unknown) => Promise<number>;
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
  hostUser: {
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  hostSession: {
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
  hostDomain: {
    findFirst: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  oAuthClient: {
    findMany: (args?: unknown) => Promise<unknown>;
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
  };
  oAuthCode: {
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
  oAuthToken: {
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
  };
};

function notImplemented(name: string): never {
  throw new Error(`Prisma store does not implement: ${name}`);
}

export function createPrismaHostDataStore(
  env: Record<string, string>,
  opts?: { d1?: unknown; tenantId?: string; multiTenant?: boolean },
): HostDataStore {
  const tenantId = opts?.tenantId ?? env["ACTIVITYPUB_DOMAIN"] ?? "";
  // Lazy init Prisma for environment
  let prismaPromise: Promise<PrismaLike> | null = null;
  let schemaInitPromise: Promise<void> | null = null;
  const prisma = async () => {
    if (!prismaPromise) {
      prismaPromise = (async () => {
        const client = opts?.d1
          ? await createWorkersPrisma(opts.d1)
          : await createDenoPrisma(env);
        return client as unknown as PrismaLike;
      })();
    }
    const p = await prismaPromise;
    if (!schemaInitPromise) {
      schemaInitPromise = (async () => {
        try {
          const stmts = D1_SCHEMA.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
          for (const sql of stmts) await p.$executeRawUnsafe(sql);
        } catch (_e) {
          // ignore
        }
      })();
    }
    await schemaInitPromise.catch(() => {});
    return p;
  };

  const storage = createObjectStorage(env);

  const store: HostDataStore = {
    storage,
    tenantId,
    multiTenant: opts?.multiTenant === true,

    // core repos are not implemented here (host-only responsibilities)
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
      findKey: async (domain: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT domain, privateKey, publicKey FROM systemkey WHERE domain = '${domain.replaceAll("'", "''")}'`) as any[];
        const row = rows?.[0];
        return row ? { domain: String(row.domain), privateKey: String(row.privateKey), publicKey: String(row.publicKey) } : null;
      },
      saveKey: async (domain: string, privateKey: string, publicKey: string) => {
        const p = await prisma();
        await p.$executeRawUnsafe(
          `INSERT INTO systemkey (domain, privateKey, publicKey) VALUES ('${domain.replaceAll("'", "''")}', '${privateKey.replaceAll("'", "''")}', '${publicKey.replaceAll("'", "''")}')
           ON CONFLICT(domain) DO UPDATE SET privateKey=excluded.privateKey, publicKey=excluded.publicKey`
        );
      },
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
  getSettings: () => null,
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

    tenant: {
      ensure: async (id: string) => {
        const p = await prisma();
        await p.$executeRawUnsafe(
          `INSERT OR IGNORE INTO tenants (id, domain, created_at) VALUES ('${id.replaceAll("'", "''")}', '${id.replaceAll("'", "''")}', ${Date.now()})`
        );
      },
    },
    host: {
      listInstances: async (owner: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT host FROM instances WHERE owner='${owner.replaceAll("'", "''")}' ORDER BY created_at DESC`) as any[];
        return rows.map((r) => ({ host: String(r.host) }));
      },
      countInstances: async (owner: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT COUNT(1) as cnt FROM instances WHERE owner='${owner.replaceAll("'", "''")}'`) as any[];
        const row = rows?.[0];
        return Number(row?.cnt ?? 0);
      },
      findInstanceByHost: async (host: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT id, host, owner, env_json FROM instances WHERE host='${host.replaceAll("'", "''")}'`) as any[];
        const row = rows?.[0];
        if (!row) return null;
        return {
          _id: String(row.id),
          host: String(row.host),
          owner: String(row.owner),
          env: row.env_json ? JSON.parse(String(row.env_json)) as Record<string, string> : undefined,
        };
      },
      findInstanceByHostAndOwner: async (host: string, owner: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT id, host, env_json FROM instances WHERE host='${host.replaceAll("'", "''")}' AND owner='${owner.replaceAll("'", "''")}'`) as any[];
        const row = rows?.[0];
        if (!row) return null;
        return { _id: String(row.id), host: String(row.host), env: row.env_json ? JSON.parse(String(row.env_json)) : undefined };
      },
  createInstance: async (data: { host: string; owner: string; env?: Record<string, string> }) => {
        const p = await prisma();
        const envJson = data.env ? JSON.stringify(data.env) : null;
        await p.$executeRawUnsafe(
          `INSERT INTO instances (host, owner, env_json, created_at) VALUES ('${data.host.replaceAll("'", "''")}', '${data.owner.replaceAll("'", "''")}', ${envJson ? `'${envJson.replaceAll("'", "''")}'` : 'NULL'}, ${Date.now()})`
        );
      },
  updateInstanceEnv: async (id: string, envVars: Record<string, string>) => {
        const p = await prisma();
        const envJson = JSON.stringify(envVars);
        await p.$executeRawUnsafe(
          `UPDATE instances SET env_json='${envJson.replaceAll("'", "''")}' WHERE id=${Number(id)}`
        );
      },
  deleteInstance: async (host: string, owner: string) => {
        const p = await prisma();
        await p.$executeRawUnsafe(
          `DELETE FROM instances WHERE host='${host.replaceAll("'", "''")}' AND owner='${owner.replaceAll("'", "''")}'`
        );
      },
    },
    oauth: {
      list: async () => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT client_id, redirect_uri FROM oauth_clients`) as any[];
        return rows.map((r) => ({ clientId: String(r.client_id), redirectUri: String(r.redirect_uri) }));
      },
      find: async (clientId: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT client_secret, redirect_uri FROM oauth_clients WHERE client_id='${clientId.replaceAll("'", "''")}'`) as any[];
        const row = rows?.[0];
        return row ? { clientSecret: String(row.client_secret), redirectUri: String(row.redirect_uri) } : null;
      },
  create: async (data: { clientId: string; clientSecret: string; redirectUri: string }) => {
        const p = await prisma();
        await p.$executeRawUnsafe(
          `INSERT INTO oauth_clients (client_id, client_secret, redirect_uri) VALUES ('${data.clientId.replaceAll("'", "''")}', '${data.clientSecret.replaceAll("'", "''")}', '${data.redirectUri.replaceAll("'", "''")}')`
        );
      },
  createCode: async (data: { code: string; clientId: string; user: string; expiresAt: Date }) => {
        const p = await prisma();
        await p.$executeRawUnsafe(
          `INSERT INTO oauth_codes (code, client_id, user_id, expires_at, created_at) VALUES ('${data.code.replaceAll("'","''")}', '${data.clientId.replaceAll("'","''")}', '${data.user.replaceAll("'","''")}', ${Number(data.expiresAt)}, ${Date.now()})`
        );
      },
  findCode: async (code: string, clientId: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT user_id, expires_at FROM oauth_codes WHERE code='${code.replaceAll("'","''")}' AND client_id='${clientId.replaceAll("'","''")}'`) as any[];
        const row = rows?.[0];
        return row ? { user: String(row.user_id), expiresAt: new Date(Number(row.expires_at)) } : null;
      },
  deleteCode: async (code: string) => {
        const p = await prisma();
        await p.$executeRawUnsafe(`DELETE FROM oauth_codes WHERE code='${code.replaceAll("'","''")}'`);
      },
  createToken: async (data: { token: string; clientId: string; user: string; expiresAt: Date }) => {
        const p = await prisma();
        await p.$executeRawUnsafe(
          `INSERT INTO oauth_tokens (token, client_id, user_id, expires_at, created_at) VALUES ('${data.token.replaceAll("'","''")}', '${data.clientId.replaceAll("'","''")}', '${data.user.replaceAll("'","''")}', ${Number(data.expiresAt)}, ${Date.now()})`
        );
      },
  findToken: async (token: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT user_id, expires_at FROM oauth_tokens WHERE token='${token.replaceAll("'","''")}'`) as any[];
        const row = rows?.[0];
        return row ? { user: String(row.user_id), expiresAt: new Date(Number(row.expires_at)) } : null;
      },
    },
    domains: {
  list: async (user: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT domain, verified FROM host_domains WHERE user_id='${user.replaceAll("'", "''")}' ORDER BY created_at DESC`) as any[];
        return rows.map((r) => ({ domain: String(r.domain), verified: Number(r.verified) === 1 }));
      },
  find: async (domain: string, user?: string) => {
        const p = await prisma();
        let sql = `SELECT id, token, verified FROM host_domains WHERE domain='${domain.replaceAll("'", "''")}'`;
        if (user) sql += ` AND user_id='${user.replaceAll("'", "''")}'`;
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(sql) as any[];
        const row = rows?.[0];
        return row ? { _id: String(row.id), token: String(row.token), verified: Number(row.verified) === 1 } : null;
      },
  create: async (domain: string, user: string, token: string) => {
        const p = await prisma();
        await p.$executeRawUnsafe(
          `INSERT INTO host_domains (user_id, domain, token, verified, created_at) VALUES ('${user.replaceAll("'", "''")}', '${domain.replaceAll("'", "''")}', '${token.replaceAll("'", "''")}', 0, ${Date.now()})`
        );
      },
  verify: async (id: string) => {
        const p = await prisma();
        await p.$executeRawUnsafe(`UPDATE host_domains SET verified=1 WHERE id=${Number(id)}`);
      },
    },
    hostUsers: {
  findById: async (id: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT id, user_name, email, email_verified, verify_code, verify_expires, hashed_password, salt FROM host_users WHERE id='${id.replaceAll("'","''")}'`) as any[];
        const row = rows?.[0];
        return row ? {
          _id: String(row.id),
          userName: String(row.user_name),
          email: String(row.email),
          emailVerified: Number(row.email_verified) === 1,
          verifyCode: row.verify_code ? String(row.verify_code) : undefined,
          verifyCodeExpires: row.verify_expires ? new Date(Number(row.verify_expires)) : undefined,
          hashedPassword: String(row.hashed_password),
          salt: String(row.salt),
        } : null;
      },
  findByUserName: async (userName: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT id, user_name, email, email_verified, verify_code, verify_expires, hashed_password, salt FROM host_users WHERE user_name='${userName.replaceAll("'", "''")}'`) as any[];
        const row = rows?.[0];
        return row ? {
          _id: String(row.id),
          userName: String(row.user_name),
          email: String(row.email),
          emailVerified: Number(row.email_verified) === 1,
          verifyCode: row.verify_code ? String(row.verify_code) : undefined,
          verifyCodeExpires: row.verify_expires ? new Date(Number(row.verify_expires)) : undefined,
          hashedPassword: String(row.hashed_password),
          salt: String(row.salt),
        } : null;
      },
  findByUserNameOrEmail: async (userName: string, email: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT id, user_name, email, email_verified, verify_code, verify_expires, hashed_password, salt FROM host_users WHERE user_name='${userName.replaceAll("'", "''")}' OR email='${email.replaceAll("'", "''")}' LIMIT 1`) as any[];
        const row = rows?.[0];
        return row ? {
          _id: String(row.id),
          userName: String(row.user_name),
          email: String(row.email),
          emailVerified: Number(row.email_verified) === 1,
          verifyCode: row.verify_code ? String(row.verify_code) : undefined,
          verifyCodeExpires: row.verify_expires ? new Date(Number(row.verify_expires)) : undefined,
          hashedPassword: String(row.hashed_password),
          salt: String(row.salt),
        } : null;
      },
  create: async (data: { userName: string; email: string; hashedPassword: string; salt: string; verifyCode: string; verifyCodeExpires: Date; emailVerified?: boolean }) => {
        const p = await prisma();
        await p.$executeRawUnsafe(
          `INSERT INTO host_users (id, user_name, email, email_verified, verify_code, verify_expires, hashed_password, salt, created_at) VALUES ('${crypto.randomUUID()}', '${data.userName.replaceAll("'", "''")}', '${data.email.replaceAll("'", "''")}', ${data.emailVerified ? 1 : 0}, ${data.verifyCode ? `'${data.verifyCode.replaceAll("'", "''")}'` : 'NULL'}, ${data.verifyCodeExpires ? Number(data.verifyCodeExpires) : 'NULL'}, '${data.hashedPassword.replaceAll("'", "''")}', '${data.salt.replaceAll("'", "''")}', ${Date.now()})`
        );
        const created = await (store.hostUsers.findByUserName(data.userName));
        // deno-lint-ignore no-explicit-any
        return created as any;
      },
  update: async (id: string, data: Partial<{ userName: string; email: string; hashedPassword: string; salt: string; verifyCode: string | null; verifyCodeExpires: Date | null; emailVerified: boolean }>) => {
        const p = await prisma();
        const sets: string[] = [];
        const set = (k: string, v: string | number | null) => {
          if (v === null) sets.push(`${k}=NULL`);
          else if (typeof v === "number") sets.push(`${k}=${v}`);
          else sets.push(`${k}='${v.replaceAll("'", "''")}'`);
        };
        if (data.userName !== undefined) set("user_name", data.userName ?? null);
        if (data.email !== undefined) set("email", data.email ?? null);
        if (data.hashedPassword !== undefined) set("hashed_password", data.hashedPassword ?? null);
        if (data.salt !== undefined) set("salt", data.salt ?? null);
        if (data.verifyCode !== undefined) set("verify_code", data.verifyCode ?? null);
        if (data.verifyCodeExpires !== undefined) set("verify_expires", data.verifyCodeExpires ? Number(data.verifyCodeExpires) : null);
        if (data.emailVerified !== undefined) set("email_verified", data.emailVerified ? 1 : 0);
        if (sets.length) {
          await p.$executeRawUnsafe(`UPDATE host_users SET ${sets.join(", ")} WHERE id='${id.replaceAll("'", "''")}'`);
        }
      },
    },
    hostSessions: {
  findById: async (sessionId: string) => {
        const p = await prisma();
        // deno-lint-ignore no-explicit-any
        const rows = await p.$queryRawUnsafe(`SELECT session_id, user_id, expires_at FROM host_sessions WHERE session_id='${sessionId.replaceAll("'", "''")}'`) as any[];
        const row = rows?.[0];
        return row ? {
          _id: String(row.session_id),
          sessionId: String(row.session_id),
          user: String(row.user_id),
          expiresAt: new Date(Number(row.expires_at)),
        } : null;
      },
  create: async (data: { sessionId: string; user: string; expiresAt: Date }) => {
        const p = await prisma();
        await p.$executeRawUnsafe(
          `INSERT INTO host_sessions (session_id, user_id, expires_at, created_at) VALUES ('${data.sessionId.replaceAll("'", "''")}', '${data.user.replaceAll("'", "''")}', ${Number(data.expiresAt)}, ${Date.now()})`
        );
        return (await store.hostSessions.findById(data.sessionId))!;
      },
  update: async (sessionId: string, data: { expiresAt: Date }) => {
        const p = await prisma();
        await p.$executeRawUnsafe(`UPDATE host_sessions SET expires_at=${Number(data.expiresAt)} WHERE session_id='${sessionId.replaceAll("'", "''")}'`);
      },
  delete: async (sessionId: string) => {
        const p = await prisma();
        await p.$executeRawUnsafe(`DELETE FROM host_sessions WHERE session_id='${sessionId.replaceAll("'", "''")}'`);
      },
    },
  } as unknown as HostDataStore & DataStore;

  return store;
}
