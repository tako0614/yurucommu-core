import mongoose from "mongoose";
import { remoteActorSchema } from "../../../takos/models/takos/remote_actor.ts";

const HostRemoteActor = mongoose.models.HostRemoteActor ??
  mongoose.model("HostRemoteActor", remoteActorSchema, "remoteactors");

export default HostRemoteActor;
export { remoteActorSchema };
