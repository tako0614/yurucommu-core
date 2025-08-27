import type { DB, ListOpts, SortSpec, DataStore } from "@takos/db";
import type { DirectMessageDoc } from "@takos/types";

/** 既存の DB インターフェースを新しい DataStore にアダプト */
export class LegacyDBAdapter implements DB {
  constructor(private readonly store: DataStore) {}

  get tenantId() {
    return this.store.tenantId;
  }

  // takos host（マルチテナント）判定用のヒント
  get multiTenant() {
    // deno-lint-ignore no-explicit-any
    return (this.store as any).multiTenant === true;
  }

  // Posts / objects
  findNoteById(id: string) {
    return this.store.posts.findNoteById(id);
  }
  findMessageById(id: string) {
    return this.store.posts.findMessageById(id);
  }
  findAttachmentById(id: string) {
    return this.store.posts.findAttachmentById(id);
  }
  saveObject(obj: Record<string, unknown>) {
    return this.store.posts.saveObject(obj);
  }
  listTimeline(actor: string, opts: ListOpts) {
    return this.store.posts.listTimeline(actor, opts);
  }
  follow(f: string, t: string) {
    return this.store.posts.follow(f, t);
  }
  unfollow?(f: string, t: string) {
    return this.store.posts.unfollow?.(f, t);
  }
  saveNote(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud?: { to: string[]; cc: string[] },
  ) {
    return this.store.posts.saveNote(domain, author, content, extra, aud);
  }
  updateNote(id: string, update: Record<string, unknown>) {
    return this.store.posts.updateNote(id, update);
  }
  deleteNote(id: string) {
    return this.store.posts.deleteNote(id);
  }
  findNotes(filter: Record<string, unknown>, sort?: SortSpec) {
    return this.store.posts.findNotes(filter, sort);
  }
  getPublicNotes(limit: number, before?: Date) {
    return this.store.posts.getPublicNotes(limit, before);
  }
  saveMessage(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud: { to: string[]; cc: string[] },
  ) {
    return this.store.posts.saveMessage(domain, author, content, extra, aud);
  }
  updateMessage(id: string, update: Record<string, unknown>) {
    return this.store.posts.updateMessage(id, update);
  }
  deleteMessage(id: string) {
    return this.store.posts.deleteMessage(id);
  }
  findMessages(filter: Record<string, unknown>, sort?: SortSpec) {
    return this.store.posts.findMessages(filter, sort);
  }
  updateObject(id: string, update: Record<string, unknown>) {
    return this.store.posts.updateObject(id, update);
  }
  deleteObject(id: string) {
    return this.store.posts.deleteObject(id);
  }
  deleteManyObjects(filter: Record<string, unknown>) {
    return this.store.posts.deleteManyObjects(filter);
  }

  // Accounts
  listAccounts() {
    return this.store.accounts.list();
  }
  createAccount(data: Record<string, unknown>) {
    return this.store.accounts.create(data);
  }
  findAccountById(id: string) {
    return this.store.accounts.findById(id);
  }
  findAccountByUserName(username: string) {
    return this.store.accounts.findByUserName(username);
  }
  updateAccountById(id: string, update: Record<string, unknown>) {
    return this.store.accounts.updateById(id, update);
  }
  deleteAccountById(id: string) {
    return this.store.accounts.deleteById(id);
  }
  addFollower(id: string, follower: string) {
    return this.store.accounts.addFollower(id, follower);
  }
  removeFollower(id: string, follower: string) {
    return this.store.accounts.removeFollower(id, follower);
  }
  addFollowing(id: string, target: string) {
    return this.store.accounts.addFollowing(id, target);
  }
  removeFollowing(id: string, target: string) {
    return this.store.accounts.removeFollowing(id, target);
  }
  addFollowerByName(username: string, follower: string) {
    return this.store.accounts.addFollowerByName(username, follower);
  }
  removeFollowerByName(username: string, follower: string) {
    return this.store.accounts.removeFollowerByName(username, follower);
  }
  searchAccounts(q: RegExp, l?: number) {
    return this.store.accounts.search(q, l);
  }
  updateAccountByUserName(u: string, up: Record<string, unknown>) {
    return this.store.accounts.updateByUserName(u, up);
  }
  findAccountsByUserNames(u: string[]) {
    return this.store.accounts.findByUserNames(u);
  }
  countAccounts() {
    return this.store.accounts.count();
  }

