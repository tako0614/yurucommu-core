import Note from "../models/takos/note.ts";
import Message from "../models/takos/message.ts";
import Attachment from "../models/takos/attachment.ts";
import FollowEdge from "../models/takos/follow_edge.ts";
import { createObjectId, resolveRemoteActor } from "../../core/utils/activitypub.ts";
import Account from "../models/takos/account.ts";
import Notification from "../models/takos/notification.ts";
import SystemKey from "../models/takos/system_key.ts";
import RemoteActor from "../models/takos/remote_actor.ts";
import Session from "../models/takos/session.ts";
import FcmToken from "../models/takos/fcm_token.ts";
import DirectMessage from "../models/takos/direct_message.ts";
import Group from "../models/takos/group.ts";
import mongoose from "mongoose";
import type { ListOpts, SortSpec } from "../../core/db/types.ts";
import type {
  AccountDoc,
  DirectMessageDoc,
  GroupDoc,
  ListedGroup,
  SessionDoc,
} from "../../packages/types/mod.ts";
import type { FilterQuery, Model } from "mongoose";
import type { Db } from "mongodb";
import { connectDatabase } from "./mongo_conn.ts";
import { generateKeyPair } from "@takos/crypto";

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
  } catch {
    /* ignore */
  }
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

/** MongoDB 実装 */
export class MongoDB {
  constructor(private env: Record<string, string>) {}

  private async findById<T>(
    model: Model<T>,
    id: string,
    key = "_id",
  ): Promise<T | null> {
    // model.findOne's filter can be a dynamic object; cast to FilterQuery<T>
    const filter = { [key]: id } as unknown as FilterQuery<T>;
    return await model.findOne(filter)
      .lean<T | null>();
  }

  async findNoteById(id: string) {
    return await this.findById(Note, id);
  }

  async findMessageById(id: string) {
    return await this.findById(Message, id);
  }

  async findAttachmentById(id: string) {
    return await this.findById(Attachment, id);
  }

  /**
   * オブジェクトの共通項目を正規化し ID を生成します。
   */
  private normalizeObject(data: Record<string, unknown>) {
    const obj = { ...data };
    if (typeof obj.attributedTo === "string") {
      const actor = normalizeActorUrl(
        obj.attributedTo,
        this.env["ACTIVITYPUB_DOMAIN"],
      );
      obj.attributedTo = actor;
      obj.actor_id = actor;
    } else if (typeof obj.actor_id === "string") {
      const actor = normalizeActorUrl(
        obj.actor_id,
        this.env["ACTIVITYPUB_DOMAIN"],
      );
      obj.actor_id = actor;
      obj.attributedTo = actor;
    }
    if (!obj._id && this.env["ACTIVITYPUB_DOMAIN"]) {
      obj._id = createObjectId(this.env["ACTIVITYPUB_DOMAIN"]);
    }
    return obj;
  }

  /** Attachment を作成します。 */
  private async createAttachment(obj: Record<string, unknown>) {
    const data = this.normalizeObject(obj);
    const doc = new Attachment({
      _id: data._id,
      attributedTo: String(data.attributedTo),
      actor_id: String(data.actor_id),
      extra: data.extra ?? {},
    });
    await doc.save();
    return doc.toObject();
  }

  /** Note を作成します。 */
  private async createNote(obj: Record<string, unknown>) {
    const data = this.normalizeObject(obj);
    const doc = new Note({
      _id: data._id,
      attributedTo: String(data.attributedTo),
      actor_id: String(data.actor_id),
      content: String(data.content ?? ""),
      extra: data.extra ?? {},
      published: data.published ?? new Date(),
      aud: data.aud ?? { to: [], cc: [] },
    });
    await doc.save();
    return doc.toObject();
  }

