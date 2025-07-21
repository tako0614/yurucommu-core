import ObjectStore from "./models/object_store.ts";
import { createObjectId } from "./utils/activitypub.ts";
import {
  addFollowEdge,
  addRelayEdge,
  deleteManyObjects,
  deleteMessage,
  deleteNote,
  deleteObject,
  deleteVideo,
  findMessages,
  findNotes,
  findVideos,
  getObject as getObj,
  getPublicNotes,
  getTimeline,
  listPullRelays,
  listPushRelays,
  removeFollowEdge,
  removeRelayEdge,
  saveMessage,
  saveNote,
  saveVideo,
  updateMessage,
  updateNote,
  updateObject,
  updateVideo,
} from "./services/unified_store.ts";
import mongoose from "mongoose";
import type { DB, ListOpts } from "../shared/db.ts";
import type { SortOrder } from "mongoose";
import type { Db } from "mongodb";
import { connectDatabase } from "../shared/db.ts";

/** takos 用 MongoDB 実装 */
export class MongoDBLocal implements DB {
  constructor(private env: Record<string, string>) {}

  async getObject(id: string) {
    return await getObj(this.env, id);
  }

  async saveObject(obj: Record<string, unknown>) {
    const data = { ...obj };
    if (!data._id && this.env["ACTIVITYPUB_DOMAIN"]) {
      data._id = createObjectId(this.env["ACTIVITYPUB_DOMAIN"]);
    }
    if (!("tenant_id" in data) && this.env["ACTIVITYPUB_DOMAIN"]) {
      data.tenant_id = this.env["ACTIVITYPUB_DOMAIN"];
    }
    const doc = new ObjectStore(data);
    (doc as unknown as { $locals?: { env?: Record<string, string> } }).$locals =
      { env: this.env };
    await doc.save();
    return doc.toObject();
  }

  async listTimeline(actor: string, opts: ListOpts) {
    return await getTimeline(
      this.env["ACTIVITYPUB_DOMAIN"] ?? "",
      actor,
      opts.limit ?? 40,
      opts.before,
    );
  }

  async follow(_: string, target: string) {
    const tenant = this.env["DB_MODE"] === "host"
      ? this.env["ACTIVITYPUB_DOMAIN"] ?? ""
      : "";
    await addFollowEdge(tenant, target);
  }

  async unfollow(_: string, target: string) {
    const tenant = this.env["DB_MODE"] === "host"
      ? this.env["ACTIVITYPUB_DOMAIN"] ?? ""
      : "";
    await removeFollowEdge(tenant, target);
  }

  async saveNote(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud?: { to: string[]; cc: string[] },
  ) {
    return await saveNote(this.env, domain, author, content, extra, aud);
  }

  async updateNote(id: string, update: Record<string, unknown>) {
    return await updateNote(this.env, id, update);
  }

  async deleteNote(id: string) {
    const res = await deleteNote(this.env, id);
    return !!res;
  }

  async findNotes(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await findNotes(this.env, filter, sort);
  }

  async getPublicNotes(limit: number, before?: Date) {
    return await getPublicNotes(this.env, limit, before);
  }

  async saveVideo(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud?: { to: string[]; cc: string[] },
  ) {
    return await saveVideo(this.env, domain, author, content, extra, aud);
  }

  async updateVideo(id: string, update: Record<string, unknown>) {
    return await updateVideo(this.env, id, update);
  }

  async deleteVideo(id: string) {
    const res = await deleteVideo(this.env, id);
    return !!res;
  }

  async findVideos(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await findVideos(this.env, filter, sort);
  }

  async saveMessage(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud: { to: string[]; cc: string[] },
  ) {
    return await saveMessage(this.env, domain, author, content, extra, aud);
  }

  async updateMessage(id: string, update: Record<string, unknown>) {
    return await updateMessage(this.env, id, update);
  }

  async deleteMessage(id: string) {
    const res = await deleteMessage(this.env, id);
    return !!res;
  }

  async findMessages(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    return await findMessages(this.env, filter, sort);
  }

  async findObjects(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ) {
    const notes = await findNotes(this.env, filter, sort);
    const videos = await findVideos(this.env, filter, sort);
    const messages = await findMessages(this.env, filter, sort);
    return [...notes, ...videos, ...messages];
  }

  async updateObject(id: string, update: Record<string, unknown>) {
    return await updateObject(this.env, id, update);
  }

  async deleteObject(id: string) {
    const res = await deleteObject(this.env, id);
    return !!res;
  }

  async deleteManyObjects(filter: Record<string, unknown>) {
    return await deleteManyObjects(this.env, filter);
  }

  async listPushRelays() {
    const hosts = await listPushRelays(this.env["ACTIVITYPUB_DOMAIN"] ?? "");
    return hosts;
  }

  async listPullRelays() {
    const hosts = await listPullRelays(this.env["ACTIVITYPUB_DOMAIN"] ?? "");
    return hosts;
  }

  async addRelay(relay: string, mode: "pull" | "push" = "pull") {
    const tenant = this.env["DB_MODE"] === "host"
      ? this.env["ACTIVITYPUB_DOMAIN"] ?? ""
      : "";
    await addRelayEdge(tenant, relay, mode);
  }

  async removeRelay(relay: string) {
    const tenant = this.env["DB_MODE"] === "host"
      ? this.env["ACTIVITYPUB_DOMAIN"] ?? ""
      : "";
    await removeRelayEdge(tenant, relay);
  }

  async getDatabase() {
    await connectDatabase(this.env);
    return mongoose.connection.db as Db;
  }
}

import { MongoDBHost } from "../takos_host/db.ts";

export function createDB(env: Record<string, string>): DB {
  if (env["DB_MODE"] === "host") {
    return new MongoDBHost(
      env["ACTIVITYPUB_DOMAIN"] ?? "",
      env["MONGO_URI"] ?? "",
    );
  }
  return new MongoDBLocal(env);
}
