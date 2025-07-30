import HostFollowEdge from "../models/takos_host/follow_edge.ts";
import { createObjectId } from "../utils/activitypub.ts";
import HostAccount from "../models/takos_host/account.ts";
import HostEncryptedKeyPair from "../models/takos_host/encrypted_keypair.ts";
import HostEncryptedMessage from "../models/takos_host/encrypted_message.ts";
import HostKeyPackage from "../models/takos_host/key_package.ts";
import HostNotification from "../models/takos_host/notification.ts";
import HostPublicMessage from "../models/takos_host/public_message.ts";
import HostNote from "../models/takos_host/note.ts";
import HostVideo from "../models/takos_host/video.ts";
import HostMessage from "../models/takos_host/message.ts";
import HostStory from "../models/takos_host/story.ts";
import SystemKey from "../models/takos/system_key.ts";
import HostRelay from "../models/takos_host/relay.ts";
import HostRemoteActor from "../models/takos_host/remote_actor.ts";
import HostSession from "../models/takos_host/session.ts";
import HostFcmToken from "../models/takos_host/fcm_token.ts";
import FcmToken from "../models/takos/fcm_token.ts";
import Tenant from "../models/takos/tenant.ts";
import Instance from "../../takos_host/models/instance.ts";
import OAuthClient from "../../takos_host/models/oauth_client.ts";
import HostDomain from "../../takos_host/models/domain.ts";
import mongoose from "mongoose";
import type { DB, ListOpts } from "../../shared/db.ts";
import type { AccountDoc, RelayDoc, SessionDoc } from "../../shared/types.ts";
import type { SortOrder } from "mongoose";
import type { Db } from "mongodb";
import { connectDatabase } from "../../shared/db.ts";

/** takos host 用 MongoDB 実装 */
export class MongoDBHost implements DB {
  constructor(private env: Record<string, string>) {}

  private get tenantId() {
    return this.env["ACTIVITYPUB_DOMAIN"] ?? "";
  }

  private get rootDomain() {
    return this.env["ROOT_DOMAIN"] ?? "";
  }

  private async useLocalObjects() {
    if (!this.rootDomain) return false;
    const count = await HostRelay.countDocuments({
      tenant_id: this.tenantId,
      host: this.rootDomain,
    });
    return count > 0;
  }

  private async searchObjects(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
    limit?: number,
  ) {
    const type = filter.type as string | undefined;
    const baseFilter = { ...filter };
    delete (baseFilter as Record<string, unknown>).type;
    const conds: Record<string, unknown>[] = [
      { ...baseFilter, tenant_id: this.tenantId },
    ];
    if (await this.useLocalObjects()) {
      conds.push({ ...baseFilter, tenant_id: this.rootDomain });
    }
    const exec = async (
      M:
        | typeof HostNote
        | typeof HostVideo
        | typeof HostMessage
        | typeof HostStory,
    ) =>
      conds.length > 1
        ? await M.find({ $or: conds }).limit(limit ?? 20).sort(sort)
        : await M.find(conds[0]).limit(limit ?? 20).sort(sort);
    if (type === "Note") return await exec(HostNote);
    if (type === "Video") return await exec(HostVideo);
    if (type === "Message") return await exec(HostMessage);
    if (type === "Story") return await exec(HostStory);
    const notes = await exec(HostNote);
    const videos = await exec(HostVideo);
    const messages = await exec(HostMessage);
    const stories = await exec(HostStory);
    return [...notes, ...videos, ...messages, ...stories];
  }

  async getObject(id: string) {
    let doc = await HostNote.findOne({ _id: id }).lean();
    if (doc) return doc;
    doc = await HostVideo.findOne({ _id: id }).lean();
    if (doc) return doc;
    doc = await HostMessage.findOne({ _id: id }).lean();
    if (doc) return doc;
    doc = await HostStory.findOne({ _id: id }).lean();
    if (doc) return doc;
    return null;
  }

  async saveObject(obj: Record<string, unknown>) {
    const data = { ...obj };
    if (!data.actor_id && typeof data.attributedTo === "string") {
      try {
        data.actor_id = new URL(data.attributedTo).href;
      } catch {
        data.actor_id = data.attributedTo;
      }
    }
    if (data.type === "Note") {
      const doc = new HostNote({ ...data, tenant_id: this.tenantId });
      await doc.save();
      return doc.toObject();
    }
    if (data.type === "Video") {
      const doc = new HostVideo({ ...data, tenant_id: this.tenantId });
      await doc.save();
      return doc.toObject();
    }
    if (data.type === "Message") {
      const doc = new HostMessage({ ...data, tenant_id: this.tenantId });
      await doc.save();
      return doc.toObject();
    }
    if (data.type === "Story") {
      const doc = new HostStory({ ...data, tenant_id: this.tenantId });
      await doc.save();
      return doc.toObject();
    }
    return null;
  }

