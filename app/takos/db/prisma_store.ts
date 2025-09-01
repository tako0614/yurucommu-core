// Prisma-based DataStore implementation for takos core (Deno/Workers via Edge client)
// This file is generated in multiple small patches due to Windows CLI limits.

import type {
  AccountsRepo,
  ApprovalsRepo,
  DataStore,
  DMRepo,
  FaspProvidersRepo,
  FcmRepo,
  GroupsRepo,
  InvitesRepo,
  ListOpts,
  NotificationsRepo,
  PostsRepo,
  SessionsRepo,
  SortSpec,
  SystemRepo,
} from "../../core/db/types.ts";
import { createObjectStorage } from "../storage/providers.ts";
import { D1_SCHEMA } from "./d1/schema.ts";
import { generateKeyPair } from "@takos/crypto";

// Utilities mirrored from Mongo implementation
function normalizeActorUrl(id: string, defaultDomain?: string): string {
  try {
    const url = new URL(id);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    if (id.includes("@")) {
      const [name, host] = id.split("@");
      return `https://${host}/users/${name}`;
    }
    if (defaultDomain) {
      return `https://${defaultDomain}/users/${id}`;
    }
    return id;
  }
}

function toHandle(id: string): string {
  try {
    if (id.startsWith("http")) {
      const u = new URL(id);
      const name = u.pathname.split("/").filter(Boolean).pop() ?? "";
      if (name) return `${name}@${u.hostname}`;
    }
  } catch { /* ignore */ }
  return id;
}

function toActorUrl(handle: string): string | null {
  if (handle.includes("@")) {
    const [name, host] = handle.split("@");
    if (name && host) return `https://${host}/users/${name}`;
  }
  return null;
}

function uniq(arr: (string | null | undefined)[]): string[] {
  return Array.from(new Set(arr.filter((v): v is string => !!v)));
}

async function getPrismaClientCtor(): Promise<new (...args: unknown[]) => unknown> {
  const mod = await import("@prisma/client/edge");
  // deno-lint-ignore no-explicit-any
  return (mod as any).PrismaClient as new (...args: unknown[]) => unknown;
}

