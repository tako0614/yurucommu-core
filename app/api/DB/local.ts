import Note from "../models/takos/note.ts";
import Video from "../models/takos/video.ts";
import Message from "../models/takos/message.ts";
import Attachment from "../models/takos/attachment.ts";
import FollowEdge from "../models/takos/follow_edge.ts";
import { createObjectId } from "../utils/activitypub.ts";
import Account from "../models/takos/account.ts";
import EncryptedKeyPair from "../models/takos/encrypted_keypair.ts";
import EncryptedMessage from "../models/takos/encrypted_message.ts";
import KeyPackage from "../models/takos/key_package.ts";
import Notification from "../models/takos/notification.ts";
import PublicMessage from "../models/takos/public_message.ts";
import SystemKey from "../models/takos/system_key.ts";
import Relay from "../models/takos/relay.ts";
import RemoteActor from "../models/takos/remote_actor.ts";
import Session from "../models/takos/session.ts";
import FcmToken from "../models/takos/fcm_token.ts";
import HostFcmToken from "../models/takos_host/fcm_token.ts";
import Instance from "../../takos_host/models/instance.ts";
import OAuthClient from "../../takos_host/models/oauth_client.ts";
import HostDomain from "../../takos_host/models/domain.ts";
import Tenant from "../models/takos/tenant.ts";
import mongoose from "mongoose";
import type { DB, ListOpts } from "../../shared/db.ts";
import type { AccountDoc, RelayDoc, SessionDoc } from "../../shared/types.ts";
import type { SortOrder } from "mongoose";
import type { Db } from "mongodb";
import { connectDatabase } from "../../shared/db.ts";

/** takos 用 MongoDB 実装 */
export class MongoDBLocal implements DB {
  constructor(private env: Record<string, string>) {}

  async getObject(id: string) {
    let doc = await Note.findOne({ _id: id }).lean();
    if (doc) return doc;
    doc = await Video.findOne({ _id: id }).lean();
    if (doc) return doc;
    doc = await Message.findOne({ _id: id }).lean();
    if (doc) return doc;
    doc = await Attachment.findOne({ _id: id }).lean();
    if (doc) return doc;
    return null;
  }

  async saveObject(obj: Record<string, unknown>) {
    const data = { ...obj };
    if (!data.actor_id && typeof data.attributedTo === "string") {
      try {
        data.actor_id = new URL(data.attributedTo).href;
      } catch {
        if (this.env["ACTIVITYPUB_DOMAIN"]) {
          data.actor_id = `https://${
            this.env["ACTIVITYPUB_DOMAIN"]
          }/users/${data.attributedTo}`;
        }
      }
    }
    if (!data._id && this.env["ACTIVITYPUB_DOMAIN"]) {
      data._id = createObjectId(this.env["ACTIVITYPUB_DOMAIN"]);
    }
    if (data.type === "Note") {
      const doc = new Note({
        _id: data._id,
        attributedTo: String(data.attributedTo),
        actor_id: String(data.actor_id),
        content: String(data.content ?? ""),
        extra: data.extra ?? {},
        published: data.published ?? new Date(),
        aud: data.aud ?? { to: [], cc: [] },
      });
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = { env: this.env };
      await doc.save();
      return doc.toObject();
    }
    if (data.type === "Video") {
      const doc = new Video({
        _id: data._id,
        attributedTo: String(data.attributedTo),
        actor_id: String(data.actor_id),
        content: String(data.content ?? ""),
        extra: data.extra ?? {},
        published: data.published ?? new Date(),
        aud: data.aud ?? { to: [], cc: [] },
      });
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = { env: this.env };
      await doc.save();
      return doc.toObject();
    }
    if (data.type === "Message") {
      const doc = new Message({
        _id: data._id,
        attributedTo: String(data.attributedTo),
        actor_id: String(data.actor_id),
        content: String(data.content ?? ""),
        extra: data.extra ?? {},
        published: data.published ?? new Date(),
        aud: data.aud ?? { to: [], cc: [] },
      });
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = { env: this.env };
      await doc.save();
      return doc.toObject();
    }
    if (data.type === "Attachment") {
      const doc = new Attachment({
        _id: data._id,
        attributedTo: String(data.attributedTo),
        actor_id: String(data.actor_id),
        extra: data.extra ?? {},
      });
      await doc.save();
      return doc.toObject();
    }
    return null;
  }

