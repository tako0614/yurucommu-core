// D1/SQLite 初期化 SQL (takos 用). Prisma スキーマ(app/takos/prisma/schema.prisma)に対応。
// Cloudflare D1 / libsql 互換を意識して、IF NOT EXISTS とシンプルな型を使用します。

export const D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS Account (
  id TEXT PRIMARY KEY,
  userName TEXT NOT NULL UNIQUE,
  displayName TEXT NOT NULL DEFAULT '',
  avatarInitial TEXT NOT NULL DEFAULT '',
  privateKey TEXT NOT NULL DEFAULT '',
  publicKey TEXT NOT NULL DEFAULT '',
  groupOverrides TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS FollowEdge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actorId TEXT NOT NULL,
  targetId TEXT NOT NULL,
  since INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  relay TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_FollowEdge_actor_target ON FollowEdge(actorId, targetId);
CREATE INDEX IF NOT EXISTS idx_FollowEdge_actor ON FollowEdge(actorId);
CREATE INDEX IF NOT EXISTS idx_FollowEdge_target ON FollowEdge(targetId);

CREATE TABLE IF NOT EXISTS Note (
  id TEXT PRIMARY KEY,
  attributedTo TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  deleted_at INTEGER,
  aud_to TEXT NOT NULL DEFAULT '',
  aud_cc TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_Note_actor ON Note(actor_id);
CREATE INDEX IF NOT EXISTS idx_Note_created_at ON Note(created_at);

CREATE TABLE IF NOT EXISTS Message (
  id TEXT PRIMARY KEY,
  attributedTo TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  url TEXT,
  mediaType TEXT,
  name TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  deleted_at INTEGER,
  aud_to TEXT NOT NULL DEFAULT '',
  aud_cc TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_Message_actor ON Message(actor_id);
CREATE INDEX IF NOT EXISTS idx_Message_created_at ON Message(created_at);

CREATE TABLE IF NOT EXISTS Attachment (
  id TEXT PRIMARY KEY,
  attributedTo TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  extra TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_Attachment_actor ON Attachment(actor_id);

CREATE TABLE IF NOT EXISTS "Group" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  groupName TEXT NOT NULL UNIQUE,
  displayName TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  icon TEXT,
  image TEXT,
  privateKey TEXT NOT NULL DEFAULT '',
  publicKey TEXT NOT NULL DEFAULT '',
  membershipPolicy TEXT NOT NULL DEFAULT 'open',
  invitePolicy TEXT NOT NULL DEFAULT 'members',
  visibility TEXT NOT NULL DEFAULT 'public',
  allowInvites INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS GroupFollower (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  groupName TEXT NOT NULL,
  actor TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_GroupFollower_unique ON GroupFollower(groupName, actor);
CREATE INDEX IF NOT EXISTS idx_GroupFollower_group ON GroupFollower(groupName);

CREATE TABLE IF NOT EXISTS GroupOutbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  groupName TEXT NOT NULL,
  activity TEXT NOT NULL,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_GroupOutbox_group ON GroupOutbox(groupName);

CREATE TABLE IF NOT EXISTS Notification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  read INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_Notification_owner_created ON Notification(owner, createdAt);

CREATE TABLE IF NOT EXISTS SystemKey (
  domain TEXT PRIMARY KEY,
  privateKey TEXT NOT NULL,
  publicKey TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS RemoteActor (
  actorUrl TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  preferredUsername TEXT NOT NULL DEFAULT '',
  icon TEXT,
  summary TEXT NOT NULL DEFAULT '',
  cachedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS Session (
  sessionId TEXT PRIMARY KEY,
  deviceId TEXT NOT NULL,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  expiresAt INTEGER NOT NULL,
  lastDecryptAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_Session_device ON Session(deviceId);

CREATE TABLE IF NOT EXISTS FcmToken (
  token TEXT PRIMARY KEY,
  userName TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS DirectMessage (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY (owner, id)
);

CREATE TABLE IF NOT EXISTS Invite (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  groupName TEXT NOT NULL,
  actor TEXT NOT NULL,
  inviter TEXT,
  expiresAt INTEGER,
  remainingUses INTEGER NOT NULL DEFAULT 1,
  accepted INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_Invite_unique ON Invite(groupName, actor);

CREATE TABLE IF NOT EXISTS Approval (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  groupName TEXT NOT NULL,
  actor TEXT NOT NULL,
  activity TEXT,
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_Approval_unique ON Approval(groupName, actor);

CREATE TABLE IF NOT EXISTS FaspClientSettings (
  id TEXT PRIMARY KEY,
  shareEnabled INTEGER,
  shareServerIds TEXT,
  searchServerId TEXT
);

CREATE TABLE IF NOT EXISTS FaspClientProvider (
  baseUrl TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  serverId TEXT NOT NULL,
  publicKey TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  faspId TEXT,
  approvedAt INTEGER,
  rejectedAt INTEGER,
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS FaspEventSubscription (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS FaspBackfill (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  continuedAt INTEGER
);
`;

export default D1_SCHEMA;

