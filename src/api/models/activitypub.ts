import mongoose from "mongoose";

// ActivityPub オブジェクトのスキーマ
const activityPubObjectSchema = new mongoose.Schema({
  // ActivityStreamsの基本プロパティ
  id: {
    type: String,
    required: true,
    unique: true,
  },
  type: {
    type: String,
    required: true,
    index: true,
  },
  actor: {
    type: String,
    required: true,
    index: true,
  },
  object: {
    type: mongoose.Schema.Types.Mixed, // 柔軟にオブジェクトを保存
  },
  target: {
    type: String,
  },
  to: [{
    type: String,
  }],
  cc: [{
    type: String,
  }],
  published: {
    type: Date,
    default: Date.now,
    index: true,
  },
  content: {
    type: String,
  },
  summary: {
    type: String,
  },
  // 拡張用の生データ
  rawObject: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  // メタデータ
  isLocal: {
    type: Boolean,
    default: true,
    index: true,
  },
  userId: {
    type: String, // ローカルユーザーのID
    index: true,
  },
}, {
  timestamps: true,
});

// ActivityPub アクター（既存のAccountに加えて、プラグインアクターなど）
const activityPubActorSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
  },
  type: {
    type: String,
    required: true,
    default: "Person",
    index: true,
  },
  preferredUsername: {
    type: String,
    required: true,
    index: true,
  },
  name: {
    type: String,
  },
  summary: {
    type: String,
  },
  icon: {
    type: mongoose.Schema.Types.Mixed,
  },
  image: {
    type: mongoose.Schema.Types.Mixed,
  },
  inbox: {
    type: String,
    required: true,
  },
  outbox: {
    type: String,
    required: true,
  },
  followers: {
    type: String,
  },
  following: {
    type: String,
  },
  publicKey: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  privateKeyPem: {
    type: String, // ローカルアクターのみ
  },
  // 拡張プロパティ
  extensions: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  // メタデータ
  isLocal: {
    type: Boolean,
    default: true,
    index: true,
  },
  isPlugin: {
    type: Boolean,
    default: false,
    index: true,
  },
  pluginIdentifier: {
    type: String, // プラグインが作成したアクターの場合
    index: true,
  },
  // 生データ
  rawActor: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
}, {
  timestamps: true,
});

// フォロー関係
const followSchema = new mongoose.Schema({
  follower: {
    type: String,
    required: true,
    index: true,
  },
  following: {
    type: String,
    required: true,
    index: true,
  },
  accepted: {
    type: Boolean,
    default: false,
    index: true,
  },
  activityId: {
    type: String, // Follow アクティビティのID
  },
}, {
  timestamps: true,
});

// 複合インデックス
followSchema.index({ follower: 1, following: 1 }, { unique: true });

// コミュニティ・グループ
const communitySchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
  },
  type: {
    type: String,
    required: true,
    enum: ["Community", "ChatGroup"],
    index: true,
  },
  preferredUsername: {
    type: String,
    required: true,
    index: true,
  },
  name: {
    type: String,
  },
  summary: {
    type: String,
  },
  mode: {
    type: String,
    enum: ["public", "protected", "private"],
    default: "public",
    index: true,
  },
  members: [{
    actor: String,
    role: {
      type: String,
      enum: ["owner", "mod", "member"],
      default: "member",
    },
    joined: {
      type: Date,
      default: Date.now,
    },
  }],
  managers: [{
    type: String, // Actor IRI
  }],
  banned: [{
    type: String, // Actor IRI
  }],
  // 拡張プロパティ
  extensions: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  // 生データ
  rawActor: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
}, {
  timestamps: true,
});

export const ActivityPubObject = mongoose.model("ActivityPubObject", activityPubObjectSchema);
export const ActivityPubActor = mongoose.model("ActivityPubActor", activityPubActorSchema);
export const Follow = mongoose.model("Follow", followSchema);
export const Community = mongoose.model("Community", communitySchema);
