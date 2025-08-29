import mongoose from "mongoose";
import { followEdgeSchema } from "../../../takos/models/takos/follow_edge.ts";
import tenantScope from "../plugins/tenant_scope.ts";

followEdgeSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const FollowEdge = mongoose.models.FollowEdge ??
  mongoose.model("FollowEdge", followEdgeSchema, "follow_edge");

export default FollowEdge;
export { followEdgeSchema };

