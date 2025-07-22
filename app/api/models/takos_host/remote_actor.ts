import mongoose from "mongoose";

const remoteActorSchema = new mongoose.Schema({
  actorUrl: { type: String, required: true },
  name: { type: String, default: "" },
  preferredUsername: { type: String, default: "" },
  icon: { type: mongoose.Schema.Types.Mixed, default: null },
  summary: { type: String, default: "" },
  tenant_id: { type: String, index: true },
  cachedAt: { type: Date, default: Date.now },
});

remoteActorSchema.index({ actorUrl: 1, tenant_id: 1 }, { unique: true });
remoteActorSchema.index({ cachedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

const RemoteActor = mongoose.models.RemoteActor ??
  mongoose.model("RemoteActor", remoteActorSchema);

export default RemoteActor;
export { remoteActorSchema };
