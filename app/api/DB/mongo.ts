import Note from "../models/takos/note.ts";
import Message from "../models/takos/message.ts";
import Attachment from "../models/takos/attachment.ts";
import FollowEdge from "../models/takos/follow_edge.ts";
import { createObjectId } from "../utils/activitypub.ts";
import Account from "../models/takos/account.ts";
import EncryptedKeyPair from "../models/takos/encrypted_keypair.ts";
import EncryptedMessage from "../models/takos/encrypted_message.ts";
import KeyPackage from "../models/takos/key_package.ts";
import Notification from "../models/takos/notification.ts";
import HandshakeMessage from "../models/takos/handshake_message.ts";
import SystemKey from "../models/takos/system_key.ts";
import RemoteActor from "../models/takos/remote_actor.ts";
import Session from "../models/takos/session.ts";
import FcmToken from "../models/takos/fcm_token.ts";
import HostFcmToken from "../models/takos_host/fcm_token.ts";
import Instance from "../../takos_host/models/instance.ts";
import OAuthClient from "../../takos_host/models/oauth_client.ts";
import HostDomain from "../../takos_host/models/domain.ts";
import Tenant from "../models/takos/tenant.ts";
import mongoose from "mongoose";
import type { DB, GroupInfo, ListOpts } from "../../shared/db.ts";
import type { AccountDoc, SessionDoc } from "../../shared/types.ts";
import type { SortOrder } from "mongoose";
import type { Db } from "mongodb";
import { connectDatabase } from "../../shared/db.ts";

/** MongoDB 実装 */
export class MongoDB implements DB {
  constructor(private env: Record<string, string>) {}

  private withTenant<T>(query: mongoose.Query<T, unknown>) {
    if (this.env["DB_MODE"] === "host") {
      query.setOptions({ $locals: { env: this.env } });
    }
    return query;
  }

  async getObject(id: string) {
    let query = this.withTenant(Note.findOne({ _id: id }));
    let doc = await query.lean();
    if (doc) return doc;
    query = this.withTenant(Message.findOne({ _id: id }));
    doc = await query.lean();
    if (doc) return doc;
    query = this.withTenant(Attachment.findOne({ _id: id }));
    doc = await query.lean();
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
      if (this.env["DB_MODE"] === "host") {
        (doc as unknown as { $locals?: { env?: Record<string, string> } })
          .$locals = { env: this.env };
      }
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
      if (this.env["DB_MODE"] === "host") {
        (doc as unknown as { $locals?: { env?: Record<string, string> } })
          .$locals = { env: this.env };
      }
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
    const accountQuery = this.withTenant(Account.findOne({ userName: name }));
    const account = await accountQuery
      .lean<{ following?: string[] } | null>();
    const ids = account?.following ?? [];
    if (actor) ids.push(actor);
    // タイムラインには Note のみを表示する
    const filter: Record<string, unknown> = { actor_id: { $in: ids } };
    if (opts.before) filter.created_at = { $lt: opts.before };
    const noteQuery = this.withTenant(Note.find(filter));
    return await noteQuery
      .sort({ created_at: -1 })
      .limit(opts.limit ?? 40)
      .lean();
  }

  async follow(_: string, target: string) {
    const query = FollowEdge.updateOne(
      { actor_id: target },
      { $setOnInsert: { since: new Date() } },
      { upsert: true },
    );
    this.withTenant(query);
    await query;
  }

  async unfollow(_: string, target: string) {
    const query = FollowEdge.deleteOne({ actor_id: target });
    this.withTenant(query);
    await query;
  }

  async listAccounts(): Promise<AccountDoc[]> {
    const query = this.withTenant(Account.find({}));
    return await query.lean<AccountDoc[]>();
  }