  async listTimeline(actor: string, opts: ListOpts) {
    let account: { following?: string[] } | null = null;
    try {
      const url = new URL(actor);
      if (
        url.hostname === this.tenantId && url.pathname.startsWith("/users/")
      ) {
        const name = url.pathname.split("/")[2];
        account = await HostAccount.findOne({
          userName: name,
          tenant_id: this.tenantId,
        }).lean<{ following?: string[] } | null>();
      }
    } catch {
      account = await HostAccount.findOne({
        userName: actor,
        tenant_id: this.tenantId,
      }).lean<{ following?: string[] } | null>();
    }
    const ids = account?.following ?? [];
    if (actor) ids.push(actor);
    // タイムラインには Note のみを表示する
    const filter: Record<string, unknown> = {
      actor_id: { $in: ids },
      type: "Note",
    };
    if (opts.before) filter.created_at = { $lt: opts.before };
    return await this.searchObjects(
      filter,
      { created_at: -1 },
      opts.limit ?? 40,
    );
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
    return await HostAccount.find({}).lean<AccountDoc[]>();
  }

  async createAccount(data: Record<string, unknown>): Promise<AccountDoc> {
    const doc = new HostAccount({
      ...data,
      tenant_id: this.tenantId,
    });
    await doc.save();
    return doc.toObject() as AccountDoc;
  }

  async findAccountById(id: string): Promise<AccountDoc | null> {
    return await HostAccount.findOne({ _id: id }).lean<AccountDoc | null>();
  }

  async findAccountByUserName(
    username: string,
  ): Promise<AccountDoc | null> {
    return await HostAccount.findOne({ userName: username }).lean<
      AccountDoc | null
    >();
  }

  async updateAccountById(
    id: string,
    update: Record<string, unknown>,
  ): Promise<AccountDoc | null> {
    return await HostAccount.findOneAndUpdate({ _id: id }, update, {
      new: true,
    })
      .lean<AccountDoc | null>();
  }

  async deleteAccountById(id: string) {
    const res = await HostAccount.findOneAndDelete({ _id: id });
    return !!res;
  }

  async addFollower(id: string, follower: string) {
    const acc = await HostAccount.findOneAndUpdate({ _id: id }, {
      $addToSet: { followers: follower },
    }, { new: true });
    return acc?.followers ?? [];
  }

  async removeFollower(id: string, follower: string) {
    const acc = await HostAccount.findOneAndUpdate({ _id: id }, {
      $pull: { followers: follower },
    }, { new: true });
    return acc?.followers ?? [];
  }

  async addFollowing(id: string, target: string) {
    const acc = await HostAccount.findOneAndUpdate({ _id: id }, {
      $addToSet: { following: target },
    }, { new: true });
    return acc?.following ?? [];
  }

  async removeFollowing(id: string, target: string) {
    const acc = await HostAccount.findOneAndUpdate({ _id: id }, {
      $pull: { following: target },
    }, { new: true });
    return acc?.following ?? [];
  }

  async listDms(id: string) {
    const acc = await HostAccount.findOne({ _id: id }).lean<
      { dms?: string[] } | null
    >();
    return acc?.dms ?? [];
  }

  async addDm(id: string, target: string) {
    const acc = await HostAccount.findOneAndUpdate({ _id: id }, {
      $addToSet: { dms: target },
    }, { new: true });
    return acc?.dms ?? [];
  }

