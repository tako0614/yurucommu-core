import mongoose from "mongoose";

const remoteActorSchema = new mongoose.Schema({
  actorUrl: { type: String, required: true, unique: true },
  name: { type: String, default: "" },
  preferredUsername: { type: String, default: "" },
  icon: { type: mongoose.Schema.Types.Mixed, default: null },
  summary: { type: String, default: "" },
  cachedAt: { type: Date, default: Date.now },
});

// 24時間後に自動削除されるTTLインデックス
remoteActorSchema.index({ cachedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

const RemoteActor = mongoose.models.RemoteActor ??
  mongoose.model("RemoteActor", remoteActorSchema);

export default RemoteActor;
export { remoteActorSchema };
