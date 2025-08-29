import mongoose from "mongoose";
import { remoteActorSchema } from "../../../takos/models/takos/remote_actor.ts";
import tenantScope from "../plugins/tenant_scope.ts";

remoteActorSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
// テナント毎にユニーク
remoteActorSchema.index({ actorUrl: 1, tenant_id: 1 }, { unique: true });

const RemoteActor = mongoose.models.RemoteActor ??
  mongoose.model("RemoteActor", remoteActorSchema);

export default RemoteActor;
export { remoteActorSchema };

