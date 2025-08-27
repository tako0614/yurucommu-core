import mongoose from "mongoose";
import { followEdgeSchema } from "../../../takos/models/takos/follow_edge.ts";
import tenantScope from "../plugins/tenant_scope.ts";

followEdgeSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
followEdgeSchema.index({ actor_id: 1, tenant_id: 1 });

const HostFollowEdge = mongoose.models.HostFollowEdge ??
  mongoose.model("HostFollowEdge", followEdgeSchema, "follow_edge");

export default HostFollowEdge;
export { followEdgeSchema };
