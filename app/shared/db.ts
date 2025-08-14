import mongoose from "mongoose";
import type { SortOrder } from "mongoose";
import type { Db } from "mongodb";
import type { AccountDoc, SessionDoc } from "./types.ts";

// MLS のグループ状態を表す型（詳細はクライアント側で定義）
type StoredGroupState = Record<string, unknown>;

/** タイムライン取得用オプション */
export interface ListOpts {
  limit?: number;
  before?: Date;
}

/** チャットルーム情報 */
export interface ChatroomInfo {
  id: string;
  name: string;
  icon?: string;
  userSet?: { name?: boolean; icon?: boolean };
  members: string[];
  mls?: StoredGroupState | null;
}

/** DB 抽象インターフェース */
export interface DB {
  getObject(id: string): Promise<unknown | null>;
  saveObject(obj: Record<string, unknown>): Promise<unknown>;
  listTimeline(actor: string, opts: ListOpts): Promise<unknown[]>;
  follow(follower: string, target: string): Promise<void>;
  unfollow?(follower: string, target: string): Promise<void>;
  listAccounts(): Promise<AccountDoc[]>;
  createAccount(data: Record<string, unknown>): Promise<AccountDoc>;
  findAccountById(id: string): Promise<AccountDoc | null>;
  findAccountByUserName(username: string): Promise<AccountDoc | null>;
  updateAccountById(
    id: string,
    update: Record<string, unknown>,
  ): Promise<AccountDoc | null>;
  deleteAccountById(id: string): Promise<boolean>;
  addFollower(id: string, follower: string): Promise<string[]>;
  removeFollower(id: string, follower: string): Promise<string[]>;
  addFollowing(id: string, target: string): Promise<string[]>;
  removeFollowing(id: string, target: string): Promise<string[]>;
  listChatrooms(
    id: string,
  ): Promise<ChatroomInfo[]>;
  listChatroomsByMember(
    member: string,
  ): Promise<ChatroomInfo[]>;
  addChatroom(
    id: string,
    room: ChatroomInfo,
  ): Promise<ChatroomInfo[]>;
  removeChatroom(
    id: string,
    roomId: string,
  ): Promise<ChatroomInfo[]>;
  findChatroom(
    roomId: string,
  ): Promise<
    {
      owner: string;
      room: ChatroomInfo;
    } | null
  >;
  updateChatroom(
    owner: string,
    room: ChatroomInfo,
  ): Promise<void>;
  updateSessionActivity(
    sessionId: string,
    date?: Date,
  ): Promise<void>;
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
  addFollowerByName(username: string, follower: string): Promise<void>;
  removeFollowerByName(username: string, follower: string): Promise<void>;
  searchAccounts(query: RegExp, limit?: number): Promise<AccountDoc[]>;
  updateAccountByUserName(
    username: string,
    update: Record<string, unknown>,
  ): Promise<void>;
  findAccountsByUserNames(usernames: string[]): Promise<AccountDoc[]>;
  countAccounts(): Promise<number>;
  createEncryptedMessage(data: {
    roomId?: string;
    from: string;
    to: string[];
    content: string;
    mediaType?: string;
    encoding?: string;
  }): Promise<unknown>;
  findEncryptedMessages(
    condition: Record<string, unknown>,
    opts?: { before?: string; after?: string; limit?: number },
  ): Promise<unknown[]>;
  createHandshakeMessage(data: {
    roomId?: string;
    sender: string;
    recipients: string[];
    message: string;
  }): Promise<unknown>;
  findHandshakeMessages(
    condition: Record<string, unknown>,
    opts?: { before?: string; after?: string; limit?: number },
  ): Promise<unknown[]>;
  findEncryptedKeyPair(
    userName: string,
    deviceId: string,
  ): Promise<unknown | null>;
  upsertEncryptedKeyPair(
    userName: string,
    deviceId: string,
    content: string,
  ): Promise<void>;
  deleteEncryptedKeyPair(userName: string, deviceId: string): Promise<void>;
  deleteEncryptedKeyPairsByUser(userName: string): Promise<void>;
  findMLSState(
    roomId: string,
    userName: string,
    deviceId: string,
  ): Promise<string | null>;
  upsertMLSState(
    roomId: string,
    userName: string,
    deviceId: string,
    state: string,
  ): Promise<void>;
  deleteMLSState(
    roomId: string,
    userName: string,
    deviceId: string,
  ): Promise<void>;
  listKeyPackages(userName: string): Promise<unknown[]>;
  findKeyPackage(userName: string, id: string): Promise<unknown | null>;
  createKeyPackage(
    userName: string,
    content: string,
    mediaType?: string,
    encoding?: string,
    groupInfo?: string,
    expiresAt?: Date,
    deviceId?: string,
    version?: string,
    cipherSuite?: number,
    generator?: string,
    id?: string,
  ): Promise<unknown>;
  markKeyPackageUsed(userName: string, id: string): Promise<void>;
  cleanupKeyPackages(userName: string): Promise<void>;
  deleteKeyPackage(userName: string, id: string): Promise<void>;
  deleteKeyPackagesByUser(userName: string): Promise<void>;
  savePendingInvite(
    roomId: string,
    userName: string,
    deviceId: string,
    expiresAt: Date,
  ): Promise<void>;
  markInviteAcked(
    roomId: string,
    userName: string,
    deviceId: string,
  ): Promise<void>;
  listNotifications(): Promise<unknown[]>;
  createNotification(
    title: string,
    message: string,
    type: string,
  ): Promise<unknown>;
  markNotificationRead(id: string): Promise<boolean>;
  deleteNotification(id: string): Promise<boolean>;
  findSystemKey(domain: string): Promise<
    {
      domain: string;
      privateKey: string;
      publicKey: string;
    } | null
  >;
  saveSystemKey(
    domain: string,
    privateKey: string,
    publicKey: string,
  ): Promise<void>;
  registerFcmToken(token: string, userName: string): Promise<void>;
  unregisterFcmToken(token: string): Promise<void>;
  listFcmTokens(): Promise<{ token: string }[]>;
  ensureTenant(id: string, domain: string): Promise<void>;
  /** インスタンス一覧取得 */
  listInstances(owner: string): Promise<{ host: string }[]>;
  /** インスタンス数取得 */
  countInstances(owner: string): Promise<number>;
  /** ホスト名でインスタンス検索 */
  findInstanceByHost(
    host: string,
  ): Promise<
    | { _id: string; host: string; owner: string; env?: Record<string, string> }
    | null
  >;
  /** ホスト名と所有者でインスタンス検索 */
  findInstanceByHostAndOwner(
    host: string,
    owner: string,
  ): Promise<
    { _id: string; host: string; env?: Record<string, string> } | null
  >;
  /** インスタンス作成 */
  createInstance(
    data: { host: string; owner: string; env?: Record<string, string> },
  ): Promise<void>;
  /** インスタンス環境変数更新 */
  updateInstanceEnv(id: string, env: Record<string, string>): Promise<void>;
  /** インスタンス削除 */
  deleteInstance(host: string, owner: string): Promise<void>;
  /** OAuth クライアント一覧 */
  listOAuthClients(): Promise<{ clientId: string; redirectUri: string }[]>;
  /** OAuth クライアント検索 */
  findOAuthClient(
    clientId: string,
  ): Promise<{ clientSecret: string } | null>;
  /** OAuth クライアント作成 */
  createOAuthClient(
    data: { clientId: string; clientSecret: string; redirectUri: string },
  ): Promise<void>;
  /** ドメイン一覧取得 */
  listHostDomains(
    user: string,
  ): Promise<{ domain: string; verified: boolean }[]>;
  /** ドメイン検索 */
  findHostDomain(
    domain: string,
    user?: string,
  ): Promise<{ _id: string; token: string; verified: boolean } | null>;
  /** ドメイン登録 */
  createHostDomain(domain: string, user: string, token: string): Promise<void>;
  /** ドメイン認証フラグ更新 */
  verifyHostDomain(id: string): Promise<void>;
  findRemoteActorByUrl(url: string): Promise<unknown | null>;
  findRemoteActorsByUrls(urls: string[]): Promise<unknown[]>;
  upsertRemoteActor(data: {
    actorUrl: string;
    name: string;
    preferredUsername: string;
    icon: unknown;
    summary: string;
  }): Promise<void>;
  /**
   * セッションを作成します。
   */
  createSession(
    sessionId: string,
    expiresAt: Date,
  ): Promise<SessionDoc>;
  findSessionById(sessionId: string): Promise<SessionDoc | null>;
  deleteSessionById(sessionId: string): Promise<void>;
  updateSessionExpires(sessionId: string, expires: Date): Promise<void>;
  getDatabase(): Promise<Db>;
}

let currentUri = "";

export async function connectDatabase(env: Record<string, string>) {
  const uri = env["MONGO_URI"];
  if (!uri) return;
  if (mongoose.connection.readyState === 1 && currentUri === uri) {
    return;
  }
  currentUri = uri;
  // populate の対象パスがスキーマに存在しない場合でもエラーとしない
  mongoose.set("strictPopulate", false);
  await mongoose.connect(uri)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err: Error) => console.error("MongoDB connection error:", err));
}
