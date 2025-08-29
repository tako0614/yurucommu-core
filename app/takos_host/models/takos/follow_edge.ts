import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const followEdgeSchema = new mongoose.Schema({
  actor_id: { type: String, required: true },
  since: { type: Date, default: Date.now },
  relay: { type: String, default: null },
});

followEdgeSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const FollowEdge = mongoose.models.FollowEdge ??
  mongoose.model("FollowEdge", followEdgeSchema, "follow_edge");

export default FollowEdge;
export { followEdgeSchema };

