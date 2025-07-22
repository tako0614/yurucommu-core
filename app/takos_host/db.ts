import HostObjectStore from "../api/models/takos_host/object_store.ts";
import HostFollowEdge from "../api/models/takos_host/follow_edge.ts";
import HostRelayEdge from "../api/models/takos_host/relay_edge.ts";
import { createObjectId } from "../api/utils/activitypub.ts";
import Account from "../api/models/takos_host/account.ts";
import EncryptedKeyPair from "../api/models/takos_host/encrypted_keypair.ts";
import EncryptedMessage from "../api/models/takos_host/encrypted_message.ts";
import KeyPackage from "../api/models/takos_host/key_package.ts";
import Notification from "../api/models/takos_host/notification.ts";
import PublicMessage from "../api/models/takos_host/public_message.ts";
import Relay from "../api/models/takos_host/relay.ts";
import RemoteActor from "../api/models/takos_host/remote_actor.ts";
import HostSession from "./models/session.ts";
import mongoose from "mongoose";
import type { DB, ListOpts } from "../shared/db.ts";
import type { AccountDoc, RelayDoc, SessionDoc } from "../shared/types.ts";
import type { SortOrder } from "mongoose";
import type { Db } from "mongodb";
import { connectDatabase } from "../shared/db.ts";

/** takos host 用 MongoDB 実装 */
export class MongoDBHost implements DB {
  constructor(private env: Record<string, string>) {}

  private get tenantId() {
    return this.env["ACTIVITYPUB_DOMAIN"] ?? "";
  }

  async getObject(id: string) {
    return await HostObjectStore.findOne({
      _id: id,
      tenant_id: this.tenantId,
    }).lean();
  }

  async saveObject(obj: Record<string, unknown>) {
    const data = { ...obj };
    if (!data._id) {
      data._id = createObjectId(this.tenantId);
    }
    const doc = new HostObjectStore({ ...data, tenant_id: this.tenantId });
    await doc.save();
    return doc.toObject();
  }

  async listTimeline(actor: string, opts: ListOpts) {
    const docs = await HostFollowEdge.aggregate([
      { $match: { tenant_id: this.tenantId } },
      {
        $lookup: {
          from: "object_store",
          localField: "actor_id",
          foreignField: "actor_id",
          as: "objs",
        },
      },
      { $unwind: "$objs" },
      { $match: { "objs.actor_id": actor } },
      { $sort: { "objs.created_at": -1 } },
      { $limit: opts.limit ?? 40 },
    ]).exec();
    return docs.map((d) => d.objs);
  }

  async follow(_: string, target: string) {
    await HostFollowEdge.updateOne(
      { tenant_id: this.tenantId, actor_id: target },
      { $setOnInsert: { since: new Date() } },
      { upsert: true },
    );
  }

  async unfollow(_: string, target: string) {
    await HostFollowEdge.deleteOne({
      tenant_id: this.tenantId,
      actor_id: target,
    });
  }

  async listAccounts(): Promise<AccountDoc[]> {
    return await Account.find({}).lean<AccountDoc[]>();
  }

  async createAccount(data: Record<string, unknown>): Promise<AccountDoc> {
    const doc = new Account({
      ...data,
      tenant_id: this.tenantId,
    });
    await doc.save();
    return doc.toObject() as AccountDoc;
  }

  async findAccountById(id: string): Promise<AccountDoc | null> {
    return await Account.findOne({ _id: id }).lean<AccountDoc | null>();
  }

  async findAccountByUserName(
    username: string,
  ): Promise<AccountDoc | null> {
    return await Account.findOne({ userName: username }).lean<
      AccountDoc | null
    >();
  }

  async updateAccountById(
    id: string,
    update: Record<string, unknown>,
  ): Promise<AccountDoc | null> {
    return await Account.findOneAndUpdate({ _id: id }, update, { new: true })
      .lean<AccountDoc | null>();
  }

  async deleteAccountById(id: string) {
    const res = await Account.findOneAndDelete({ _id: id });
    return !!res;
  }

  async addFollower(id: string, follower: string) {
    const acc = await Account.findOneAndUpdate({ _id: id }, {
      $addToSet: { followers: follower },
    }, { new: true });
    return acc?.followers ?? [];
  }

  async removeFollower(id: string, follower: string) {
    const acc = await Account.findOneAndUpdate({ _id: id }, {
      $pull: { followers: follower },
    }, { new: true });
    return acc?.followers ?? [];
  }