  async listTimeline(actor: string, opts: ListOpts) {
    let name = actor;
    try {
      const url = new URL(actor);
      if (
        url.hostname === this.env["ACTIVITYPUB_DOMAIN"] &&
        url.pathname.startsWith("/users/")
      ) {
        name = url.pathname.split("/")[2];
      }
    } catch {
      // actor is not URL
    }
    const account = await Account.findOne({ userName: name })
      .lean<{ following?: string[] } | null>();
    const ids = account?.following ?? [];
    if (actor) ids.push(actor);
    // タイムラインには Note のみを表示する
    const filter: Record<string, unknown> = { actor_id: { $in: ids } };
    if (opts.before) filter.created_at = { $lt: opts.before };
    return await Note.find(filter)
      .sort({ created_at: -1 })
      .limit(opts.limit ?? 40)
      .lean();
  }

  async follow(_: string, target: string) {
    await FollowEdge.updateOne(
      { actor_id: target },
      { $setOnInsert: { since: new Date() } },
      { upsert: true },
    );
  }

  async unfollow(_: string, target: string) {
    await FollowEdge.deleteOne({ actor_id: target });
  }

  async listAccounts(): Promise<AccountDoc[]> {
    return await Account.find({}).lean<AccountDoc[]>();
  }

  async createAccount(data: Record<string, unknown>): Promise<AccountDoc> {
    const doc = new Account({
      ...data,
      tenant_id: this.env["ACTIVITYPUB_DOMAIN"] ?? "",
    });
    (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals =
      {
        env: this.env,
      };
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

  async listDms(id: string) {
    const acc = await Account.findOne({ _id: id }).lean<
      { dms?: string[] } | null
    >();
    return acc?.dms ?? [];
  }

  async addDm(id: string, target: string) {
    const acc = await Account.findOneAndUpdate({ _id: id }, {
      $addToSet: { dms: target },
    }, { new: true });
    return acc?.dms ?? [];
  }

  async removeDm(id: string, target: string) {
    const acc = await Account.findOneAndUpdate({ _id: id }, {
      $pull: { dms: target },
    }, { new: true });
    return acc?.dms ?? [];
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
    const doc = new Note({
      _id: id,
      attributedTo: author,
      actor_id: actor,
      content,
      extra,
      published: new Date(),
      aud: aud ?? {
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        cc: [],
      },
    });
    (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals =
      {
        env: this.env,
      };
    await doc.save();
    return doc.toObject();
  }

  async updateNote(id: string, update: Record<string, unknown>) {
    return await Note.findOneAndUpdate({ _id: id }, update, { new: true })
      .lean();
  }

  async deleteNote(id: string) {
    const res = await Note.findOneAndDelete({ _id: id });
    return !!res;
  }

  async findNotes(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await Note.find({ ...filter }).sort(sort ?? {}).lean();
  }

  async getPublicNotes(limit: number, before?: Date) {
    const query = Note.find({
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
    const doc = new Video({
      _id: id,
      attributedTo: actor,
      actor_id: actor,
      content,
      extra,
      published: new Date(),
      aud: aud ?? {
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        cc: [],
      },
    });
    (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals =
      {
        env: this.env,
      };
    await doc.save();
    return doc.toObject();
  }

  async updateVideo(id: string, update: Record<string, unknown>) {
    return await Video.findOneAndUpdate({ _id: id }, update, { new: true })
      .lean();
  }

  async deleteVideo(id: string) {
    const res = await Video.findOneAndDelete({ _id: id });
    return !!res;
  }

  async findVideos(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await Video.find({ ...filter }).sort(sort ?? {}).lean();
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
    const doc = new Message({
      _id: id,
      attributedTo: author,
      actor_id: actor,
      content,
      extra,
      published: new Date(),
      aud,
    });
    (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals =
      {
        env: this.env,
      };
    await doc.save();
    return doc.toObject();
  }

  async updateMessage(id: string, update: Record<string, unknown>) {
    return await Message.findOneAndUpdate({ _id: id }, update, { new: true })
      .lean();
  }

  async deleteMessage(id: string) {
    const res = await Message.findOneAndDelete({ _id: id });
    return !!res;
  }

  async findMessages(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await Message.find({ ...filter }).sort(sort ?? {}).lean();
  }

  async findObjects(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    const { type, ...rest } = filter;
    const result: unknown[] = [];
    // type が指定されている場合は対象のモデルのみ検索する
    if (!type || type === "Note") {
      const notes = await Note.find({ ...rest }).sort(sort ?? {}).lean();
      result.push(...notes.map((n) => ({ ...n, type: "Note" })));
    }
    if (!type || type === "Video") {
      const videos = await Video.find({ ...rest }).sort(sort ?? {}).lean();
      result.push(...videos.map((v) => ({ ...v, type: "Video" })));
    }
    if (!type || type === "Message") {
      const messages = await Message.find({ ...rest }).sort(sort ?? {}).lean();
      result.push(...messages.map((m) => ({ ...m, type: "Message" })));
    }
    return result;
  }

  async updateObject(id: string, update: Record<string, unknown>) {
    let doc = await Note.findOneAndUpdate({ _id: id }, update, { new: true })
      .lean();
    if (doc) return doc;
    doc = await Video.findOneAndUpdate({ _id: id }, update, { new: true })
      .lean();
    if (doc) return doc;
    doc = await Message.findOneAndUpdate({ _id: id }, update, { new: true })
      .lean();
    if (doc) return doc;
    return null;
  }

  async deleteObject(id: string) {
    let res = await Note.findOneAndDelete({ _id: id });
    if (res) return true;
    res = await Video.findOneAndDelete({ _id: id });
    if (res) return true;
    res = await Message.findOneAndDelete({ _id: id });
    if (res) return true;
    return false;
  }

  async deleteManyObjects(filter: Record<string, unknown>) {
    if (filter.type === "Note") {
      return await Note.deleteMany({ ...filter });
    }
    if (filter.type === "Video") {
      return await Video.deleteMany({ ...filter });
    }
    if (filter.type === "Message") {
      return await Message.deleteMany({ ...filter });
    }
    return { deletedCount: 0 };
  }

  async listRelays() {
    const docs = await Relay.find({}).lean<{ host: string }[]>();
    return docs.map((d) => d.host);
  }

  async addRelay(relay: string, inboxUrl?: string) {
    const url = inboxUrl ?? `https://${relay}/inbox`;
    await Relay.updateOne(
      { host: relay },
      { $set: { inboxUrl: url }, $setOnInsert: { since: new Date() } },
      { upsert: true },
    );
  }

  async removeRelay(relay: string) {
    await Relay.deleteOne({ host: relay });
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
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    return await KeyPackage.find({ userName, tenant_id: tenantId }).lean();
  }

  async findKeyPackage(userName: string, id: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
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
      tenant_id: this.env["ACTIVITYPUB_DOMAIN"] ?? "",
    });
    (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals =
      {
        env: this.env,
      };
    await doc.save();
    return doc.toObject();
  }

  async deleteKeyPackage(userName: string, id: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    await KeyPackage.deleteOne({ _id: id, userName, tenant_id: tenantId });
  }

  async deleteKeyPackagesByUser(userName: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    await KeyPackage.deleteMany({ userName, tenant_id: tenantId });
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
      tenant_id: this.env["ACTIVITYPUB_DOMAIN"] ?? "",
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
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const query = PublicMessage.find({ ...condition, tenant_id: tenantId });
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
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    return await Notification.find({ tenant_id: tenantId })
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
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const res = await Notification.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { read: true },
    );
    return !!res;
  }

  async deleteNotification(id: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const res = await Notification.findOneAndDelete({
      _id: id,
      tenant_id: tenantId,
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

  async findSystemKey(domain: string) {
    return await SystemKey.findOne({ domain }).lean<
      { domain: string; privateKey: string; publicKey: string } | null
    >();
  }

  async saveSystemKey(
    domain: string,
    privateKey: string,
    publicKey: string,
  ) {
    await SystemKey.create({ domain, privateKey, publicKey });
  }

  async registerFcmToken(token: string, userName: string) {
    if (this.env["DB_MODE"] === "host") {
      await HostFcmToken.updateOne(
        {
          token,
          tenant_id: this.env["ACTIVITYPUB_DOMAIN"],
        },
        { $set: { token, userName } },
        { upsert: true },
      );
    } else {
      await FcmToken.updateOne({ token }, { $set: { token, userName } }, {
        upsert: true,
      });
    }
  }

  async unregisterFcmToken(token: string) {
    if (this.env["DB_MODE"] === "host") {
      await HostFcmToken.deleteOne({
        token,
        tenant_id: this.env["ACTIVITYPUB_DOMAIN"],
      });
    } else {
      await FcmToken.deleteOne({ token });
    }
  }

  async listFcmTokens() {
    if (this.env["DB_MODE"] === "host") {
      const docs = await HostFcmToken.find<{ token: string }>(
        { tenant_id: this.env["ACTIVITYPUB_DOMAIN"] },
      ).lean();
      return docs.map((d) => ({ token: d.token }));
    } else {
      const docs = await FcmToken.find<{ token: string }>({}).lean();
      return docs.map((d) => ({ token: d.token }));
    }
  }

  async listInstances(owner: string) {
    const docs = await Instance.find({ owner }).lean<{ host: string }[]>();
    return docs.map((d) => ({ host: d.host }));
  }

  async countInstances(owner: string) {
    return await Instance.countDocuments({ owner });
  }

  async findInstanceByHost(host: string) {
    const doc = await Instance.findOne({ host }).lean<
      {
        _id: mongoose.Types.ObjectId;
        host: string;
        owner: mongoose.Types.ObjectId;
        env?: Record<string, string>;
      } | null
    >();
    return doc
      ? {
        _id: String(doc._id),
        host: doc.host,
        owner: String(doc.owner),
        env: doc.env,
      }
      : null;
  }

  async findInstanceByHostAndOwner(host: string, owner: string) {
    const doc = await Instance.findOne({ host, owner }).lean<
      {
        _id: mongoose.Types.ObjectId;
        host: string;
        env?: Record<string, string>;
      } | null
    >();
    return doc ? { _id: String(doc._id), host: doc.host, env: doc.env } : null;
  }

  async createInstance(
    data: { host: string; owner: string; env?: Record<string, string> },
  ) {
    await Instance.create({
      host: data.host,
      owner: data.owner,
      env: data.env ?? {},
      createdAt: new Date(),
    });
  }

  async updateInstanceEnv(id: string, env: Record<string, string>) {
    await Instance.updateOne({ _id: id }, { $set: { env } });
  }

  async deleteInstance(host: string, owner: string) {
    await Instance.deleteOne({ host, owner });
  }

  async listOAuthClients() {
    const docs = await OAuthClient.find({}).lean<
      { clientId: string; redirectUri: string }[]
    >();
    return docs.map((d) => ({
      clientId: d.clientId,
      redirectUri: d.redirectUri,
    }));
  }

  async findOAuthClient(clientId: string) {
    const doc = await OAuthClient.findOne({ clientId }).lean<
      { clientSecret: string } | null
    >();
    return doc ? { clientSecret: doc.clientSecret } : null;
  }

  async createOAuthClient(
    data: { clientId: string; clientSecret: string; redirectUri: string },
  ) {
    await OAuthClient.create({
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      redirectUri: data.redirectUri,
      createdAt: new Date(),
    });
  }

  async listHostDomains(user: string) {
    const docs = await HostDomain.find({ user }).lean<
      { domain: string; verified: boolean }[]
    >();
    return docs.map((d) => ({ domain: d.domain, verified: d.verified }));
  }

  async findHostDomain(domain: string, user?: string) {
    const cond: Record<string, unknown> = { domain };
    if (user) cond.user = user;
    const doc = await HostDomain.findOne(cond).lean<
      { _id: mongoose.Types.ObjectId; token: string; verified: boolean } | null
    >();
    return doc
      ? { _id: String(doc._id), token: doc.token, verified: doc.verified }
      : null;
  }

  async createHostDomain(domain: string, user: string, token: string) {
    await HostDomain.create({
      domain,
      user,
      token,
      verified: false,
      createdAt: new Date(),
    });
  }

  async verifyHostDomain(id: string) {
    await HostDomain.updateOne({ _id: id }, { $set: { verified: true } });
  }

  async ensureTenant(id: string, domain: string) {
    const exists = await Tenant.findOne({ _id: id }).lean();
    if (!exists) {
      await Tenant.create({ _id: id, domain, created_at: new Date() });
    }
  }

  async createSession(
    sessionId: string,
    expiresAt: Date,
    tenantId: string,
  ): Promise<SessionDoc> {
    const doc = new Session({
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
    return await Session.findOne({ sessionId }).lean<SessionDoc | null>();
  }

  async deleteSessionById(sessionId: string) {
    await Session.deleteOne({ sessionId });
  }

  async updateSessionExpires(sessionId: string, expires: Date) {
    await Session.updateOne({ sessionId }, { expiresAt: expires });
  }

  async getDatabase() {
    await connectDatabase(this.env);
    return mongoose.connection.db as Db;
  }
}
