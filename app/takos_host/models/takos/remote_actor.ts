import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const remoteActorSchema = new mongoose.Schema({
  actorUrl: { type: String, required: true },
  name: { type: String, default: "" },
  preferredUsername: { type: String, default: "" },
  icon: { type: mongoose.Schema.Types.Mixed, default: null },
  summary: { type: String, default: "" },
  cachedAt: { type: Date, default: Date.now },
});

remoteActorSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
// テナント毎にユニーク
remoteActorSchema.index({ actorUrl: 1, tenant_id: 1 }, { unique: true });

// 24時間後に自動削除されるTTLインデックス
remoteActorSchema.index({ cachedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

const RemoteActor = mongoose.models.RemoteActor ??
  mongoose.model("RemoteActor", remoteActorSchema);

export default RemoteActor;
export { remoteActorSchema };