  async addFollowing(id: string, target: string) {
    const acc = await Account.findOneAndUpdate({ _id: id }, {
      $addToSet: { following: target },
    }, { new: true });
    return acc?.following ?? [];
  }

  async removeFollowing(id: string, target: string) {
    const acc = await Account.findOneAndUpdate({ _id: id }, {
      $pull: { following: target },
    }, { new: true });
    return acc?.following ?? [];
  }

  async saveNote(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud?: { to: string[]; cc: string[] },
  ) {
    const id = createObjectId(domain);
    const actor = `https://${domain}/users/${author}`;
    const doc = new HostObjectStore({
      _id: id,
      type: "Note",
      attributedTo: author,
      actor_id: actor,
      content,
      extra,
      tenant_id: this.tenantId,
      published: new Date(),
      aud: aud ?? {
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        cc: [],
      },
    });
    await doc.save();
    return doc.toObject();
  }

  async updateNote(id: string, update: Record<string, unknown>) {
    return await HostObjectStore.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId, type: "Note" },
      update,
      { new: true },
    ).lean();
  }

  async deleteNote(id: string) {
    const res = await HostObjectStore.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
      type: "Note",
    });
    return !!res;
  }

  async findNotes(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await HostObjectStore.find({
      ...filter,
      tenant_id: this.tenantId,
      type: "Note",
    }).sort(sort ?? {}).lean();
  }

  async getPublicNotes(limit: number, before?: Date) {
    const query = HostObjectStore.find({
      tenant_id: this.tenantId,
      type: "Note",
      "aud.to": "https://www.w3.org/ns/activitystreams#Public",
    });
    if (before) query.where("created_at").lt(before.getTime());
    return await query.sort({ created_at: -1 }).limit(limit).lean();
  }

  async saveVideo(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud?: { to: string[]; cc: string[] },
  ) {
    const id = createObjectId(domain);
    const actor = `https://${domain}/users/${author}`;
    const doc = new HostObjectStore({
      _id: id,
      type: "Video",
      attributedTo: author,
      actor_id: actor,
      content,
      extra,
      tenant_id: this.tenantId,
      published: new Date(),
      aud: aud ?? {
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        cc: [],
      },
    });
    await doc.save();
    return doc.toObject();
  }

  async updateVideo(id: string, update: Record<string, unknown>) {
    return await HostObjectStore.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId, type: "Video" },
      update,
      { new: true },
    ).lean();
  }

  async deleteVideo(id: string) {
    const res = await HostObjectStore.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
      type: "Video",
    });
    return !!res;
  }

  async findVideos(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await HostObjectStore.find({
      ...filter,
      tenant_id: this.tenantId,
      type: "Video",
    }).sort(sort ?? {}).lean();
  }

  async saveMessage(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud: { to: string[]; cc: string[] },
  ) {
    const id = createObjectId(domain);
    const actor = `https://${domain}/users/${author}`;
    const doc = new HostObjectStore({
      _id: id,
      type: "Message",
      attributedTo: author,
      actor_id: actor,
      content,
      extra,
      tenant_id: this.tenantId,
      published: new Date(),
      aud,
    });
    await doc.save();
    return doc.toObject();
  }

  async updateMessage(id: string, update: Record<string, unknown>) {
    return await HostObjectStore.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId, type: "Message" },
      update,
      { new: true },
    ).lean();
  }

  async deleteMessage(id: string) {
    const res = await HostObjectStore.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
      type: "Message",
    });
    return !!res;
  }

  async findMessages(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await HostObjectStore.find({
      ...filter,
      tenant_id: this.tenantId,
      type: "Message",
    }).sort(sort ?? {}).lean();
  }

  async findObjects(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await HostObjectStore.find({
      ...filter,
      tenant_id: this.tenantId,
    }).sort(sort ?? {}).lean();
  }

  async updateObject(id: string, update: Record<string, unknown>) {
    return await HostObjectStore.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      update,
      { new: true },
    ).lean();
  }

  async deleteObject(id: string) {
    const res = await HostObjectStore.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    return !!res;
  }

  async deleteManyObjects(filter: Record<string, unknown>) {
    return await HostObjectStore.deleteMany({
      ...filter,
      tenant_id: this.tenantId,
    });
  }

  async listPushRelays() {
    const docs = await HostRelayEdge.find({
      tenant_id: this.tenantId,
      mode: "push",
    }).lean<{ relay: string }[]>();
    return docs.map((d) => d.relay);
  }

  async listPullRelays() {
    const docs = await HostRelayEdge.find({
      tenant_id: this.tenantId,
      mode: "pull",
    }).lean<{ relay: string }[]>();
    return docs.map((d) => d.relay);
  }

  async addRelay(relay: string, mode: "pull" | "push" = "pull") {
    await HostRelayEdge.updateOne(
      { tenant_id: this.tenantId, relay, mode },
      { $setOnInsert: { since: new Date() } },
      { upsert: true },
    );
  }

  async removeRelay(relay: string) {
    await HostRelayEdge.deleteMany({ tenant_id: this.tenantId, relay });
  }

  async addFollowerByName(username: string, follower: string) {
    await Account.updateOne({ userName: username }, {
      $addToSet: { followers: follower },
    });
  }

  async removeFollowerByName(username: string, follower: string) {
    await Account.updateOne({ userName: username }, {
      $pull: { followers: follower },
    });
  }

  async searchAccounts(
    query: RegExp,
    limit = 20,
  ): Promise<AccountDoc[]> {
    return await Account.find({
      $or: [{ userName: query }, { displayName: query }],
    })
      .limit(limit)
      .lean<AccountDoc[]>();
  }

  async updateAccountByUserName(
    username: string,
    update: Record<string, unknown>,
  ) {
    await Account.updateOne({ userName: username }, update);
  }

  async findAccountsByUserNames(
    usernames: string[],
  ): Promise<AccountDoc[]> {
    return await Account.find({ userName: { $in: usernames } }).lean<
      AccountDoc[]
    >();
  }

  async countAccounts() {
    return await Account.countDocuments({});
  }

  async createEncryptedMessage(data: {
    from: string;
    to: string[];
    content: string;
    mediaType?: string;
    encoding?: string;
  }) {
    const doc = await EncryptedMessage.create({
      from: data.from,
      to: data.to,
      content: data.content,
      mediaType: data.mediaType ?? "message/mls",
      encoding: data.encoding ?? "base64",
    });
    return doc.toObject();
  }

  async findEncryptedMessages(
    condition: Record<string, unknown>,
    opts: { before?: string; after?: string; limit?: number } = {},
  ) {
    const query = EncryptedMessage.find(condition);
    if (opts.before) {
      query.where("createdAt").lt(new Date(opts.before) as unknown as number);
    }
    if (opts.after) {
      query.where("createdAt").gt(new Date(opts.after) as unknown as number);
    }
    const list = await query
      .sort({ createdAt: -1 })
      .limit(opts.limit ?? 50)
      .lean();
    return list;
  }

  async findEncryptedKeyPair(userName: string) {
    return await EncryptedKeyPair.findOne({ userName }).lean();
  }

  async upsertEncryptedKeyPair(userName: string, content: string) {
    await EncryptedKeyPair.findOneAndUpdate({ userName }, { content }, {
      upsert: true,
    });
  }

  async deleteEncryptedKeyPair(userName: string) {
    await EncryptedKeyPair.deleteOne({ userName });
  }

  async listKeyPackages(userName: string) {
    const tenantId = this.tenantId;
    return await KeyPackage.find({ userName, tenant_id: tenantId }).lean();
  }

  async findKeyPackage(userName: string, id: string) {
    const tenantId = this.tenantId;
    return await KeyPackage.findOne({ _id: id, userName, tenant_id: tenantId })
      .lean();
  }

  async createKeyPackage(
    userName: string,
    content: string,
    mediaType = "message/mls",
    encoding = "base64",
  ) {
    const doc = new KeyPackage({
      userName,
      content,
      mediaType,
      encoding,
      tenant_id: this.tenantId,
    });
    (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals =
      {
        env: this.env,
      };
    await doc.save();
    return doc.toObject();
  }

  async deleteKeyPackage(userName: string, id: string) {
    await KeyPackage.deleteOne({
      _id: id,
      userName,
      tenant_id: this.tenantId,
    });
  }

  async deleteKeyPackagesByUser(userName: string) {
    await KeyPackage.deleteMany({ userName, tenant_id: this.tenantId });
  }

  async createPublicMessage(data: {
    from: string;
    to: string[];
    content: string;
    mediaType?: string;
    encoding?: string;
  }) {
    const doc = new PublicMessage({
      from: data.from,
      to: data.to,
      content: data.content,
      mediaType: data.mediaType ?? "message/mls",
      encoding: data.encoding ?? "base64",
      tenant_id: this.tenantId,
    });
    (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals =
      {
        env: this.env,
      };
    await doc.save();
    return doc.toObject();
  }

  async findPublicMessages(
    condition: Record<string, unknown>,
    opts: { before?: string; after?: string; limit?: number } = {},
  ) {
    const query = PublicMessage.find({
      ...condition,
      tenant_id: this.tenantId,
    });
    if (opts.before) {
      query.where("createdAt").lt(new Date(opts.before) as unknown as number);
    }
    if (opts.after) {
      query.where("createdAt").gt(new Date(opts.after) as unknown as number);
    }
    const list = await query
      .sort({ createdAt: -1 })
      .limit(opts.limit ?? 50)
      .lean();
    return list;
  }

  async listNotifications() {
    return await Notification.find({ tenant_id: this.tenantId })
      .sort({ createdAt: -1 })
      .lean();
  }

  async createNotification(title: string, message: string, type: string) {
    const doc = new Notification({ title, message, type });
    (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals =
      {
        env: this.env,
      };
    await doc.save();
    return doc.toObject();
  }

  async markNotificationRead(id: string) {
    const res = await Notification.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      { read: true },
    );
    return !!res;
  }

  async deleteNotification(id: string) {
    const res = await Notification.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    return !!res;
  }

  async findRelaysByHosts(hosts: string[]): Promise<RelayDoc[]> {
    const docs = await Relay.find({ host: { $in: hosts } }).lean<
      { _id: mongoose.Types.ObjectId; host: string; inboxUrl: string }[]
    >();
    return docs.map((d) => ({
      _id: String(d._id),
      host: d.host,
      inboxUrl: d.inboxUrl,
    }));
  }

  async findRelayByHost(host: string): Promise<RelayDoc | null> {
    const doc = await Relay.findOne({ host }).lean<
      { _id: mongoose.Types.ObjectId; host: string; inboxUrl: string } | null
    >();
    return doc
      ? { _id: String(doc._id), host: doc.host, inboxUrl: doc.inboxUrl }
      : null;
  }

  async createRelay(
    data: { host: string; inboxUrl: string },
  ): Promise<RelayDoc> {
    const doc = new Relay({ host: data.host, inboxUrl: data.inboxUrl });
    await doc.save();
    return { _id: String(doc._id), host: doc.host, inboxUrl: doc.inboxUrl };
  }

  async deleteRelayById(id: string): Promise<RelayDoc | null> {
    const doc = await Relay.findByIdAndDelete(id).lean<
      { _id: mongoose.Types.ObjectId; host: string; inboxUrl: string } | null
    >();
    return doc
      ? { _id: String(doc._id), host: doc.host, inboxUrl: doc.inboxUrl }
      : null;
  }

  async findRemoteActorByUrl(url: string) {
    return await RemoteActor.findOne({ actorUrl: url }).lean();
  }

  async findRemoteActorsByUrls(urls: string[]) {
    return await RemoteActor.find({ actorUrl: { $in: urls } }).lean();
  }

  async upsertRemoteActor(data: {
    actorUrl: string;
    name: string;
    preferredUsername: string;
    icon: unknown;
    summary: string;
  }) {
    await RemoteActor.findOneAndUpdate(
      { actorUrl: data.actorUrl },
      {
        name: data.name,
        preferredUsername: data.preferredUsername,
        icon: data.icon,
        summary: data.summary,
        cachedAt: new Date(),
      },
      { upsert: true },
    );
  }

  async createSession(
    sessionId: string,
    expiresAt: Date,
    tenantId: string,
  ): Promise<SessionDoc> {
    const doc = new HostSession({
      sessionId,
      expiresAt,
      tenant_id: tenantId,
    });
    (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals =
      {
        env: this.env,
      };
    await doc.save();
    return doc.toObject() as SessionDoc;
  }

  async findSessionById(sessionId: string): Promise<SessionDoc | null> {
    return await HostSession.findOne({ sessionId }).lean<SessionDoc | null>();
  }

  async deleteSessionById(sessionId: string) {
    await HostSession.deleteOne({ sessionId });
  }

  async updateSessionExpires(sessionId: string, expires: Date) {
    await HostSession.updateOne({ sessionId }, { expiresAt: expires });
  }

  async getDatabase() {
    await connectDatabase(this.env);
    return mongoose.connection.db as Db;
  }
}