async function createDenoPrisma(env: Record<string, string>) {
  const { PrismaLibSQL } = await import("@prisma/adapter-libsql");
  const PrismaClient = await getPrismaClientCtor();
  const url = env["DATABASE_URL"] || "file:./takos.db";
  const authToken = env["DATABASE_AUTH_TOKEN"];
  // deno-lint-ignore no-explicit-any
  const adapter = new (PrismaLibSQL as any)({ url, authToken });
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
  account: {
    findMany: (args?: unknown) => Promise<unknown[]>;
    findFirst: (args: unknown) => Promise<unknown | null>;
    findUnique: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
    count: (args?: unknown) => Promise<number>;
  };
  followEdge: {
    findMany: (args: unknown) => Promise<unknown[]>;
    upsert: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
  note: {
    findFirst: (args: unknown) => Promise<unknown | null>;
    findMany: (args: unknown) => Promise<unknown[]>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
  message: {
    findFirst: (args: unknown) => Promise<unknown | null>;
    findMany: (args: unknown) => Promise<unknown[]>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
  attachment: {
    findFirst: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
  };
  session: {
    findFirst: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
  notification: {
    findMany: (args: unknown) => Promise<unknown[]>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
  systemKey: {
    findFirst: (args: unknown) => Promise<unknown | null>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  remoteActor: {
    findFirst: (args: unknown) => Promise<unknown | null>;
    findMany: (args: unknown) => Promise<unknown[]>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  directMessage: {
    findMany: (args: unknown) => Promise<unknown[]>;
    upsert: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
  fcmToken: {
    upsert: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
    findMany: (args?: unknown) => Promise<unknown[]>;
  };
};

function notImplemented(name: string): never {
  throw new Error(`Prisma takos store does not implement: ${name}`);
}

export function createPrismaDataStore(
  env: Record<string, string>,
  opts?: { d1?: unknown },
): DataStore {
  const domain = env["ACTIVITYPUB_DOMAIN"] ?? "";
  let prismaPromise: Promise<PrismaLike> | null = null;
  let schemaInitPromise: Promise<void> | null = null;
  const prisma = async () => {
    if (!prismaPromise) {
      prismaPromise = (opts?.d1 ? createWorkersPrisma(opts.d1) : createDenoPrisma(env))
        .then((c) => c as unknown as PrismaLike);
    }
    const p = await prismaPromise;
    if (!schemaInitPromise) {
      schemaInitPromise = (async () => {
        try {
          const stmts = D1_SCHEMA.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
          for (const sql of stmts) await p.$executeRawUnsafe(sql);
        } catch (_) {
          // ignore
        }
      })();
    }
    await schemaInitPromise.catch(() => {});
    return p;
  };

  const storage = createObjectStorage(env);

  // Placeholders; will be filled by subsequent patches
  const accounts: AccountsRepo = {
    list: async () => {
      const p = await prisma();
      const rows = await p.account.findMany({});
      // deno-lint-ignore no-explicit-any
      return rows as any[];
    },
    create: async (data) => {
      const p = await prisma();
      const created = await p.account.create({
        // deno-lint-ignore no-explicit-any
        data: {
          userName: String((data as any).userName ?? ""),
          displayName: String((data as any).displayName ?? ""),
          avatarInitial: String((data as any).avatarInitial ?? ""),
          privateKey: String((data as any).privateKey ?? ""),
          publicKey: String((data as any).publicKey ?? ""),
          groupOverrides: JSON.stringify((data as any).groupOverrides ?? {}),
        },
      });
      // deno-lint-ignore no-explicit-any
      return created as any;
    },
    findById: async (id) => {
      const p = await prisma();
      const row = await p.account.findUnique({ where: { id } });
      // deno-lint-ignore no-explicit-any
      return (row as any) ?? null;
    },
    findByUserName: async (username) => {
      const p = await prisma();
      const row = await p.account.findFirst({ where: { userName: username } });
      // deno-lint-ignore no-explicit-any
      return (row as any) ?? null;
    },
    updateById: async (id, update) => {
      const p = await prisma();
      const updated = await p.account.update({
        where: { id },
        data: {
          userName: update.userName as string | undefined,
          displayName: update.displayName as string | undefined,
          avatarInitial: update.avatarInitial as string | undefined,
          privateKey: update.privateKey as string | undefined,
          publicKey: update.publicKey as string | undefined,
          groupOverrides: update.groupOverrides ? JSON.stringify(update.groupOverrides) : undefined,
        },
      });
      // deno-lint-ignore no-explicit-any
      return updated as any;
    },
    deleteById: async (id) => {
      const p = await prisma();
      await p.account.delete({ where: { id } });
      return true;
    },
    addFollower: async (_id, _follower) => {
      notImplemented("accounts.addFollower (use addFollowerByName)");
    },
    removeFollower: async (_id, _follower) => {
      notImplemented("accounts.removeFollower (use removeFollowerByName)");
    },
    addFollowing: async (id, target) => {
      const p = await prisma();
      const acc = await p.account.findUnique({ where: { id } }) as { userName: string } | null;
      if (!acc) return [];
      const actor = normalizeActorUrl(acc.userName, domain);
      const targetUrl = normalizeActorUrl(target);
      await p.followEdge.upsert({
        where: { actorId_targetId: { actorId: actor, targetId: targetUrl } },
        // deno-lint-ignore no-explicit-any
        create: { actorId: actor, targetId: targetUrl } as any,
        update: {},
      });
      const rows = await p.followEdge.findMany({ where: { actorId: actor } });
      // deno-lint-ignore no-explicit-any
      return (rows as any[]).map((r) => String((r as any).targetId));
    },
    removeFollowing: async (id, target) => {
      const p = await prisma();
      const acc = await p.account.findUnique({ where: { id } }) as { userName: string } | null;
      if (!acc) return [];
      const actor = normalizeActorUrl(acc.userName, domain);
      const targetUrl = normalizeActorUrl(target);
      try {
        await p.followEdge.delete({ where: { actorId_targetId: { actorId: actor, targetId: targetUrl } } });
      } catch { /* ignore */ }
      const rows = await p.followEdge.findMany({ where: { actorId: actor } });
      // deno-lint-ignore no-explicit-any
      return (rows as any[]).map((r) => String((r as any).targetId));
    },
    addFollowerByName: async (username, follower) => {
      const p = await prisma();
      const actor = `https://${domain}/users/${username}`;
      const followerUrl = normalizeActorUrl(follower);
      await p.followEdge.upsert({
        where: { actorId_targetId: { actorId: followerUrl, targetId: actor } },
        // deno-lint-ignore no-explicit-any
        create: { actorId: followerUrl, targetId: actor } as any,
        update: {},
      });
    },
    removeFollowerByName: async (username, follower) => {
      const p = await prisma();
      const actor = `https://${domain}/users/${username}`;
      const followerUrl = normalizeActorUrl(follower);
      try {
        await p.followEdge.delete({ where: { actorId_targetId: { actorId: followerUrl, targetId: actor } } });
      } catch { /* ignore */ }
    },
    search: async (query, limit) => {
      const p = await prisma();
      const q = String(query).replace(/^\/(.*)\/.*$/, "$1");
      const rows = await p.account.findMany({
        where: { OR: [
          { userName: { contains: q } },
          { displayName: { contains: q } },
        ] },
        take: typeof limit === "number" ? limit : 20,
      });
      // deno-lint-ignore no-explicit-any
      return rows as any[];
    },
    updateByUserName: async (username, update) => {
      const p = await prisma();
      await p.account.update({
        where: { userName: username },
        data: {
          displayName: update.displayName as string | undefined,
          avatarInitial: update.avatarInitial as string | undefined,
          privateKey: update.privateKey as string | undefined,
          publicKey: update.publicKey as string | undefined,
          groupOverrides: update.groupOverrides ? JSON.stringify(update.groupOverrides) : undefined,
        },
      });
    },
    findByUserNames: async (usernames) => {
      const p = await prisma();
      const rows = await p.account.findMany({ where: { userName: { in: usernames } } });
      // deno-lint-ignore no-explicit-any
      return rows as any[];
    },
    count: async () => {
      const p = await prisma();
      return await p.account.count();
    },
  };
  const posts: PostsRepo = {
    findNoteById: async (id) => {
      const p = await prisma();
      return await p.note.findFirst({ where: { id } });
    },
    findMessageById: async (id) => {
      const p = await prisma();
      return await p.message.findFirst({ where: { id } });
    },
    findAttachmentById: async (id) => {
      const p = await prisma();
      return await p.attachment.findFirst({ where: { id } });
    },
    saveObject: async (obj) => {
      const p = await prisma();
      const type = typeof obj.type === "string" ? obj.type : "Note";
      const actor = normalizeActorUrl(String(obj.attributedTo ?? obj["actor_id"] ?? ""), domain);
      if (type === "Attachment") {
        return await p.attachment.create({
          // deno-lint-ignore no-explicit-any
          data: {
            id: String(obj._id ?? obj.id ?? crypto.randomUUID()),
            attributedTo: actor,
            actor_id: actor,
            extra: JSON.stringify(obj.extra ?? {}),
          } as any,
        });
      }
      if (type === "Note") {
        return await p.note.create({
          // deno-lint-ignore no-explicit-any
          data: {
            id: String(obj._id ?? obj.id ?? crypto.randomUUID()),
            attributedTo: actor,
            actor_id: actor,
            content: String(obj.content ?? ""),
            extra: JSON.stringify(obj.extra ?? {}),
            published: new Date(),
            aud_to: JSON.stringify(obj.aud?.to ?? []),
            aud_cc: JSON.stringify(obj.aud?.cc ?? []),
          } as any,
        });
      }
      return await p.message.create({
        // deno-lint-ignore no-explicit-any
        data: {
          id: String(obj._id ?? obj.id ?? crypto.randomUUID()),
          type: type,
          attributedTo: actor,
          actor_id: actor,
          content: String(obj.content ?? ""),
          url: (obj as Record<string, unknown>).url as string | undefined,
          mediaType: (obj as Record<string, unknown>).mediaType as string | undefined,
          name: (obj as Record<string, unknown>).name as string | undefined,
          extra: JSON.stringify(obj.extra ?? {}),
          published: new Date(),
          aud_to: JSON.stringify(obj.aud?.to ?? []),
          aud_cc: JSON.stringify(obj.aud?.cc ?? []),
        } as any,
      });
    },
    listTimeline: async (actorOrUrl, opts) => {
      const p = await prisma();
      let name = actorOrUrl;
      try {
        const url = new URL(actorOrUrl);
        if (url.hostname === domain && url.pathname.startsWith("/users/")) {
          name = url.pathname.split("/")[2];
        }
      } catch { /* not URL */ }
      const actorUrl = normalizeActorUrl(name, domain);
      // deno-lint-ignore no-explicit-any
      const edges = await p.followEdge.findMany({ where: { actorId: actorUrl } }) as any[];
      const ids = edges.map((e) => String((e as any).targetId));
      ids.push(actorUrl);
      const where: Record<string, unknown> = { actor_id: { in: ids } };
      if (opts.before) {
        // deno-lint-ignore no-explicit-any
        (where as any).created_at = { lt: opts.before };
      }
      const limit = (opts.limit ?? 40);
      const rows = await p.note.findMany({
        where: {
          AND: [
            where,
            // deno-lint-ignore no-explicit-any
            { aud_to: { contains: "https://www.w3.org/ns/activitystreams#Public" } as any },
          ],
        },
        orderBy: { created_at: "desc" },
        take: limit,
      });
      return rows as unknown[];
    },
    follow: async (followerNameOrUrl, target) => {
      const p = await prisma();
      const actor = normalizeActorUrl(followerNameOrUrl, domain);
      const targetUrl = normalizeActorUrl(target);
      await p.followEdge.upsert({
        where: { actorId_targetId: { actorId: actor, targetId: targetUrl } },
        // deno-lint-ignore no-explicit-any
        create: { actorId: actor, targetId: targetUrl } as any,
        update: {},
      });
    },
    unfollow: async (followerNameOrUrl, target) => {
      const p = await prisma();
      const actor = normalizeActorUrl(followerNameOrUrl, domain);
      const targetUrl = normalizeActorUrl(target);
      try {
        await p.followEdge.delete({ where: { actorId_targetId: { actorId: actor, targetId: targetUrl } } });
      } catch { /* ignore */ }
    },
    saveNote: async (d, a, c, e, aud) => {
      const p = await prisma();
      const id = crypto.randomUUID();
      const actor = normalizeActorUrl(a, d);
      return await p.note.create({
        // deno-lint-ignore no-explicit-any
        data: {
          id,
          attributedTo: actor,
          actor_id: actor,
          content: c,
          extra: JSON.stringify(e ?? {}),
          published: new Date(),
          aud_to: JSON.stringify(aud?.to ?? ["https://www.w3.org/ns/activitystreams#Public"]) ,
          aud_cc: JSON.stringify(aud?.cc ?? []),
        } as any,
      });
    },
    updateNote: async (id, update) => {
      const p = await prisma();
      return await p.note.update({
        where: { id },
        data: {
          content: update.content as string | undefined,
          extra: update.extra ? JSON.stringify(update.extra) : undefined,
          updated_at: new Date(),
        },
      });
    },
    deleteNote: async (id) => {
      const p = await prisma();
      await p.note.delete({ where: { id } });
      return true;
    },
    findNotes: async (filter, sort?: SortSpec) => {
      const p = await prisma();
      const where: Record<string, unknown> = {};
      if (filter.actor_id) where["actor_id"] = filter.actor_id;
      const orderBy = sort?.created_at ? { created_at: (String(sort.created_at).includes("-1") ? "desc" : "asc") as const } : undefined;
      return await p.note.findMany({ where, orderBy });
    },
    getPublicNotes: async (limit, before) => {
      const p = await prisma();
      const where: Record<string, unknown> = {
        // deno-lint-ignore no-explicit-any
        aud_to: { contains: "https://www.w3.org/ns/activitystreams#Public" } as any,
      };
      if (before) {
        // deno-lint-ignore no-explicit-any
        (where as any).created_at = { lt: before };
      }
      return await p.note.findMany({ where, orderBy: { created_at: "desc" }, take: limit });
    },
    saveMessage: async (d, a, c, e, aud) => {
      const p = await prisma();
      const id = crypto.randomUUID();
      const actor = normalizeActorUrl(a, d);
      return await p.message.create({
        // deno-lint-ignore no-explicit-any
        data: {
          id,
          type: "Note",
          attributedTo: actor,
          actor_id: actor,
          content: c,
          extra: JSON.stringify(e ?? {}),
          published: new Date(),
          aud_to: JSON.stringify(aud?.to ?? []),
          aud_cc: JSON.stringify(aud?.cc ?? []),
        } as any,
      });
    },
    updateMessage: async (id, update) => {
      const p = await prisma();
      return await p.message.update({
        where: { id },
        data: {
          content: update.content as string | undefined,
          extra: update.extra ? JSON.stringify(update.extra) : undefined,
          updated_at: new Date(),
        },
      });
    },
    deleteMessage: async (id) => {
      const p = await prisma();
      await p.message.delete({ where: { id } });
      return true;
    },
    findMessages: async (filter, sort?: SortSpec) => {
      const p = await prisma();
      const where: Record<string, unknown> = {};
      if (filter.actor_id) where["actor_id"] = filter.actor_id;
      const orderBy = sort?.created_at ? { created_at: (String(sort.created_at).includes("-1") ? "desc" : "asc") as const } : undefined;
      return await p.message.findMany({ where, orderBy });
    },
    updateObject: async (id, update) => {
      const p = await prisma();
      try {
        return await p.note.update({ where: { id }, data: { extra: update.extra ? JSON.stringify(update.extra) : undefined, updated_at: new Date() } });
      } catch {
        try {
          return await p.message.update({ where: { id }, data: { extra: update.extra ? JSON.stringify(update.extra) : undefined, updated_at: new Date() } });
        } catch {
          return await p.attachment.create({
            // deno-lint-ignore no-explicit-any
            data: { id, attributedTo: String(update.attributedTo ?? ""), actor_id: String(update.actor_id ?? ""), extra: JSON.stringify(update.extra ?? {}) } as any,
          });
        }
      }
    },
    deleteObject: async (id) => {
      const p = await prisma();
      try { await p.note.delete({ where: { id } }); return true; } catch {}
      try { await p.message.delete({ where: { id } }); return true; } catch {}
      try { await p.attachment.delete({ where: { id } }); return true; } catch {}
      return false;
    },
    deleteManyObjects: async (_filter) => {
      return { deletedCount: 0 };
    },
  };
  const dms: DMRepo = {
    save: async (
      from,
      to,
      type,
      content?,
      attachments?,
      url?,
      mediaType?,
      key?,
      iv?,
      preview?,
    ) => {
      const p = await prisma();
      const extra: Record<string, unknown> = { type, dm: true };
      const typeMap: Record<string, string> = { image: "Image", video: "Video", file: "Document" };
      const objectType = typeMap[type] ?? "Note";
      if (attachments) extra.attachments = attachments;
      if (key) extra.key = key;
      if (iv) extra.iv = iv;
      if (preview) extra.preview = preview;
      const fromUrl = from.includes("://") ? from : normalizeActorUrl(from, domain);
      const id = crypto.randomUUID();
      await p.message.create({
        // deno-lint-ignore no-explicit-any
        data: {
          id,
          type: objectType,
          attributedTo: fromUrl,
          actor_id: fromUrl,
          content: content ?? "",
          url: objectType === "Note" ? undefined : url,
          mediaType: objectType === "Note" ? undefined : mediaType,
          extra: JSON.stringify(extra),
          aud_to: JSON.stringify([to]),
          aud_cc: JSON.stringify([]),
        } as any,
      });
      return {
        id,
        from: fromUrl,
        to,
        type,
        content: content ?? "",
        attachments,
        url,
        mediaType,
        key,
        iv,
        preview,
        createdAt: new Date(),
      } as unknown;
    },
    listBetween: async (user1, user2) => {
      const p = await prisma();
      const a1 = uniq([user1, toHandle(user1), toActorUrl(user1)]);
      const a2 = uniq([user2, toHandle(user2), toActorUrl(user2)]);
      // Can't JSON-query aud_to easily in SQLite → use contains on JSON string
      const conds: unknown[] = [];
      for (const s1 of a1) {
        for (const s2 of a2) {
          conds.push({ AND: [ { actor_id: s1 }, { aud_to: { contains: s2 } } ] });
          conds.push({ AND: [ { actor_id: s2 }, { aud_to: { contains: s1 } } ] });
        }
      }
      const rows = await p.message.findMany({
        where: {
          AND: [
            // deno-lint-ignore no-explicit-any
            { extra: { contains: '"dm"' } as any },
            { OR: conds as any[] },
          ],
        },
        orderBy: { created_at: "asc" },
      });
      return rows as unknown[];
    },
    list: async (owner) => {
      const p = await prisma();
      const rows = await p.directMessage.findMany({ where: { owner } });
      // deno-lint-ignore no-explicit-any
      return rows as any[];
    },
    create: async (data) => {
      const p = await prisma();
      await p.directMessage.upsert({
        where: { owner_id: { owner: data.owner, id: data.id } },
        // deno-lint-ignore no-explicit-any
        create: { owner: data.owner, id: data.id } as any,
        update: {},
      });
      return { owner: data.owner, id: data.id };
    },
    update: async (owner, id, _update) => {
      const p = await prisma();
      const row = await p.directMessage.findMany({ where: { owner, id }, take: 1 });
      // deno-lint-ignore no-explicit-any
      return (row?.[0] as any) ?? null;
    },
    delete: async (owner, id) => {
      const p = await prisma();
      try {
        await p.directMessage.delete({ where: { owner_id: { owner, id } } });
        return true;
      } catch { return false; }
    },
  };
  const groups: GroupsRepo = {
    list: async (member: string) => {
      const p = await prisma();
      const actor = `https://${domain}/users/${member}`;
      // local groups where the actor follows
      // deno-lint-ignore no-explicit-any
      const follows = await p.$queryRawUnsafe(`SELECT groupName FROM GroupFollower WHERE actor = '${actor.replaceAll("'", "''")}'`) as any[];
      const names = follows.map((r) => String((r as any).groupName));
      if (names.length === 0) return [];
      // deno-lint-ignore no-explicit-any
      const rows = await p.$queryRawUnsafe(`SELECT * FROM Group WHERE groupName IN (${names.map((n) => `'${n.replaceAll("'", "''")}'`).join(",")})`) as any[];
      const res = [] as { id: string; name: string; icon?: unknown; members: string[] }[];
      for (const g of rows) {
        const id = `https://${domain}/groups/${String((g as any).groupName)}`;
        // deno-lint-ignore no-explicit-any
        const followers = await p.$queryRawUnsafe(`SELECT actor FROM GroupFollower WHERE groupName = '${String((g as any).groupName).replaceAll("'", "''")}'`) as any[];
        const iconStr = (g as any).icon as string | null | undefined;
        let icon: unknown = undefined;
        try { icon = iconStr ? JSON.parse(iconStr) : undefined; } catch { icon = iconStr; }
        res.push({
          id,
          name: String((g as any).displayName || (g as any).groupName),
          icon,
          members: followers.map((f) => String((f as any).actor)),
        });
      }
      return res;
    },
    findByName: async (name: string) => {
      const p = await prisma();
      const rows = await p.$queryRawUnsafe(`SELECT * FROM Group WHERE groupName='${name.replaceAll("'", "''")}' LIMIT 1`) as unknown[];
      return rows?.[0] ?? null;
    },
    create: async (data) => {
      const p = await prisma();
      // ensure keypair
      if (!(typeof (data as Record<string, unknown>).publicKey === "string" && typeof (data as Record<string, unknown>).privateKey === "string")) {
        const keys = await generateKeyPair();
        (data as Record<string, unknown>).privateKey = keys.privateKey;
        (data as Record<string, unknown>).publicKey = keys.publicKey;
      }
      const allowInvites = typeof (data as Record<string, unknown>).allowInvites === "boolean"
        ? ((data as Record<string, unknown>).allowInvites ? 1 : 0)
        : undefined;
      await p.$executeRawUnsafe(
        `INSERT INTO Group (groupName, displayName, summary, icon, image, privateKey, publicKey, membershipPolicy, invitePolicy, visibility, allowInvites)
         VALUES (
           '${String((data as any).groupName).replaceAll("'","''")}',
           '${String((data as any).displayName ?? "").replaceAll("'","''")}',
           '${String((data as any).summary ?? "").replaceAll("'","''")}',
           ${ (data as any).icon ? `'${JSON.stringify((data as any).icon).replaceAll("'","''")}'` : 'NULL' },
           ${ (data as any).image ? `'${JSON.stringify((data as any).image).replaceAll("'","''")}'` : 'NULL' },
           '${String((data as any).privateKey ?? "").replaceAll("'","''")}',
           '${String((data as any).publicKey ?? "").replaceAll("'","''")}',
           '${String((data as any).membershipPolicy ?? "open").replaceAll("'","''")}',
           '${String((data as any).invitePolicy ?? "members").replaceAll("'","''")}',
           '${String((data as any).visibility ?? "public").replaceAll("'","''")}',
           ${allowInvites ?? 1}
         )`
      );
      const created = await p.$queryRawUnsafe(`SELECT * FROM Group WHERE groupName='${String((data as any).groupName).replaceAll("'","''")}' LIMIT 1`) as unknown[];
      // deno-lint-ignore no-explicit-any
      return (created?.[0] as any) ?? null;
    },
    updateByName: async (name, update) => {
      const p = await prisma();
      const fields: string[] = [];
      for (const [k, v] of Object.entries(update)) {
        if (v === undefined) continue;
        if (k === "icon" || k === "image") fields.push(`${k} = '${JSON.stringify(v).replaceAll("'","''")}'`);
        else if (k === "allowInvites") fields.push(`${k} = ${v ? 1 : 0}`);
        else fields.push(`${k} = '${String(v).replaceAll("'","''")}'`);
      }
      if (fields.length === 0) {
        const row = await p.$queryRawUnsafe(`SELECT * FROM Group WHERE groupName='${name.replaceAll("'","''")}' LIMIT 1`) as unknown[];
        return row?.[0] ?? null;
      }
      await p.$executeRawUnsafe(`UPDATE Group SET ${fields.join(", ")} WHERE groupName='${name.replaceAll("'","''")}'`);
      const row = await p.$queryRawUnsafe(`SELECT * FROM Group WHERE groupName='${name.replaceAll("'","''")}' LIMIT 1`) as unknown[];
      return row?.[0] ?? null;
    },
    addFollower: async (name, actor) => {
      const p = await prisma();
      await p.$executeRawUnsafe(
        `INSERT INTO GroupFollower (groupName, actor) VALUES ('${name.replaceAll("'","''")}', '${actor.replaceAll("'","''")}')
         ON CONFLICT(groupName, actor) DO NOTHING`
      );
      const rows = await p.$queryRawUnsafe(`SELECT actor FROM GroupFollower WHERE groupName='${name.replaceAll("'","''")}'`) as { actor: string }[];
      return rows.map((r) => String(r.actor));
    },
    removeFollower: async (name, actor) => {
      const p = await prisma();
      await p.$executeRawUnsafe(`DELETE FROM GroupFollower WHERE groupName='${name.replaceAll("'","''")}' AND actor='${actor.replaceAll("'","''")}'`);
      const rows = await p.$queryRawUnsafe(`SELECT actor FROM GroupFollower WHERE groupName='${name.replaceAll("'","''")}'`) as { actor: string }[];
      return rows.map((r) => String(r.actor));
    },
    pushOutbox: async (name, activity) => {
      const p = await prisma();
      await p.$executeRawUnsafe(
        `INSERT INTO GroupOutbox (groupName, activity, createdAt) VALUES ('${name.replaceAll("'","''")}', '${JSON.stringify(activity).replaceAll("'","''")}', ${Math.floor(Date.now()/1000)})`
      );
    },
  };
  const invites: InvitesRepo = {
    findOne: async (filter) => {
      const p = await prisma();
      const g = (filter as Record<string, unknown>).groupName as string | undefined;
      const a = (filter as Record<string, unknown>).actor as string | undefined;
      if (!g || !a) return null;
      const rows = await p.$queryRawUnsafe(`SELECT * FROM Invite WHERE groupName='${g.replaceAll("'","''")}' AND actor='${a.replaceAll("'","''")}' LIMIT 1`) as unknown[];
      return rows?.[0] ?? null;
    },
    findOneAndUpdate: async (filter, update, options) => {
      const p = await prisma();
      const g = (filter as Record<string, unknown>).groupName as string | undefined;
      const a = (filter as Record<string, unknown>).actor as string | undefined;
      if (!g || !a) return null;
      // parse update
      let incUses = 0;
      let set: Record<string, unknown> = {};
      if ((update as Record<string, unknown>)["$inc"]) {
        const inc = (update as Record<string, { remainingUses?: number }>)["$inc"];
        incUses = Number(inc.remainingUses ?? 0);
      } else {
        set = update as Record<string, unknown>;
      }
      const now = new Date();
      if (options?.upsert) {
        // upsert by composite key
        const rows = await p.$queryRawUnsafe(`SELECT * FROM Invite WHERE groupName='${g.replaceAll("'","''")}' AND actor='${a.replaceAll("'","''")}' LIMIT 1`) as any[];
        if (!rows?.[0]) {
          const remaining = typeof set["remainingUses"] === "number" ? Number(set["remainingUses"]) : 1;
          const accepted = typeof set["accepted"] === "boolean" ? (set["accepted"] ? 1 : 0) : 0;
          await p.$executeRawUnsafe(
            `INSERT INTO Invite (groupName, actor, inviter, expiresAt, remainingUses, accepted, createdAt, updatedAt)
             VALUES ('${g.replaceAll("'","''")}', '${a.replaceAll("'","''")}', ${set["inviter"] ? `'${String(set["inviter"]).replaceAll("'","''")}'` : 'NULL'}, ${set["expiresAt"] instanceof Date ? Math.floor((set["expiresAt"] as Date).getTime()/1000) : 'NULL'}, ${remaining}, ${accepted}, ${Math.floor(now.getTime()/1000)}, ${Math.floor(now.getTime()/1000)})`
          );
        }
      }
      if (incUses !== 0) {
        await p.$executeRawUnsafe(`UPDATE Invite SET remainingUses = remainingUses + (${incUses}), updatedAt = ${Math.floor(now.getTime()/1000)} WHERE groupName='${g.replaceAll("'","''")}' AND actor='${a.replaceAll("'","''")}'`);
      } else if (Object.keys(set).length > 0) {
        const assigns: string[] = [];
        if (set["inviter"]) assigns.push(`inviter='${String(set["inviter"]).replaceAll("'","''")}'`);
        if (set["expiresAt"]) assigns.push(`expiresAt=${(set["expiresAt"] as Date) instanceof Date ? Math.floor((set["expiresAt"] as Date).getTime()/1000) : 'NULL'}`);
        if (set["remainingUses"]) assigns.push(`remainingUses=${Number(set["remainingUses"])}`);
        if (set["accepted"]) assigns.push(`accepted=${(set["accepted"] as boolean) ? 1 : 0}`);
        if (assigns.length > 0) {
          assigns.push(`updatedAt=${Math.floor(now.getTime()/1000)}`);
          await p.$executeRawUnsafe(`UPDATE Invite SET ${assigns.join(", ")} WHERE groupName='${g.replaceAll("'","''")}' AND actor='${a.replaceAll("'","''")}'`);
        }
      }
      const row = await p.$queryRawUnsafe(`SELECT * FROM Invite WHERE groupName='${g.replaceAll("'","''")}' AND actor='${a.replaceAll("'","''")}' LIMIT 1`) as unknown[];
      return row?.[0] ?? null;
    },
    save: async (data) => {
      const p = await prisma();
      const now = new Date();
      await p.$executeRawUnsafe(
        `INSERT INTO Invite (groupName, actor, inviter, expiresAt, remainingUses, accepted, createdAt, updatedAt)
         VALUES ('${String((data as any).groupName).replaceAll("'","''")}', '${String((data as any).actor).replaceAll("'","''")}', ${ (data as any).inviter ? `'${String((data as any).inviter).replaceAll("'","''")}'` : 'NULL' }, ${ (data as any).expiresAt instanceof Date ? Math.floor(((data as any).expiresAt as Date).getTime()/1000) : 'NULL' }, ${Number((data as any).remainingUses ?? 1)}, ${ (data as any).accepted ? 1 : 0 }, ${Math.floor(now.getTime()/1000)}, ${Math.floor(now.getTime()/1000)})
         ON CONFLICT(groupName, actor) DO NOTHING`
      );
      const row = await p.$queryRawUnsafe(`SELECT * FROM Invite WHERE groupName='${String((data as any).groupName).replaceAll("'","''")}' AND actor='${String((data as any).actor).replaceAll("'","''")}' LIMIT 1`) as unknown[];
      return row?.[0] ?? null;
    },
    deleteOne: async (filter) => {
      const p = await prisma();
      const g = (filter as Record<string, unknown>).groupName as string | undefined;
      const a = (filter as Record<string, unknown>).actor as string | undefined;
      if (!g || !a) return;
      await p.$executeRawUnsafe(`DELETE FROM Invite WHERE groupName='${g.replaceAll("'","''")}' AND actor='${a.replaceAll("'","''")}'`);
    },
  };
  const approvals: ApprovalsRepo = {
    findOne: async (filter) => {
      const p = await prisma();
      const g = (filter as Record<string, unknown>).groupName as string | undefined;
      const a = (filter as Record<string, unknown>).actor as string | undefined;
      if (!g || !a) return null;
      const rows = await p.$queryRawUnsafe(`SELECT * FROM Approval WHERE groupName='${g.replaceAll("'","''")}' AND actor='${a.replaceAll("'","''")}' LIMIT 1`) as unknown[];
      return rows?.[0] ?? null;
    },
    findOneAndUpdate: async (filter, update, options) => {
      const p = await prisma();
      const g = (filter as Record<string, unknown>).groupName as string | undefined;
      const a = (filter as Record<string, unknown>).actor as string | undefined;
      if (!g || !a) return null;
      const now = new Date();
      const rows = await p.$queryRawUnsafe(`SELECT * FROM Approval WHERE groupName='${g.replaceAll("'","''")}' AND actor='${a.replaceAll("'","''")}' LIMIT 1`) as any[];
      const activity = (update as Record<string, unknown>).activity ?? null;
      if (!rows?.[0] && options?.upsert) {
        await p.$executeRawUnsafe(
          `INSERT INTO Approval (groupName, actor, activity, createdAt, updatedAt)
           VALUES ('${g.replaceAll("'","''")}', '${a.replaceAll("'","''")}', ${activity ? `'${JSON.stringify(activity).replaceAll("'","''")}'` : 'NULL'}, ${Math.floor(now.getTime()/1000)}, ${Math.floor(now.getTime()/1000)})`
        );
      } else {
        await p.$executeRawUnsafe(
          `UPDATE Approval SET activity=${activity ? `'${JSON.stringify(activity).replaceAll("'","''")}'` : 'NULL'}, updatedAt=${Math.floor(now.getTime()/1000)} WHERE groupName='${g.replaceAll("'","''")}' AND actor='${a.replaceAll("'","''")}'`
        );
      }
      const row = await p.$queryRawUnsafe(`SELECT * FROM Approval WHERE groupName='${g.replaceAll("'","''")}' AND actor='${a.replaceAll("'","''")}' LIMIT 1`) as unknown[];
      return row?.[0] ?? null;
    },
    deleteOne: async (filter) => {
      const p = await prisma();
      const g = (filter as Record<string, unknown>).groupName as string | undefined;
      const a = (filter as Record<string, unknown>).actor as string | undefined;
      if (!g || !a) return;
      await p.$executeRawUnsafe(`DELETE FROM Approval WHERE groupName='${g.replaceAll("'","''")}' AND actor='${a.replaceAll("'","''")}'`);
    },
  };
  const notifications: NotificationsRepo = {
    list: async (owner: string) => {
      const p = await prisma();
      return await p.notification.findMany({ where: { owner }, orderBy: { createdAt: "desc" } });
    },
    create: async (owner, title, message, type) => {
      const p = await prisma();
      return await p.notification.create({ data: { owner, title, message, type } });
    },
    markRead: async (id: string) => {
      const p = await prisma();
      await p.notification.update({ where: { id: Number(id) }, data: { read: 1 } });
      return true;
    },
    delete: async (id: string) => {
      const p = await prisma();
      await p.notification.delete({ where: { id: Number(id) } });
      return true;
    },
  };
  const system: SystemRepo = {
    findKey: async (d) => {
      const p = await prisma();
      // deno-lint-ignore no-explicit-any
      const row = await p.systemKey.findFirst({ where: { domain: d } }) as any;
      return row ? { domain: String(row.domain), privateKey: String(row.privateKey), publicKey: String(row.publicKey) } : null;
    },
    saveKey: async (d, priv, pub) => {
      const p = await prisma();
      await p.systemKey.upsert({
        where: { domain: d },
        // deno-lint-ignore no-explicit-any
        create: { domain: d, privateKey: priv, publicKey: pub } as any,
        update: { privateKey: priv, publicKey: pub },
      });
    },
    findRemoteActorByUrl: async (url: string) => {
      const p = await prisma();
      return await p.remoteActor.findFirst({ where: { actorUrl: url } });
    },
    findRemoteActorsByUrls: async (urls: string[]) => {
      const p = await prisma();
      return await p.remoteActor.findMany({ where: { actorUrl: { in: urls } } });
    },
    upsertRemoteActor: async (data) => {
      const p = await prisma();
      await p.remoteActor.upsert({
        where: { actorUrl: data.actorUrl },
        // deno-lint-ignore no-explicit-any
        create: { actorUrl: data.actorUrl, name: data.name, preferredUsername: data.preferredUsername, icon: JSON.stringify(data.icon ?? null), summary: data.summary } as any,
        update: { name: data.name, preferredUsername: data.preferredUsername, icon: JSON.stringify(data.icon ?? null), summary: data.summary, cachedAt: new Date() },
      });
    },
  };
  const sessions: SessionsRepo = {
    create: async (sessionId, expiresAt, deviceId) => {
      const p = await prisma();
      return await p.session.create({ data: { sessionId, deviceId, expiresAt } });
    },
    findById: async (sessionId) => {
      const p = await prisma();
      return await p.session.findFirst({ where: { sessionId } });
    },
    deleteById: async (sessionId) => {
      const p = await prisma();
      await p.session.delete({ where: { sessionId } });
    },
    updateExpires: async (sessionId, expires) => {
      const p = await prisma();
      await p.session.update({ where: { sessionId }, data: { expiresAt: expires } });
    },
    updateActivity: async (sessionId, date) => {
      const p = await prisma();
      await p.session.update({ where: { sessionId }, data: { lastDecryptAt: date ?? new Date() } });
    },
  };
  const fcm: FcmRepo = {
    register: async (token: string, userName: string) => {
      const p = await prisma();
      await p.fcmToken.upsert({
        where: { token },
        create: { token, userName },
        update: { userName },
      });
    },
    unregister: async (token: string) => {
      const p = await prisma();
      await p.fcmToken.delete({ where: { token } });
    },
    list: async () => {
      const p = await prisma();
      const rows = await p.fcmToken.findMany();
      // deno-lint-ignore no-explicit-any
      return (rows as any[]).map((r) => ({ token: String((r as any).token) }));
    },
  };
  const faspProviders: FaspProvidersRepo = {
    getSettings: async () => {
      const p = await prisma();
      // deno-lint-ignore no-explicit-any
      const row = await p.$queryRawUnsafe("SELECT id, shareEnabled, shareServerIds, searchServerId FROM FaspClientSettings WHERE id = 'default'") as any[];
      const s = row?.[0];
      if (!s) return null;
      return {
        shareEnabled: s.shareEnabled == null ? undefined : Number(s.shareEnabled) !== 0,
        shareServerIds: s.shareServerIds ? JSON.parse(String(s.shareServerIds)) : undefined,
        searchServerId: s.searchServerId ?? null,
      };
    },
    list: async (filter) => {
      const p = await prisma();
      if (filter && (filter as Record<string, unknown>).baseUrl) {
        return await p.$queryRawUnsafe(`SELECT * FROM FaspClientProvider WHERE baseUrl = '${String((filter as Record<string, unknown>).baseUrl).replaceAll("'", "''")}'`);
      }
      return await p.$queryRawUnsafe("SELECT * FROM FaspClientProvider ORDER BY status ASC, updatedAt DESC");
    },
    findOne: async (filter) => {
      const p = await prisma();
      if (filter && (filter as Record<string, unknown>).baseUrl) {
        const rows = await p.$queryRawUnsafe(`SELECT * FROM FaspClientProvider WHERE baseUrl = '${String((filter as Record<string, unknown>).baseUrl).replaceAll("'", "''")}' LIMIT 1`) as unknown[];
        return rows?.[0] ?? null;
      }
      return null;
    },
    upsertByBaseUrl: async (baseUrl, set, setOnInsert) => {
      const p = await prisma();
      const now = new Date();
      const data: Record<string, unknown> = {
        name: String(set.name ?? ""),
        serverId: String(set.serverId ?? ""),
        publicKey: String(set.publicKey ?? ""),
        status: String(set.status ?? "pending"),
      };
      if (setOnInsert && (setOnInsert as Record<string, unknown>).faspId) {
        data["faspId"] = String((setOnInsert as Record<string, unknown>).faspId);
      }
      await p.$executeRawUnsafe(
        `INSERT INTO FaspClientProvider (baseUrl, name, serverId, publicKey, status, faspId, updatedAt, createdAt)
         VALUES ('${baseUrl.replaceAll("'", "''")}', '${String(data.name).replaceAll("'", "''")}', '${String(data.serverId).replaceAll("'", "''")}', '${String(data.publicKey).replaceAll("'", "''")}', '${String(data.status).replaceAll("'", "''")}', ${data.faspId ? `'${String(data.faspId).replaceAll("'", "''")}'` : 'NULL'}, ${Math.floor(now.getTime()/1000)}, ${Math.floor(now.getTime()/1000)})
         ON CONFLICT(baseUrl) DO UPDATE SET name=excluded.name, serverId=excluded.serverId, publicKey=excluded.publicKey, status=excluded.status, faspId=COALESCE(FaspClientProvider.faspId, excluded.faspId), updatedAt=excluded.updatedAt`
      );
    },
    updateByBaseUrl: async (baseUrl, update) => {
      const p = await prisma();
      const fields: string[] = [];
      for (const [k, v] of Object.entries(update)) {
        if (v === undefined) continue;
        if (v instanceof Date) fields.push(`${k} = ${Math.floor(v.getTime()/1000)}`);
        else fields.push(`${k} = '${String(v).replaceAll("'", "''")}'`);
      }
      if (fields.length === 0) return null;
      await p.$executeRawUnsafe(`UPDATE FaspClientProvider SET ${fields.join(", ")}, updatedAt = ${Math.floor(Date.now()/1000)} WHERE baseUrl = '${baseUrl.replaceAll("'", "''")}'`);
      const rows = await p.$queryRawUnsafe(`SELECT * FROM FaspClientProvider WHERE baseUrl = '${baseUrl.replaceAll("'", "''")}' LIMIT 1`) as unknown[];
      return rows?.[0] ?? null;
    },
    deleteOne: async (filter) => {
      const p = await prisma();
      if (!filter || !(filter as Record<string, unknown>).baseUrl) return { deletedCount: 0 };
      const base = String((filter as Record<string, unknown>).baseUrl).replaceAll("'", "''");
      const before = await p.$queryRawUnsafe(`SELECT COUNT(1) as c FROM FaspClientProvider WHERE baseUrl = '${base}'`) as { c: number }[];
      await p.$executeRawUnsafe(`DELETE FROM FaspClientProvider WHERE baseUrl = '${base}'`);
      return { deletedCount: Number(before?.[0]?.c ?? 0) > 0 ? 1 : 0 };
    },
    registrationUpsert: async (data) => {
      const p = await prisma();
      const now = new Date();
      await p.$executeRawUnsafe(
        `INSERT INTO FaspClientProvider (baseUrl, name, serverId, publicKey, status, faspId, updatedAt, createdAt)
         VALUES ('${data.baseUrl.replaceAll("'", "''")}', '${data.name.replaceAll("'", "''")}', '${data.serverId.replaceAll("'", "''")}', '${data.publicKey.replaceAll("'", "''")}', 'pending', '${data.faspId.replaceAll("'", "''")}', ${Math.floor(now.getTime()/1000)}, ${Math.floor(now.getTime()/1000)})
         ON CONFLICT(baseUrl) DO UPDATE SET name=excluded.name, serverId=excluded.serverId, publicKey=excluded.publicKey, status='pending', updatedAt=excluded.updatedAt`
      );
    },
    listProviders: async () => {
      const p = await prisma();
      return await p.$queryRawUnsafe("SELECT * FROM FaspClientProvider ORDER BY status ASC, updatedAt DESC");
    },
    insertEventSubscription: async (id, payload) => {
      const p = await prisma();
      await p.$executeRawUnsafe(
        `INSERT OR REPLACE INTO FaspEventSubscription (id, payload) VALUES ('${String(id).replaceAll("'", "''")}', '${JSON.stringify(payload).replaceAll("'", "''")}')`
      );
    },
    deleteEventSubscription: async (id) => {
      const p = await prisma();
      await p.$executeRawUnsafe(`DELETE FROM FaspEventSubscription WHERE id = '${String(id).replaceAll("'", "''")}'`);
    },
    createBackfill: async (id, payload) => {
      const p = await prisma();
      await p.$executeRawUnsafe(
        `INSERT OR REPLACE INTO FaspBackfill (id, payload, status) VALUES ('${String(id).replaceAll("'", "''")}', '${JSON.stringify(payload).replaceAll("'", "''")}', 'pending')`
      );
    },
    continueBackfill: async (id) => {
      const p = await prisma();
      await p.$executeRawUnsafe(
        `UPDATE FaspBackfill SET continuedAt = ${Math.floor(Date.now()/1000)} WHERE id = '${String(id).replaceAll("'", "''")}'`
      );
    },
  };

  const store: DataStore = {
    storage,
    accounts,
    posts,
    dms,
    groups,
    invites,
    approvals,
    notifications,
    system,
    sessions,
    fcm,
    faspProviders,
    raw: async () => await prisma(),
  };

  return store;
}

export default createPrismaDataStore;