  async removeDm(id: string, target: string) {
    const acc = await HostAccount.findOneAndUpdate({ _id: id }, {
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
    const doc = new HostNote({
      _id: id,
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
    return await HostNote.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      update,
      { new: true },
    ).lean();
  }

  async deleteNote(id: string) {
    const res = await HostNote.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    return !!res;
  }

  async findNotes(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await this.searchObjects({ ...filter, type: "Note" }, sort);
  }

  async getPublicNotes(limit: number, before?: Date) {
    const filter: Record<string, unknown> = {
      to: "https://www.w3.org/ns/activitystreams#Public",
    };
    if (before) filter.created_at = { $lt: before };
    return await this.searchObjects(
      { ...filter, type: "Note" },
      { created_at: -1 },
      limit,
    );
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
    const doc = new HostVideo({
      _id: id,
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
    return await HostVideo.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      update,
      { new: true },
    ).lean();
  }

  async deleteVideo(id: string) {
    const res = await HostVideo.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    return !!res;
  }

  async findVideos(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await this.searchObjects({ ...filter, type: "Video" }, sort);
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
    const doc = new HostMessage({
      _id: id,
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
    return await HostMessage.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      update,
      { new: true },
    ).lean();
  }

  async deleteMessage(id: string) {
    const res = await HostMessage.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    return !!res;
  }

  async findMessages(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await this.searchObjects({ ...filter, type: "Message" }, sort);
  }

  async saveStory(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud: { to: string[]; cc: string[] },
  ) {
    const id = createObjectId(domain);
    const actor = `https://${domain}/users/${author}`;
    const doc = new HostStory({
      _id: id,
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

  async updateStory(id: string, update: Record<string, unknown>) {
    return await HostStory.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      update,
      { new: true },
    ).lean();
  }

  async deleteStory(id: string) {
    const res = await HostStory.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    return !!res;
  }

  async findStories(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await this.searchObjects({ ...filter, type: "Story" }, sort);
  }

  async findObjects(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    const notes = await this.searchObjects({ ...filter, type: "Note" }, sort);
    const videos = await this.searchObjects({ ...filter, type: "Video" }, sort);
    const messages = await this.searchObjects(
      { ...filter, type: "Message" },
      sort,
    );
    const stories = await this.searchObjects(
      { ...filter, type: "Story" },
      sort,
    );
    const others = await this.searchObjects(filter, sort);
    return [...notes, ...videos, ...messages, ...stories, ...others];
  }

  async updateObject(id: string, update: Record<string, unknown>) {
    let doc = await HostNote.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      update,
      { new: true },
    ).lean();
    if (doc) return doc;
    doc = await HostVideo.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      update,
      { new: true },
    ).lean();
    if (doc) return doc;
    doc = await HostMessage.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      update,
      { new: true },
    ).lean();
    if (doc) return doc;
    doc = await HostStory.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      update,
      { new: true },
    ).lean();
    return doc ?? null;
  }

  async deleteObject(id: string) {
    let res = await HostNote.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    if (res) return true;
    res = await HostVideo.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    if (res) return true;
    res = await HostMessage.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    if (res) return true;
    res = await HostStory.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    return !!res;
  }

  async deleteManyObjects(filter: Record<string, unknown>) {
    if (filter.type === "Note") {
      return await HostNote.deleteMany({ ...filter, tenant_id: this.tenantId });
    }
    if (filter.type === "Video") {
      return await HostVideo.deleteMany({
        ...filter,
        tenant_id: this.tenantId,
      });
    }
    if (filter.type === "Message") {
      return await HostMessage.deleteMany({
        ...filter,
        tenant_id: this.tenantId,
      });
    }
    if (filter.type === "Story") {
      return await HostStory.deleteMany({
        ...filter,
        tenant_id: this.tenantId,
      });
    }
    return { deletedCount: 0 };
  }

  async listRelays() {
    const docs = await HostRelay.find({ tenant_id: this.tenantId }).lean<
      { host: string }[]
    >();
    return docs.map((d) => d.host);
  }

  async addRelay(relay: string, inboxUrl?: string) {
    const url = inboxUrl ?? `https://${relay}/inbox`;
    await HostRelay.updateOne(
      { tenant_id: this.tenantId, host: relay },
      { $set: { inboxUrl: url }, $setOnInsert: { since: new Date() } },
      { upsert: true },
    );
  }

  async removeRelay(relay: string) {
    await HostRelay.deleteOne({ tenant_id: this.tenantId, host: relay });
  }

  async addFollowerByName(username: string, follower: string) {
    await HostAccount.updateOne({ userName: username }, {
      $addToSet: { followers: follower },
    });
  }

  async removeFollowerByName(username: string, follower: string) {
    await HostAccount.updateOne({ userName: username }, {
      $pull: { followers: follower },
    });
  }

  async searchAccounts(
    query: RegExp,
    limit = 20,
  ): Promise<AccountDoc[]> {
    return await HostAccount.find({
      $or: [{ userName: query }, { displayName: query }],
    })
      .limit(limit)
      .lean<AccountDoc[]>();
  }

  async updateAccountByUserName(
    username: string,
    update: Record<string, unknown>,
  ) {
    await HostAccount.updateOne({ userName: username }, update);
  }

  async findAccountsByUserNames(
    usernames: string[],
  ): Promise<AccountDoc[]> {
    return await HostAccount.find({ userName: { $in: usernames } }).lean<
      AccountDoc[]
    >();
  }

  async countAccounts() {
    return await HostAccount.countDocuments({});
  }

  async createEncryptedMessage(data: {
    from: string;
    to: string[];
    content: string;
    mediaType?: string;
    encoding?: string;
  }) {
    const doc = await HostEncryptedMessage.create({
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
    const query = HostEncryptedMessage.find(condition);
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
    return await HostEncryptedKeyPair.findOne({ userName }).lean();
  }

  async upsertEncryptedKeyPair(userName: string, content: string) {
    await HostEncryptedKeyPair.findOneAndUpdate({ userName }, { content }, {
      upsert: true,
    });
  }

  async deleteEncryptedKeyPair(userName: string) {
    await HostEncryptedKeyPair.deleteOne({ userName });
  }

  async listKeyPackages(userName: string) {
    const tenantId = this.tenantId;
    console.log("listKeyPackages", userName, tenantId);
    return await HostKeyPackage.find({ userName, tenant_id: tenantId }).lean();
  }

  async findKeyPackage(userName: string, id: string) {
    const tenantId = this.tenantId;
    return await HostKeyPackage.findOne({
      _id: id,
      userName,
      tenant_id: tenantId,
    })
      .lean();
  }

  async createKeyPackage(
    userName: string,
    content: string,
    mediaType = "message/mls",
    encoding = "base64",
  ) {
    const doc = new HostKeyPackage({
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
    await HostKeyPackage.deleteOne({
      _id: id,
      userName,
      tenant_id: this.tenantId,
    });
  }

  async deleteKeyPackagesByUser(userName: string) {
    await HostKeyPackage.deleteMany({ userName, tenant_id: this.tenantId });
  }

  async createPublicMessage(data: {
    from: string;
    to: string[];
    content: string;
    mediaType?: string;
    encoding?: string;
  }) {
    const doc = new HostPublicMessage({
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
    const query = HostPublicMessage.find({
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
    return await HostNotification.find({ tenant_id: this.tenantId })
      .sort({ createdAt: -1 })
      .lean();
  }

  async createNotification(title: string, message: string, type: string) {
    const doc = new HostNotification({ title, message, type });
    (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals =
      {
        env: this.env,
      };
    await doc.save();
    return doc.toObject();
  }

  async markNotificationRead(id: string) {
    const res = await HostNotification.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      { read: true },
    );
    return !!res;
  }

  async deleteNotification(id: string) {
    const res = await HostNotification.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    return !!res;
  }

  async findRelaysByHosts(hosts: string[]): Promise<RelayDoc[]> {
    const docs = await HostRelay.find({ host: { $in: hosts } }).lean<
      { _id: mongoose.Types.ObjectId; host: string; inboxUrl: string }[]
    >();
    return docs.map((d) => ({
      _id: String(d._id),
      host: d.host,
      inboxUrl: d.inboxUrl,
    }));
  }

  async findRelayByHost(host: string): Promise<RelayDoc | null> {
    const doc = await HostRelay.findOne({ host }).lean<
      { _id: mongoose.Types.ObjectId; host: string; inboxUrl: string } | null
    >();
    return doc
      ? { _id: String(doc._id), host: doc.host, inboxUrl: doc.inboxUrl }
      : null;
  }

  async createRelay(
    data: { host: string; inboxUrl: string },
  ): Promise<RelayDoc> {
    const doc = new HostRelay({ host: data.host, inboxUrl: data.inboxUrl });
    await doc.save();
    return { _id: String(doc._id), host: doc.host, inboxUrl: doc.inboxUrl };
  }

  async deleteRelayById(id: string): Promise<RelayDoc | null> {
    const doc = await HostRelay.findByIdAndDelete(id).lean<
      { _id: mongoose.Types.ObjectId; host: string; inboxUrl: string } | null
    >();
    return doc
      ? { _id: String(doc._id), host: doc.host, inboxUrl: doc.inboxUrl }
      : null;
  }

  async findRemoteActorByUrl(url: string) {
    return await HostRemoteActor.findOne({ actorUrl: url }).lean();
  }

  async findRemoteActorsByUrls(urls: string[]) {
    return await HostRemoteActor.find({ actorUrl: { $in: urls } }).lean();
  }

  async upsertRemoteActor(data: {
    actorUrl: string;
    name: string;
    preferredUsername: string;
    icon: unknown;
    summary: string;
  }) {
    await HostRemoteActor.findOneAndUpdate(
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