  async createAccount(data: Record<string, unknown>): Promise<AccountDoc> {
    const doc = new Account({
      ...data,
      tenant_id: this.env["ACTIVITYPUB_DOMAIN"] ?? "",
    });
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = {
          env: this.env,
        };
    }
    await doc.save();
    return doc.toObject() as AccountDoc;
  }

  async findAccountById(id: string): Promise<AccountDoc | null> {
    const query = this.withTenant(Account.findOne({ _id: id }));
    return await query.lean<AccountDoc | null>();
  }

  async findAccountByUserName(
    username: string,
  ): Promise<AccountDoc | null> {
    const query = this.withTenant(Account.findOne({ userName: username }));
    return await query.lean<AccountDoc | null>();
  }

  async updateAccountById(
    id: string,
    update: Record<string, unknown>,
  ): Promise<AccountDoc | null> {
    const query = Account.findOneAndUpdate({ _id: id }, update, { new: true });
    this.withTenant(query);
    return await query.lean<AccountDoc | null>();
  }

  async deleteAccountById(id: string) {
    const query = Account.findOneAndDelete({ _id: id });
    this.withTenant(query);
    const res = await query;
    return !!res;
  }

  async addFollower(id: string, follower: string) {
    const query = Account.findOneAndUpdate({ _id: id }, {
      $addToSet: { followers: follower },
    }, { new: true });
    this.withTenant(query);
    const acc = await query;
    return acc?.followers ?? [];
  }

  async removeFollower(id: string, follower: string) {
    const query = Account.findOneAndUpdate({ _id: id }, {
      $pull: { followers: follower },
    }, { new: true });
    this.withTenant(query);
    const acc = await query;
    return acc?.followers ?? [];
  }

  async addFollowing(id: string, target: string) {
    const query = Account.findOneAndUpdate({ _id: id }, {
      $addToSet: { following: target },
    }, { new: true });
    this.withTenant(query);
    const acc = await query;
    return acc?.following ?? [];
  }

  async removeFollowing(id: string, target: string) {
    const query = Account.findOneAndUpdate({ _id: id }, {
      $pull: { following: target },
    }, { new: true });
    this.withTenant(query);
    const acc = await query;
    return acc?.following ?? [];
  }

  async listGroups(id: string) {
    const query = this.withTenant(Account.findOne({ _id: id }));
    const acc = await query.lean<
      { groups?: GroupInfo[] } | null
    >();
    return acc?.groups ?? [];
  }

  async addGroup(
    id: string,
    group: GroupInfo,
  ) {
    const query = Account.findOneAndUpdate({ _id: id }, {
      $push: { groups: group },
    }, { new: true });
    this.withTenant(query);
    const acc = await query;
    return acc?.groups ?? [];
  }

  async removeGroup(id: string, groupId: string) {
    const query = Account.findOneAndUpdate({ _id: id }, {
      $pull: { groups: { id: groupId } },
    }, { new: true });
    this.withTenant(query);
    const acc = await query;
    return acc?.groups ?? [];
  }

  async findGroup(groupId: string) {
    const query = this.withTenant(Account.findOne({ "groups.id": groupId }));
    const acc = await query.lean<
      | {
        _id: unknown;
        groups: GroupInfo[];
      }
      | null
    >();
    const group = acc?.groups.find((g) => g.id === groupId);
    if (!group || !acc?._id) return null;
    return { owner: String(acc._id), group };
  }

  async updateGroup(
    owner: string,
    group: GroupInfo,
  ) {
    const query = Account.updateOne({ _id: owner, "groups.id": group.id }, {
      $set: { "groups.$": group },
    });
    this.withTenant(query);
    await query;
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
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = {
          env: this.env,
        };
    }
    await doc.save();
    return doc.toObject();
  }

  async updateNote(id: string, update: Record<string, unknown>) {
    const query = Note.findOneAndUpdate({ _id: id }, update, { new: true });
    this.withTenant(query);
    return await query.lean();
  }

  async deleteNote(id: string) {
    const query = Note.findOneAndDelete({ _id: id });
    this.withTenant(query);
    const res = await query;
    return !!res;
  }

  async findNotes(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    const query = this.withTenant(Note.find({ ...filter }));
    return await query.sort(sort ?? {}).lean();
  }

  async getPublicNotes(limit: number, before?: Date) {
    const query = this.withTenant(Note.find({
      "aud.to": "https://www.w3.org/ns/activitystreams#Public",
    }));
    if (before) query.where("created_at").lt(before.getTime());
    return await query.sort({ created_at: -1 }).limit(limit).lean();
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
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = {
          env: this.env,
        };
    }
    await doc.save();
    return doc.toObject();
  }

  async updateMessage(id: string, update: Record<string, unknown>) {
    const query = Message.findOneAndUpdate({ _id: id }, update, { new: true });
    this.withTenant(query);
    return await query.lean();
  }

  async deleteMessage(id: string) {
    const query = Message.findOneAndDelete({ _id: id });
    this.withTenant(query);
    const res = await query;
    return !!res;
  }

  async findMessages(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    const query = this.withTenant(Message.find({ ...filter }));
    return await query.sort(sort ?? {}).lean();
  }

  async findObjects(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    const { type, ...rest } = filter;
    const result: unknown[] = [];
    // type が指定されている場合は対象のモデルのみ検索する
    if (!type || type === "Note") {
      const notes = await this.withTenant(Note.find({ ...rest }))
        .sort(sort ?? {})
        .lean();
      result.push(...notes.map((n) => ({ ...n, type: "Note" })));
    }
    if (!type || type === "Message") {
      const messages = await this.withTenant(Message.find({ ...rest }))
        .sort(sort ?? {})
        .lean();
      result.push(...messages.map((m) => ({ ...m, type: "Message" })));
    }
    return result;
  }

  async updateObject(id: string, update: Record<string, unknown>) {
    let query = Note.findOneAndUpdate({ _id: id }, update, { new: true });
    this.withTenant(query);
    let doc = await query.lean();
    if (doc) return doc;
    query = Message.findOneAndUpdate({ _id: id }, update, { new: true });
    this.withTenant(query);
    doc = await query.lean();
    if (doc) return doc;
    return null;
  }

  async deleteObject(id: string) {
    let query = Note.findOneAndDelete({ _id: id });
    this.withTenant(query);
    let res = await query;
    if (res) return true;
    query = Message.findOneAndDelete({ _id: id });
    this.withTenant(query);
    res = await query;
    if (res) return true;
    return false;
  }

  async deleteManyObjects(filter: Record<string, unknown>) {
    if (filter.type === "Note") {
      const query = Note.deleteMany({ ...filter });
      this.withTenant(query);
      return await query;
    }
    if (filter.type === "Message") {
      const query = Message.deleteMany({ ...filter });
      this.withTenant(query);
      return await query;
    }
    return { deletedCount: 0 };
  }

  async addFollowerByName(username: string, follower: string) {
    const query = Account.updateOne({ userName: username }, {
      $addToSet: { followers: follower },
    });
    this.withTenant(query);
    await query;
  }

  async removeFollowerByName(username: string, follower: string) {
    const query = Account.updateOne({ userName: username }, {
      $pull: { followers: follower },
    });
    this.withTenant(query);
    await query;
  }

  async searchAccounts(
    query: RegExp,
    limit = 20,
  ): Promise<AccountDoc[]> {
    const q = this.withTenant(
      Account.find({ $or: [{ userName: query }, { displayName: query }] }),
    );
    return await q.limit(limit).lean<AccountDoc[]>();
  }

  async updateAccountByUserName(
    username: string,
    update: Record<string, unknown>,
  ) {
    const query = Account.updateOne({ userName: username }, update);
    this.withTenant(query);
    await query;
  }

  async findAccountsByUserNames(
    usernames: string[],
  ): Promise<AccountDoc[]> {
    const query = this.withTenant(
      Account.find({ userName: { $in: usernames } }),
    );
    return await query.lean<AccountDoc[]>();
  }

  async countAccounts() {
    const query = this.withTenant(Account.countDocuments({}));
    return await query;
  }

  async createEncryptedMessage(data: {
    roomId: string;
    from: string;
    to: string[];
    content: string;
    mediaType?: string;
    encoding?: string;
  }) {
    const doc = new EncryptedMessage({
      roomId: data.roomId,
      from: data.from,
      to: data.to,
      content: data.content,
      mediaType: data.mediaType ?? "message/mls",
      encoding: data.encoding ?? "base64",
    });
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = { env: this.env };
    }
    await doc.save();
    return doc.toObject();
  }

  async findEncryptedMessages(
    condition: Record<string, unknown>,
    opts: { before?: string; after?: string; limit?: number } = {},
  ) {
    const query = this.withTenant(EncryptedMessage.find(condition));
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
    const query = this.withTenant(EncryptedKeyPair.findOne({ userName }));
    return await query.lean();
  }

  async upsertEncryptedKeyPair(userName: string, content: string) {
    const query = EncryptedKeyPair.findOneAndUpdate({ userName }, { content }, {
      upsert: true,
    });
    this.withTenant(query);
    await query;
  }

  async deleteEncryptedKeyPair(userName: string) {
    const query = EncryptedKeyPair.deleteOne({ userName });
    this.withTenant(query);
    await query;
  }

  async listKeyPackages(userName: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    await this.cleanupKeyPackages(userName);
    const query = this.withTenant(KeyPackage.find({
      userName,
      tenant_id: tenantId,
      used: false,
    }));
    return await query.lean();
  }

  async findKeyPackage(userName: string, id: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const query = this.withTenant(
      KeyPackage.findOne({ _id: id, userName, tenant_id: tenantId }),
    );
    return await query.lean();
  }

  async createKeyPackage(
    userName: string,
    content: string,
    mediaType = "message/mls",
    encoding = "base64",
    groupInfo?: string,
    expiresAt?: Date,
  ) {
    const doc = new KeyPackage({
      userName,
      content,
      mediaType,
      encoding,
      groupInfo,
      expiresAt,
      tenant_id: this.env["ACTIVITYPUB_DOMAIN"] ?? "",
    });
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = {
          env: this.env,
        };
    }
    await doc.save();
    return doc.toObject();
  }

  async markKeyPackageUsed(userName: string, id: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const query = KeyPackage.updateOne({
      _id: id,
      userName,
      tenant_id: tenantId,
    }, {
      used: true,
    });
    this.withTenant(query);
    await query;
  }

  async cleanupKeyPackages(userName: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const query = KeyPackage.deleteMany({
      userName,
      tenant_id: tenantId,
      $or: [
        { used: true },
        { expiresAt: { $lt: new Date() } },
      ],
    });
    this.withTenant(query);
    await query;
  }

  async deleteKeyPackage(userName: string, id: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const query = KeyPackage.deleteOne({
      _id: id,
      userName,
      tenant_id: tenantId,
    });
    this.withTenant(query);
    await query;
  }

  async deleteKeyPackagesByUser(userName: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const query = KeyPackage.deleteMany({ userName, tenant_id: tenantId });
    this.withTenant(query);
    await query;
  }

  async createHandshakeMessage(data: {
    roomId: string;
    sender: string;
    recipients: string[];
    message: string;
  }) {
    const doc = new HandshakeMessage({
      roomId: data.roomId,
      sender: data.sender,
      recipients: data.recipients,
      message: data.message,
      tenant_id: this.env["ACTIVITYPUB_DOMAIN"] ?? "",
    });
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = {
          env: this.env,
        };
    }
    await doc.save();
    return doc.toObject();
  }

  async findHandshakeMessages(
    condition: Record<string, unknown>,
    opts: { before?: string; after?: string; limit?: number } = {},
  ) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const query = this.withTenant(
      HandshakeMessage.find({ ...condition, tenant_id: tenantId }),
    );
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
    const query = this.withTenant(Notification.find({ tenant_id: tenantId }));
    return await query.sort({ createdAt: -1 }).lean();
  }

  async createNotification(title: string, message: string, type: string) {
    const doc = new Notification({ title, message, type });
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = {
          env: this.env,
        };
    }
    await doc.save();
    return doc.toObject();
  }

  async markNotificationRead(id: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const query = Notification.findOneAndUpdate(
      { _id: id, tenant_id: tenantId },
      { read: true },
    );
    this.withTenant(query);
    const res = await query;
    return !!res;
  }

  async deleteNotification(id: string) {
    const tenantId = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const query = Notification.findOneAndDelete({
      _id: id,
      tenant_id: tenantId,
    });
    this.withTenant(query);
    const res = await query;
    return !!res;
  }

  async findRemoteActorByUrl(url: string) {
    const query = this.withTenant(RemoteActor.findOne({ actorUrl: url }));
    return await query.lean();
  }

  async findRemoteActorsByUrls(urls: string[]) {
    const query = this.withTenant(
      RemoteActor.find({ actorUrl: { $in: urls } }),
    );
    return await query.lean();
  }

  async upsertRemoteActor(data: {
    actorUrl: string;
    name: string;
    preferredUsername: string;
    icon: unknown;
    summary: string;
  }) {
    const query = RemoteActor.findOneAndUpdate(
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
    this.withTenant(query);
    await query;
  }

  async findSystemKey(domain: string) {
    const query = this.withTenant(SystemKey.findOne({ domain }));
    return await query.lean<
      { domain: string; privateKey: string; publicKey: string } | null
    >();
  }

  async saveSystemKey(
    domain: string,
    privateKey: string,
    publicKey: string,
  ) {
    const doc = new SystemKey({ domain, privateKey, publicKey });
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = { env: this.env };
    }
    await doc.save();
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
    const query = this.withTenant(Instance.find({ owner }));
    const docs = await query.lean<{ host: string }[]>();
    return docs.map((d) => ({ host: d.host }));
  }

  async countInstances(owner: string) {
    const query = this.withTenant(Instance.countDocuments({ owner }));
    return await query;
  }

  async findInstanceByHost(host: string) {
    const query = this.withTenant(Instance.findOne({ host }));
    const doc = await query.lean<
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
    const query = this.withTenant(Instance.findOne({ host, owner }));
    const doc = await query.lean<
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
    const doc = new Instance({
      host: data.host,
      owner: data.owner,
      env: data.env ?? {},
      createdAt: new Date(),
    });
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = { env: this.env };
    }
    await doc.save();
  }

  async updateInstanceEnv(id: string, env: Record<string, string>) {
    const query = Instance.updateOne({ _id: id }, { $set: { env } });
    this.withTenant(query);
    await query;
  }

  async deleteInstance(host: string, owner: string) {
    const query = Instance.deleteOne({ host, owner });
    this.withTenant(query);
    await query;
  }

  async listOAuthClients() {
    const query = this.withTenant(OAuthClient.find({}));
    const docs = await query.lean<
      { clientId: string; redirectUri: string }[]
    >();
    return docs.map((d) => ({
      clientId: d.clientId,
      redirectUri: d.redirectUri,
    }));
  }

  async findOAuthClient(clientId: string) {
    const query = this.withTenant(OAuthClient.findOne({ clientId }));
    const doc = await query.lean<
      { clientSecret: string } | null
    >();
    return doc ? { clientSecret: doc.clientSecret } : null;
  }

  async createOAuthClient(
    data: { clientId: string; clientSecret: string; redirectUri: string },
  ) {
    const doc = new OAuthClient({
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      redirectUri: data.redirectUri,
      createdAt: new Date(),
    });
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = { env: this.env };
    }
    await doc.save();
  }

  async listHostDomains(user: string) {
    const query = this.withTenant(HostDomain.find({ user }));
    const docs = await query.lean<
      { domain: string; verified: boolean }[]
    >();
    return docs.map((d) => ({ domain: d.domain, verified: d.verified }));
  }

  async findHostDomain(domain: string, user?: string) {
    const cond: Record<string, unknown> = { domain };
    if (user) cond.user = user;
    const query = this.withTenant(HostDomain.findOne(cond));
    const doc = await query.lean<
      { _id: mongoose.Types.ObjectId; token: string; verified: boolean } | null
    >();
    return doc
      ? { _id: String(doc._id), token: doc.token, verified: doc.verified }
      : null;
  }

  async createHostDomain(domain: string, user: string, token: string) {
    const doc = new HostDomain({
      domain,
      user,
      token,
      verified: false,
      createdAt: new Date(),
    });
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = { env: this.env };
    }
    await doc.save();
  }

  async verifyHostDomain(id: string) {
    const query = HostDomain.updateOne({ _id: id }, {
      $set: { verified: true },
    });
    this.withTenant(query);
    await query;
  }

  async ensureTenant(id: string, domain: string) {
    const query = this.withTenant(Tenant.findOne({ _id: id }));
    const exists = await query.lean();
    if (!exists) {
      const doc = new Tenant({ _id: id, domain, created_at: new Date() });
      if (this.env["DB_MODE"] === "host") {
        (doc as unknown as { $locals?: { env?: Record<string, string> } })
          .$locals = { env: this.env };
      }
      await doc.save();
    }
  }

  /**
   * セッションを保存します。tenant_id はプラグインで自動付与されます。
   */
  async createSession(
    sessionId: string,
    expiresAt: Date,
  ): Promise<SessionDoc> {
    const doc = new Session({
      sessionId,
      expiresAt,
    });
    if (this.env["DB_MODE"] === "host") {
      (doc as unknown as { $locals?: { env?: Record<string, string> } })
        .$locals = {
          env: this.env,
        };
    }
    await doc.save();
    return doc.toObject() as SessionDoc;
  }

  async findSessionById(sessionId: string): Promise<SessionDoc | null> {
    const query = Session.findOne({ sessionId });
    if (this.env["DB_MODE"] === "host") {
      query.setOptions({ $locals: { env: this.env } });
    }
    return await query.lean<SessionDoc | null>();
  }

  async deleteSessionById(sessionId: string) {
    const query = Session.deleteOne({ sessionId });
    if (this.env["DB_MODE"] === "host") {
      query.setOptions({ $locals: { env: this.env } });
    }
    await query;
  }

  async updateSessionExpires(sessionId: string, expires: Date) {
    const query = Session.updateOne({ sessionId }, { expiresAt: expires });
    if (this.env["DB_MODE"] === "host") {
      query.setOptions({ $locals: { env: this.env } });
    }
    await query;
  }

  async getDatabase() {
    await connectDatabase(this.env);
    return mongoose.connection.db as Db;
  }
}
