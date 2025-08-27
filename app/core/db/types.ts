// 新しいドメイン指向の DB 抽象（MongoDB など具体実装に依存しない）

import type {
  AccountDoc,
  DirectMessageDoc,
  GroupDoc,
  ListedGroup,
  SessionDoc,
} from "@takos/types";

export interface ListOpts {
  limit?: number;
  before?: Date;
}
export type SortSpec = Record<string, 1 | -1 | "asc" | "desc">;

export interface AccountsRepo {
  list(): Promise<AccountDoc[]>;
  create(data: Record<string, unknown>): Promise<AccountDoc>;
  findById(id: string): Promise<AccountDoc | null>;
  findByUserName(username: string): Promise<AccountDoc | null>;
  updateById(
    id: string,
    update: Record<string, unknown>,
  ): Promise<AccountDoc | null>;
  deleteById(id: string): Promise<boolean>;
  addFollower(id: string, follower: string): Promise<string[]>;
  removeFollower(id: string, follower: string): Promise<string[]>;
  addFollowing(id: string, target: string): Promise<string[]>;
  removeFollowing(id: string, target: string): Promise<string[]>;
  addFollowerByName(username: string, follower: string): Promise<void>;
  removeFollowerByName(username: string, follower: string): Promise<void>;
  search(query: RegExp, limit?: number): Promise<AccountDoc[]>;
  updateByUserName(
    username: string,
    update: Record<string, unknown>,
  ): Promise<void>;
  findByUserNames(usernames: string[]): Promise<AccountDoc[]>;
  count(): Promise<number>;
}

export interface PostsRepo {
  findNoteById(id: string): Promise<unknown | null>;
  findMessageById(id: string): Promise<unknown | null>;
  findAttachmentById(id: string): Promise<unknown | null>;
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
    sort?: SortSpec,
  ): Promise<unknown[]>;
  getPublicNotes(limit: number, before?: Date): Promise<unknown[]>;
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
    sort?: SortSpec,
  ): Promise<unknown[]>;
  updateObject(
    id: string,
    update: Record<string, unknown>,
  ): Promise<unknown | null>;
  deleteObject(id: string): Promise<boolean>;
  deleteManyObjects(
    filter: Record<string, unknown>,
  ): Promise<{ deletedCount?: number }>;
}

export interface DMRepo {
  save(
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
  ): Promise<unknown>;
  listBetween(user1: string, user2: string): Promise<unknown[]>;
  list(owner: string): Promise<DirectMessageDoc[]>;
  create(data: DirectMessageDoc): Promise<DirectMessageDoc>;
  update(
    owner: string,
    id: string,
    update: Record<string, unknown>,
  ): Promise<DirectMessageDoc | null>;
  delete(owner: string, id: string): Promise<boolean>;
}

export interface GroupsRepo {
  list(member: string): Promise<ListedGroup[]>;
  findByName(name: string): Promise<GroupDoc | null>;
  create(data: Record<string, unknown>): Promise<GroupDoc>;
  updateByName(
    name: string,
    update: Record<string, unknown>,
  ): Promise<GroupDoc | null>;
  addFollower(name: string, actor: string): Promise<string[]>;
  removeFollower(name: string, actor: string): Promise<string[]>;
  pushOutbox(name: string, activity: Record<string, unknown>): Promise<void>;
}

export interface NotificationsRepo {
  list(owner: string): Promise<unknown[]>;
  create(
    owner: string,
    title: string,
    message: string,
    type: string,
  ): Promise<unknown>;
  markRead(id: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

export interface SystemRepo {
  findKey(
    domain: string,
  ): Promise<{ domain: string; privateKey: string; publicKey: string } | null>;
  saveKey(domain: string, privateKey: string, publicKey: string): Promise<void>;
  findRemoteActorByUrl(url: string): Promise<unknown | null>;
  findRemoteActorsByUrls(urls: string[]): Promise<unknown[]>;
  upsertRemoteActor(
    data: {
      actorUrl: string;
      name: string;
      preferredUsername: string;
      icon: unknown;
      summary: string;
    },
  ): Promise<void>;
}

export interface SessionsRepo {
  create(
    sessionId: string,
    expiresAt: Date,
    deviceId: string,
  ): Promise<SessionDoc>;
  findById(sessionId: string): Promise<SessionDoc | null>;
  deleteById(sessionId: string): Promise<void>;
  updateExpires(sessionId: string, expires: Date): Promise<void>;
  updateActivity(sessionId: string, date?: Date): Promise<void>;
}

export interface FcmRepo {
  register(token: string, userName: string): Promise<void>;
  unregister(token: string): Promise<void>;
  list(): Promise<{ token: string }[]>;
}

export interface DataStore {
  accounts: AccountsRepo;
  posts: PostsRepo;
  dms: DMRepo;
  groups: GroupsRepo;
  notifications: NotificationsRepo;
  system: SystemRepo;
  sessions: SessionsRepo;
  fcm: FcmRepo;
  /** 実装依存の生コネクション（必要時のみ使用） */
  raw?(): Promise<unknown>;
}
