import mongoose from "mongoose";

const followEdgeSchema = new mongoose.Schema({
  actor_id: { type: String, required: true },
  since: { type: Date, default: Date.now },
  relay: { type: String, default: null },
});

followEdgeSchema.index({ actor_id: 1 });

const FollowEdge = mongoose.models.FollowEdge ??
  mongoose.model("FollowEdge", followEdgeSchema, "follow_edge");

export default FollowEdge;
export { followEdgeSchema };