  // DMs
  saveDMMessage(
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
  ) {
    return this.store.dms.save(
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
    );
  }
  listDMsBetween(u1: string, u2: string) {
    return this.store.dms.listBetween(u1, u2);
  }
  listDirectMessages(owner: string) {
    return this.store.dms.list(owner);
  }
  createDirectMessage(data: DirectMessageDoc) {
    return this.store.dms.create(data);
  }
  updateDirectMessage(
    owner: string,
    id: string,
    update: Record<string, unknown>,
  ) {
    return this.store.dms.update(owner, id, update);
  }
  deleteDirectMessage(owner: string, id: string) {
    return this.store.dms.delete(owner, id);
  }

  // Groups
  listGroups(m: string) {
    return this.store.groups.list(m);
  }
  findGroupByName(n: string) {
    return this.store.groups.findByName(n);
  }
  createGroup(d: Record<string, unknown>) {
    return this.store.groups.create(d);
  }
  updateGroupByName(n: string, u: Record<string, unknown>) {
    return this.store.groups.updateByName(n, u);
  }
  addGroupFollower(n: string, a: string) {
    return this.store.groups.addFollower(n, a);
  }
  removeGroupFollower(n: string, a: string) {
    return this.store.groups.removeFollower(n, a);
  }
  pushGroupOutbox(n: string, act: Record<string, unknown>) {
    return this.store.groups.pushOutbox(n, act);
  }

  // Notifications
  listNotifications(o: string) {
    return this.store.notifications.list(o);
  }
  createNotification(o: string, t: string, m: string, ty: string) {
    return this.store.notifications.create(o, t, m, ty);
  }
  markNotificationRead(id: string) {
    return this.store.notifications.markRead(id);
  }
  deleteNotification(id: string) {
    return this.store.notifications.delete(id);
  }

  // System / remote
  findSystemKey(d: string) {
    return this.store.system.findKey(d);
  }
  saveSystemKey(d: string, pk: string, pub: string) {
    return this.store.system.saveKey(d, pk, pub);
  }
  findRemoteActorByUrl(u: string) {
    return this.store.system.findRemoteActorByUrl(u);
  }
  findRemoteActorsByUrls(u: string[]) {
    return this.store.system.findRemoteActorsByUrls(u);
  }
  upsertRemoteActor(
    data: {
      actorUrl: string;
      name: string;
      preferredUsername: string;
      icon: unknown;
      summary: string;
    },
  ) {
    return this.store.system.upsertRemoteActor(data);
  }

  // Sessions
  createSession(id: string, exp: Date, dev: string) {
    return this.store.sessions.create(id, exp, dev);
  }
  findSessionById(id: string) {
    return this.store.sessions.findById(id);
  }
  deleteSessionById(id: string) {
    return this.store.sessions.deleteById(id);
  }
  updateSessionExpires(id: string, exp: Date) {
    return this.store.sessions.updateExpires(id, exp);
  }
  updateSessionActivity(id: string, d?: Date) {
    return this.store.sessions.updateActivity(id, d);
  }

  // FCM
  registerFcmToken(t: string, u: string) {
    return this.store.fcm.register(t, u);
  }
  unregisterFcmToken(t: string) {
    return this.store.fcm.unregister(t);
  }
  listFcmTokens() {
    return this.store.fcm.list();
  }

  // Tenant
  ensureTenant(id: string, domain: string) {
    return this.store.tenant.ensure(id, domain);
  }

  // Host
  listInstances(o: string) {
    return this.store.host.listInstances(o);
  }
  countInstances(o: string) {
    return this.store.host.countInstances(o);
  }
  findInstanceByHost(h: string) {
    return this.store.host.findInstanceByHost(h);
  }
  findInstanceByHostAndOwner(h: string, o: string) {
    return this.store.host.findInstanceByHostAndOwner(h, o);
  }
  createInstance(
    d: { host: string; owner: string; env?: Record<string, string> },
  ) {
    return this.store.host.createInstance(d);
  }
  updateInstanceEnv(id: string, env: Record<string, string>) {
    return this.store.host.updateInstanceEnv(id, env);
  }
  deleteInstance(h: string, o: string) {
    return this.store.host.deleteInstance(h, o);
  }

  // OAuth
  listOAuthClients() {
    return this.store.oauth.list();
  }
  findOAuthClient(id: string) {
    return this.store.oauth.find(id);
  }
  createOAuthClient(
    d: { clientId: string; clientSecret: string; redirectUri: string },
  ) {
    return this.store.oauth.create(d);
  }

  // Domains
  listHostDomains(u: string) {
    return this.store.domains.list(u);
  }
  findHostDomain(d: string, u?: string) {
    return this.store.domains.find(d, u);
  }
  createHostDomain(d: string, u: string, t: string) {
    return this.store.domains.create(d, u, t);
  }
  verifyHostDomain(id: string) {
    return this.store.domains.verify(id);
  }

  // raw (実装依存)
  getDatabase() {
    return this.store.raw
      ? this.store.raw()
      : Promise.resolve(undefined as unknown);
  }
}
