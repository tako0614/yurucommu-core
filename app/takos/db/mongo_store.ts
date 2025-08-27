import { LegacyDBAdapter } from "../../core/db/legacy_adapter.ts";
import type { DataStore } from "../../shared/db_port.ts";
import { MongoDB } from "./mongo.ts";

/**
 * 既存の MongoDB 実装 (MongoDB クラス) を新しい DataStore に束ねる薄い実装。
 * 段階的移行のため、まずは LegacyDBAdapter 経由で旧 API を満たします。
 */
export function createMongoDataStore(env: Record<string, string>): DataStore {
  const impl = new MongoDB(env);
  const tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  return {
    tenantId,
    // 既存クラスのメソッドをドメインごとに束ねる
    accounts: {
      list: () => impl.listAccounts(),
      create: (d) => impl.createAccount(d),
      findById: (id) => impl.findAccountById(id),
      findByUserName: (u) => impl.findAccountByUserName(u),
      updateById: (id, up) => impl.updateAccountById(id, up),
      deleteById: (id) => impl.deleteAccountById(id),
      addFollower: (id, f) => impl.addFollower(id, f),
      removeFollower: (id, f) => impl.removeFollower(id, f),
      addFollowing: (id, t) => impl.addFollowing(id, t),
      removeFollowing: (id, t) => impl.removeFollowing(id, t),
      addFollowerByName: (u, f) => impl.addFollowerByName(u, f),
      removeFollowerByName: (u, f) => impl.removeFollowerByName(u, f),
      search: (q, l) => impl.searchAccounts(q, l),
      updateByUserName: (u, up) => impl.updateAccountByUserName(u, up),
      findByUserNames: (u) => impl.findAccountsByUserNames(u),
      count: () => impl.countAccounts(),
    },
    posts: {
      findNoteById: (id) => impl.findNoteById(id),
      findMessageById: (id) => impl.findMessageById(id),
      findAttachmentById: (id) => impl.findAttachmentById(id),
      saveObject: (o) => impl.saveObject(o),
      listTimeline: (a, o) => impl.listTimeline(a, o),
      follow: (f, t) => impl.follow(f, t),
      unfollow: (f, t) => impl.unfollow?.(f, t),
      saveNote: (d, a, c, e, aud) => impl.saveNote(d, a, c, e, aud),
      updateNote: (id, up) => impl.updateNote(id, up),
      deleteNote: (id) => impl.deleteNote(id),
      // deno-lint-ignore no-explicit-any
      findNotes: (f, s) => impl.findNotes(f, s as any),
      getPublicNotes: (l, b) => impl.getPublicNotes(l, b),
      saveMessage: (d, a, c, e, aud) => impl.saveMessage(d, a, c, e, aud),
      updateMessage: (id, up) => impl.updateMessage(id, up),
      deleteMessage: (id) => impl.deleteMessage(id),
      // deno-lint-ignore no-explicit-any
      findMessages: (f, s) => impl.findMessages(f, s as any),
      updateObject: (id, up) => impl.updateObject(id, up),
      deleteObject: (id) => impl.deleteObject(id),
      deleteManyObjects: (f) => impl.deleteManyObjects(f),
    },
    dms: {
      save: (
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
      ) =>
        impl.saveDMMessage(
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
        ),
      listBetween: (u1, u2) => impl.listDMsBetween(u1, u2),
      list: (o) => impl.listDirectMessages(o),
      create: (d) => impl.createDirectMessage(d),
      update: (o, id, up) => impl.updateDirectMessage(o, id, up),
      delete: (o, id) => impl.deleteDirectMessage(o, id),
    },
    groups: {
      list: (m) => impl.listGroups(m),
      findByName: (n) => impl.findGroupByName(n),
      create: (d) => impl.createGroup(d),
      updateByName: (n, u) => impl.updateGroupByName(n, u),
      addFollower: (n, a) => impl.addGroupFollower(n, a),
      removeFollower: (n, a) => impl.removeGroupFollower(n, a),
      pushOutbox: (n, act) => impl.pushGroupOutbox(n, act),
    },
    notifications: {
      list: (o) => impl.listNotifications(o),
      create: (o, t, m, ty) => impl.createNotification(o, t, m, ty),
      markRead: (id) => impl.markNotificationRead(id),
      delete: (id) => impl.deleteNotification(id),
    },
    system: {
      findKey: (d) => impl.findSystemKey(d),
      saveKey: (d, pk, pub) => impl.saveSystemKey(d, pk, pub),
      findRemoteActorByUrl: (u) => impl.findRemoteActorByUrl(u),
      findRemoteActorsByUrls: (u) => impl.findRemoteActorsByUrls(u),
      upsertRemoteActor: (data) => impl.upsertRemoteActor(data),
    },
    sessions: {
      create: (id, exp, dev) => impl.createSession(id, exp, dev),
      findById: (id) => impl.findSessionById(id),
      deleteById: (id) => impl.deleteSessionById(id),
      updateExpires: (id, exp) => impl.updateSessionExpires(id, exp),
      updateActivity: (id, d) => impl.updateSessionActivity(id, d),
    },
    fcm: {
      register: (t, u) => impl.registerFcmToken(t, u),
      unregister: (t) => impl.unregisterFcmToken(t),
      list: () => impl.listFcmTokens(),
    },
    tenant: { ensure: (id, d) => impl.ensureTenant(id, d) },
    host: {
      listInstances: (o) => impl.listInstances(o),
      countInstances: (o) => impl.countInstances(o),
      findInstanceByHost: (h) => impl.findInstanceByHost(h),
      findInstanceByHostAndOwner: (h, o) =>
        impl.findInstanceByHostAndOwner(h, o),
      createInstance: (d) => impl.createInstance(d),
      updateInstanceEnv: (id, env) => impl.updateInstanceEnv(id, env),
      deleteInstance: (h, o) => impl.deleteInstance(h, o),
    },
    oauth: {
      list: () => impl.listOAuthClients(),
      find: (id) => impl.findOAuthClient(id),
      create: (d) => impl.createOAuthClient(d),
    },
    domains: {
      list: (u) => impl.listHostDomains(u),
      find: (d, u) => impl.findHostDomain(d, u),
      create: (d, u, t) => impl.createHostDomain(d, u, t),
      verify: (id) => impl.verifyHostDomain(id),
    },
    raw: () => impl.getDatabase(),
  };
}

/** 旧 API (DB) を返したい場合のヘルパー */
export function createLegacyDBFromMongo(env: Record<string, string>) {
  return new LegacyDBAdapter(createMongoDataStore(env));
}