  /** メディア系 Message を作成します。 */
  private async createMessage(obj: Record<string, unknown>) {
    const data = this.normalizeObject(obj);
    const objectType = typeof data.type === "string" ? data.type : "Document";
    const allowed = ["Image", "Video", "Audio", "Document"] as const;
    if (!allowed.includes(objectType as typeof allowed[number])) {
      throw new Error(`unsupported object type: ${objectType}`);
    }
    const url = typeof data.url === "string" ? data.url : "";
    const doc = new Message({
      _id: data._id,
      type: objectType,
      attributedTo: String(data.attributedTo),
      actor_id: String(data.actor_id),
      content: String(data.content ?? ""),
      url,
      mediaType: typeof data.mediaType === "string"
        ? data.mediaType
        : undefined,
      name: typeof data.name === "string" ? data.name : undefined,
      extra: data.extra ?? {},
      published: data.published ?? new Date(),
      aud: data.aud ?? { to: [], cc: [] },
    });
    await doc.save();
    return doc.toObject();
  }

  async saveObject(obj: Record<string, unknown>) {
    const objectType = typeof obj.type === "string" ? obj.type : "Note";
    if (objectType === "Attachment") {
      return await this.createAttachment(obj);
    }
    if (objectType === "Note") {
      return await this.createNote(obj);
    }
    return await this.createMessage({ ...obj, type: objectType });
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
    });
    await doc.save();
    return doc.toObject() as AccountDoc;
  }

  async findAccountById(id: string): Promise<AccountDoc | null> {
    return await this.findById<AccountDoc>(Account, id);
  }

  async findAccountByUserName(
    username: string,
  ): Promise<AccountDoc | null> {
    return await Account.findOne({ userName: username })
      .lean<AccountDoc | null>();
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

  /**
   * followers や following の配列を更新するヘルパー
   */
  private async updateAccountSet(
    id: string,
    field: "followers" | "following",
    value: string,
    action: "add" | "remove",
  ) {
    const update = action === "add"
      ? { $addToSet: { [field]: value } }
      : { $pull: { [field]: value } };
    const acc = await Account.findOneAndUpdate(
      { _id: id },
      update,
      { new: true },
    ) as { followers?: string[]; following?: string[] } | null;
    return acc?.[field] ?? [];
  }

  async addFollower(id: string, follower: string) {
    return await this.updateAccountSet(id, "followers", follower, "add");
  }

  async removeFollower(id: string, follower: string) {
    return await this.updateAccountSet(id, "followers", follower, "remove");
  }

  async addFollowing(id: string, target: string) {
    return await this.updateAccountSet(id, "following", target, "add");
  }

  async removeFollowing(id: string, target: string) {
    return await this.updateAccountSet(id, "following", target, "remove");
  }

  async saveNote(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud?: { to: string[]; cc: string[] },
  ) {
    const id = createObjectId(domain);
    const actor = normalizeActorUrl(author, domain);
    const doc = new Note({
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
    sort?: SortSpec,
  ) {
    return await Note.find({ ...filter })
      .sort(sort ?? {})
      .lean();
  }

  async getPublicNotes(limit: number, before?: Date) {
    const query = Note.find({
      "aud.to": "https://www.w3.org/ns/activitystreams#Public",
    });
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
    const actor = normalizeActorUrl(author, domain);
    const doc = new Message({
      _id: id,
      attributedTo: actor,
      actor_id: actor,
      content,
      extra,
      published: new Date(),
      aud,
    });
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
    sort?: SortSpec,
  ) {
    return await Message.find({ ...filter })
      .sort(sort ?? {})
      .lean();
  }

  async saveDMMessage(
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
    const extra: Record<string, unknown> = { type, dm: true };
    const typeMap: Record<string, string> = {
      image: "Image",
      video: "Video",
      file: "Document",
    };
    const objectType = typeMap[type] ?? "Note";
    if (attachments) extra.attachments = attachments;
    if (key) extra.key = key;
    if (iv) extra.iv = iv;
    if (preview) extra.preview = preview;
    const domain = this.env["ACTIVITYPUB_DOMAIN"] ?? "";
    const fromUrl = from.includes("://")
      ? from
      : `https://${domain}/users/${from}`;
    const id = domain ? createObjectId(domain) : undefined;
    const doc = new Message({
      _id: id,
      type: objectType,
      attributedTo: fromUrl,
      actor_id: fromUrl,
      content: content ?? "",
      url: objectType === "Note" ? undefined : url,
      mediaType: objectType === "Note" ? undefined : mediaType,
      extra,
      aud: { to: [to], cc: [] },
    });
    await doc.save();
    const obj = doc.toObject();
    return {
      id: (id ?? obj._id) as string,
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
      createdAt: obj.published as Date,
    };
  }

  async listDMsBetween(user1: string, user2: string) {
    // 異なる表記（URL/handle）を相互に許容する
    const a1 = uniq([user1, toHandle(user1), toActorUrl(user1)]);
    const a2 = uniq([user2, toHandle(user2), toActorUrl(user2)]);

    const docs = await Message.find({
      "extra.dm": true,
      $or: [
        { actor_id: { $in: a1 }, "aud.to": { $in: a2 } },
        { actor_id: { $in: a2 }, "aud.to": { $in: a1 } },
      ],
    })
      .sort({ published: 1 }).lean<{
      _id: string;
      actor_id: string;
      aud?: { to?: string[]; cc?: string[] };
      extra?: Record<string, unknown>;
      content?: string;
      published?: Date;
      url?: string;
      mediaType?: string;
    }[]>();
    return docs.map((d) => ({
      id: d._id as string,
      from: d.actor_id as string,
      to: Array.isArray(d.aud?.to) ? String(d.aud.to[0]) : "",
      type: d.extra?.type as string ?? "text",
      content: d.content as string,
      attachments: d.extra?.attachments as
        | Record<string, unknown>[]
        | undefined,
      url: typeof d.url === "string" ? d.url : undefined,
      mediaType: typeof d.mediaType === "string" ? d.mediaType : undefined,
      key: typeof d.extra?.key === "string" ? d.extra.key : undefined,
      iv: typeof d.extra?.iv === "string" ? d.extra.iv : undefined,
      preview: (d.extra?.preview && typeof d.extra.preview === "object")
        ? d.extra.preview as Record<string, unknown>
        : undefined,
      createdAt: d.published as Date ?? new Date(),
    }));
  }

  async updateObject(id: string, update: Record<string, unknown>) {
    let doc = await Note.findOneAndUpdate({ _id: id }, update, { new: true })
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
    res = await Message.findOneAndDelete({ _id: id });
    if (res) return true;
    return false;
  }

  async deleteManyObjects(filter: Record<string, unknown>) {
    if (filter.type === "Note") {
      return await Note.deleteMany({ ...filter });
    }
    if (filter.type && filter.type !== "Note") {
      return await Message.deleteMany({ ...filter });
    }
    if (!filter.type) {
      const noteQuery = Note.deleteMany({ ...filter });
      const msgQuery = Message.deleteMany({ ...filter });
      const [nr, mr] = await Promise.all([noteQuery, msgQuery]);
      return { deletedCount: (nr.deletedCount ?? 0) + (mr.deletedCount ?? 0) };
    }
    return { deletedCount: 0 };
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
    return await Account.find({ userName: { $in: usernames } })
      .lean<AccountDoc[]>();
  }

  async countAccounts() {
    return await Account.countDocuments({});
  }

  async listDirectMessages(owner: string) {
    return await DirectMessage.find({ owner })
      .lean<DirectMessageDoc[]>();
  }

  async createDirectMessage(data: DirectMessageDoc) {
    // return plain object using lean and a proper type
    const doc = await DirectMessage.findOneAndUpdate(
      { owner: data.owner, id: data.id },
      {
        $set: {
          name: data.name,
          icon: data.icon,
          members: data.members,
        },
      },
      { upsert: true, new: true },
    ).lean<DirectMessageDoc>() as DirectMessageDoc | null;
    if (!doc) {
      throw new Error("failed to create direct message");
    }
    return doc;
  }

  async updateDirectMessage(
    owner: string,
    id: string,
    update: Record<string, unknown>,
  ) {
    return await DirectMessage.findOneAndUpdate({ owner, id }, update, {
      new: true,
    })
      .lean<DirectMessageDoc | null>();
  }

  async deleteDirectMessage(owner: string, id: string) {
    const res = await DirectMessage.findOneAndDelete({ owner, id })
      .lean<DirectMessageDoc | null>();
    return res != null;
  }

  async listGroups(member: string): Promise<ListedGroup[]> {
    const acc = await Account.findOne({ userName: member })
      .lean<{ groups?: string[] } | null>();
    if (!acc) return [];
    const groups = acc.groups ?? [];
    const domain = this.env["ACTIVITYPUB_DOMAIN"];
    const localPrefix = `https://${domain}/groups/`;
    const localNames = groups.filter((g) => g.startsWith(localPrefix)).map((
      g,
    ) => g.slice(localPrefix.length));
    const locals = await Group.find({ groupName: { $in: localNames } })
      .lean<GroupDoc[]>();
    const res = locals.map((g) => {
      const icon = typeof g.icon === "string"
        ? g.icon
        : g.icon && typeof (g.icon as { url?: string }).url === "string"
        ? (g.icon as { url: string }).url
        : undefined;
      return {
        id: `https://${domain}/groups/${g.groupName}`,
        name: g.groupName,
        icon,
        members: g.followers,
      };
    });
    const remoteIds = groups.filter((g) => !g.startsWith(localPrefix));
    if (remoteIds.length > 0) {
      // Resolve remote actors and upsert them
      for (const id of remoteIds) {
        try {
          const remoteActor = await resolveRemoteActor(id, this.env);
          await this.upsertRemoteActor({
            actorUrl: remoteActor.id,
            name: remoteActor.name || "",
            preferredUsername: remoteActor.preferredUsername || "",
            icon: remoteActor.icon,
            summary: remoteActor.summary || "",
          });
        } catch (error) {
          console.error(`Failed to resolve remote actor ${id}:`, error);
        }
      }
      const remotes = await this.findRemoteActorsByUrls(remoteIds);
      const found = new Set(
        remotes.map((r: { actorUrl: string }) => r.actorUrl),
      );
      for (const r of remotes) {
        const icon = typeof r.icon === "string"
          ? r.icon
          : r.icon && typeof (r.icon as { url?: string }).url === "string"
          ? (r.icon as { url: string }).url
          : undefined;
        res.push({
          id: r.actorUrl,
          name: r.preferredUsername || r.name || r.actorUrl,
          icon,
          members: [],
        });
      }
      for (const id of remoteIds) {
        if (!found.has(id)) {
          res.push({ id, name: id, icon: undefined, members: [] });
        }
      }
    }
    return res;
  }

  async findGroupByName(name: string) {
    return await Group.findOne({ groupName: name })
      .lean<GroupDoc | null>();
  }

  async createGroup(data: Record<string, unknown>) {
    if (
      !(typeof data.publicKey === "string" &&
        typeof data.privateKey === "string")
    ) {
      const keys = await generateKeyPair();
      data.privateKey = keys.privateKey;
      data.publicKey = keys.publicKey;
    }
    const doc = new Group({ ...data });
    await doc.save();
    return doc.toObject() as GroupDoc;
  }

  async updateGroupByName(name: string, update: Record<string, unknown>) {
    return await Group.findOneAndUpdate({ groupName: name }, update, {
      new: true,
    })
      .lean<GroupDoc | null>();
  }

  async addGroupFollower(name: string, actor: string) {
    const doc = await Group.findOneAndUpdate(
      { groupName: name },
      { $addToSet: { followers: actor } },
      { new: true },
    )
      .lean<{ followers: string[] } | null>();
    const domain = this.env["ACTIVITYPUB_DOMAIN"];
    const prefix = `https://${domain}/users/`;
    if (actor.startsWith(prefix)) {
      const userName = actor.slice(prefix.length).split(/[/?#]/)[0];
      await Account.findOneAndUpdate(
        { userName },
        { $addToSet: { groups: `https://${domain}/groups/${name}` } },
      );
    }
    return doc?.followers ?? [];
  }

  async removeGroupFollower(name: string, actor: string) {
    const doc = await Group.findOneAndUpdate(
      { groupName: name },
      { $pull: { followers: actor } },
      { new: true },
    )
      .lean<{ followers: string[] } | null>();
    const domain = this.env["ACTIVITYPUB_DOMAIN"];
    const prefix = `https://${domain}/users/`;
    if (actor.startsWith(prefix)) {
      const userName = actor.slice(prefix.length).split(/[/?#]/)[0];
      await Account.findOneAndUpdate(
        { userName },
        { $pull: { groups: `https://${domain}/groups/${name}` } },
      );
    }
    return doc?.followers ?? [];
  }

  async pushGroupOutbox(name: string, activity: Record<string, unknown>) {
    await Group.updateOne(
      { groupName: name },
      { $push: { outbox: activity } },
    );
  }

  async listNotifications(owner: string) {
    return await Notification.find({ owner })
      .sort({ createdAt: -1 }).lean();
  }

  async createNotification(
    owner: string,
    title: string,
    message: string,
    type: string,
  ) {
    const doc = new Notification({ owner, title, message, type });
    await doc.save();
    return doc.toObject();
  }

  async markNotificationRead(id: string) {
    const res = await Notification.findOneAndUpdate(
      { _id: id },
      { read: true },
    );
    return !!res;
  }

  async deleteNotification(id: string) {
    const res = await Notification.findOneAndDelete({
      _id: id,
    });
    return !!res;
  }

  async findRemoteActorByUrl(url: string) {
    return await RemoteActor.findOne({ actorUrl: url })
      .lean<
        {
          actorUrl: string;
          name?: string;
          preferredUsername?: string;
          icon?: unknown;
          summary?: string;
        } | null
      >();
  }

  async findRemoteActorsByUrls(urls: string[]) {
    return await RemoteActor.find({ actorUrl: { $in: urls } })
      .lean<{
        actorUrl: string;
        name?: string;
        preferredUsername?: string;
        icon?: unknown;
        summary?: string;
      }[]>();
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
    return await SystemKey.findOne({ domain })
      .lean<
        { domain: string; privateKey: string; publicKey: string } | null
      >();
  }

  async saveSystemKey(
    domain: string,
    privateKey: string,
    publicKey: string,
  ) {
    const doc = new SystemKey({ domain, privateKey, publicKey });
    await doc.save();
  }

  async registerFcmToken(token: string, userName: string) {
    await FcmToken.updateOne({ token }, { $set: { token, userName } }, {
      upsert: true,
    });
  }

  async unregisterFcmToken(token: string) {
    await FcmToken.deleteOne({ token });
  }

  async listFcmTokens() {
    const docs = await FcmToken.find<{ token: string }>({})
      .lean();
    return docs.map((d) => ({ token: d.token }));
  }

  /**
   * セッションを保存します。
   * @param deviceId 永続的なデバイス識別子（サーバーで生成）
   */
  async createSession(
    sessionId: string,
    expiresAt: Date,
    deviceId: string,
  ): Promise<SessionDoc> {
    const doc = new Session({
      sessionId,
      deviceId,
      expiresAt,
      lastDecryptAt: new Date(),
    });
    await doc.save();
    return doc.toObject() as SessionDoc;
  }

  async findSessionById(sessionId: string): Promise<SessionDoc | null> {
    return await this.findById<SessionDoc>(Session, sessionId, "sessionId");
  }

  async deleteSessionById(sessionId: string) {
    await Session.deleteOne({ sessionId });
  }

  async updateSessionExpires(sessionId: string, expires: Date) {
    await Session.updateOne({ sessionId }, { expiresAt: expires });
  }

  async updateSessionActivity(sessionId: string, date = new Date()) {
    const threshold = new Date(date.getTime() - 1000 * 60 * 60 * 12);
    await Session.updateOne(
      {
        sessionId,
        $or: [
          { lastDecryptAt: { $lt: threshold } },
          { lastDecryptAt: { $exists: false } },
        ],
      },
      { lastDecryptAt: date },
    );
  }

  async getDatabase() {
    await connectDatabase(this.env);
    return mongoose.connection.db as Db;
  }
}
