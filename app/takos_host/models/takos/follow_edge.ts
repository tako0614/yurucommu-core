import mongoose from "mongoose";
import { followEdgeSchema } from "../../../takos/models/takos/follow_edge.ts";

const HostFollowEdge = mongoose.models.HostFollowEdge ??
  mongoose.model("HostFollowEdge", followEdgeSchema, "follow_edge");

export default HostFollowEdge;
export { followEdgeSchema };
