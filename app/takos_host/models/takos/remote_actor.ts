import mongoose from "mongoose";
import { remoteActorSchema } from "../../../takos/models/takos/remote_actor.ts";
import tenantScope from "../plugins/tenant_scope.ts";

remoteActorSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
remoteActorSchema.index({ actorUrl: 1, tenant_id: 1 }, { unique: true });

const HostRemoteActor = mongoose.models.HostRemoteActor ??
  mongoose.model("HostRemoteActor", remoteActorSchema, "remoteactors");

export default HostRemoteActor;
export { remoteActorSchema };
