import ObjectStore from "./models/object_store.ts";
import FollowEdge from "./models/follow_edge.ts";
import RelayEdge from "./models/relay_edge.ts";
import mongoose from "mongoose";
import type { DB, ListOpts } from "../../shared/db.ts";
import type { SortOrder } from "mongoose";
import type { Db } from "mongodb";
import { connectDatabase } from "../../shared/db.ts";
import { createObjectId } from "../api/utils/activitypub.ts";

/** takos host 用 MongoDB 実装 */
export class MongoDBHost implements DB {
  constructor(private tenantId: string, private mongoUri: string) {}

  async getObject(id: string) {
    return await ObjectStore.findOne({ _id: id, tenant_id: this.tenantId })
      .lean();
  }

  async saveObject(obj: Record<string, unknown>) {
    const data = { ...obj };
    if (!data._id) {
      data._id = createObjectId(this.tenantId);
    }
    const doc = new ObjectStore({ ...data, tenant_id: this.tenantId });
    await doc.save();
    return doc.toObject();
  }

  async listTimeline(actor: string, opts: ListOpts) {
    const docs = await FollowEdge.aggregate([
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
    await FollowEdge.updateOne(
      { tenant_id: this.tenantId, actor_id: target },
      { $setOnInsert: { since: new Date() } },
      { upsert: true },
    );
  }

  async unfollow(_: string, target: string) {
    await FollowEdge.deleteOne({ tenant_id: this.tenantId, actor_id: target });
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
    const doc = new ObjectStore({
      _id: id,
      type: "Note",
      attributedTo: author,
      actor_id: actor,
      content,
      extra,
      tenant_id: this.tenantId,
      published: new Date(),
      aud: aud ??
        { to: ["https://www.w3.org/ns/activitystreams#Public"], cc: [] },
    });
    await doc.save();
    return doc.toObject();
  }

  async updateNote(id: string, update: Record<string, unknown>) {
    return await ObjectStore.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId, type: "Note" },
      update,
      { new: true },
    ).lean();
  }

  async deleteNote(id: string) {
    const res = await ObjectStore.findOneAndDelete({
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
    return await ObjectStore.find({
      ...filter,
      tenant_id: this.tenantId,
      type: "Note",
    }).sort(sort ?? {}).lean();
  }

  async getPublicNotes(limit: number, before?: Date) {
    const query = ObjectStore.find({
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
    const doc = new ObjectStore({
      _id: id,
      type: "Video",
      attributedTo: author,
      actor_id: actor,
      content,
      extra,
      tenant_id: this.tenantId,
      published: new Date(),
      aud: aud ??
        { to: ["https://www.w3.org/ns/activitystreams#Public"], cc: [] },
    });
    await doc.save();
    return doc.toObject();
  }

  async updateVideo(id: string, update: Record<string, unknown>) {
    return await ObjectStore.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId, type: "Video" },
      update,
      { new: true },
    ).lean();
  }

  async deleteVideo(id: string) {
    const res = await ObjectStore.findOneAndDelete({
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
    return await ObjectStore.find({
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
    const doc = new ObjectStore({
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
    return await ObjectStore.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId, type: "Message" },
      update,
      { new: true },
    ).lean();
  }

  async deleteMessage(id: string) {
    const res = await ObjectStore.findOneAndDelete({
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
    return await ObjectStore.find({
      ...filter,
      tenant_id: this.tenantId,
      type: "Message",
    }).sort(sort ?? {}).lean();
  }

  async findObjects(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await ObjectStore.find({
      ...filter,
      tenant_id: this.tenantId,
    }).sort(sort ?? {}).lean();
  }

  async updateObject(id: string, update: Record<string, unknown>) {
    return await ObjectStore.findOneAndUpdate(
      { _id: id, tenant_id: this.tenantId },
      update,
      { new: true },
    ).lean();
  }

  async deleteObject(id: string) {
    const res = await ObjectStore.findOneAndDelete({
      _id: id,
      tenant_id: this.tenantId,
    });
    return !!res;
  }

  async deleteManyObjects(filter: Record<string, unknown>) {
    return await ObjectStore.deleteMany({
      ...filter,
      tenant_id: this.tenantId,
    });
  }

  async listPushRelays() {
    const docs = await RelayEdge.find({
      tenant_id: this.tenantId,
      mode: "push",
    }).lean<{ relay: string }[]>();
    return docs.map((d) => d.relay);
  }

  async listPullRelays() {
    const docs = await RelayEdge.find({
      tenant_id: this.tenantId,
      mode: "pull",
    }).lean<{ relay: string }[]>();
    return docs.map((d) => d.relay);
  }

  async addRelay(relay: string, mode: "pull" | "push" = "pull") {
    await RelayEdge.updateOne(
      { tenant_id: this.tenantId, relay, mode },
      { $setOnInsert: { since: new Date() } },
      { upsert: true },
    );
  }

  async removeRelay(relay: string) {
    await RelayEdge.deleteMany({ tenant_id: this.tenantId, relay });
  }

  async getDatabase() {
    await connectDatabase({ MONGO_URI: this.mongoUri });
    return mongoose.connection.db as Db;
  }
}
