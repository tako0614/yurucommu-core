import mongoose from "mongoose";
import type { SortOrder } from "mongoose";
import type { Db } from "mongodb";

/** タイムライン取得用オプション */
export interface ListOpts {
  limit?: number;
  before?: Date;
}

/** DB 抽象インターフェース */
export interface DB {
  getObject(id: string): Promise<unknown | null>;
  saveObject(obj: Record<string, unknown>): Promise<unknown>;
  listTimeline(actor: string, opts: ListOpts): Promise<unknown[]>;
  follow(follower: string, target: string): Promise<void>;
  unfollow?(follower: string, target: string): Promise<void>;
  saveNote(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud?: { to: string[]; cc: string[] },
  ): Promise<unknown>;
  updateNote(
    id: string,
    update: Record<string, unknown>,
  ): Promise<unknown | null>;
  deleteNote(id: string): Promise<boolean>;
  findNotes(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ): Promise<unknown[]>;
  getPublicNotes(limit: number, before?: Date): Promise<unknown[]>;
  saveVideo(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud?: { to: string[]; cc: string[] },
  ): Promise<unknown>;
  updateVideo(
    id: string,
    update: Record<string, unknown>,
  ): Promise<unknown | null>;
  deleteVideo(id: string): Promise<boolean>;
  findVideos(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ): Promise<unknown[]>;
  saveMessage(
    domain: string,
    author: string,
    content: string,
    extra: Record<string, unknown>,
    aud: { to: string[]; cc: string[] },
  ): Promise<unknown>;
  updateMessage(
    id: string,
    update: Record<string, unknown>,
  ): Promise<unknown | null>;
  deleteMessage(id: string): Promise<boolean>;
  findMessages(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ): Promise<unknown[]>;
  findObjects(
    filter: Record<string, unknown>,
    sort?: Record<string, SortOrder>,
  ): Promise<unknown[]>;
  updateObject(
    id: string,
    update: Record<string, unknown>,
  ): Promise<unknown | null>;
  deleteObject(id: string): Promise<boolean>;
  deleteManyObjects(
    filter: Record<string, unknown>,
  ): Promise<{ deletedCount?: number }>;
  listPushRelays(): Promise<string[]>;
  listPullRelays(): Promise<string[]>;
  addRelay(relay: string, mode?: "pull" | "push"): Promise<void>;
  removeRelay(relay: string): Promise<void>;
  getDatabase?(): Promise<Db>;
}

let currentUri = "";

export async function connectDatabase(env: Record<string, string>) {
  const uri = env["MONGO_URI"];
  if (!uri) return;
  if (mongoose.connection.readyState === 1 && currentUri === uri) {
    return;
  }
  currentUri = uri;
  await mongoose.connect(uri)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err: Error) => console.error("MongoDB connection error:", err));
}
