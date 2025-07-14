import mongoose from "mongoose";

const followEdgeSchema = new mongoose.Schema({
  tenant_id: { type: String, required: true },
  actor_id: { type: String, required: true },
  since: { type: Date, default: Date.now },
  relay: { type: String, default: null },
});

followEdgeSchema.index({ actor_id: 1, tenant_id: 1 });

const FollowEdge = mongoose.model(
  "FollowEdge",
  followEdgeSchema,
  "follow_edge",
);

export default FollowEdge;
export { followEdgeSchema };
