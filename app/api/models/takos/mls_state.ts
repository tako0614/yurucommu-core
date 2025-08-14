import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const mlsStateSchema = new mongoose.Schema({
  roomId: { type: String, required: true },
  userName: { type: String, required: true },
  deviceId: { type: String, required: true },
  state: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
});

mlsStateSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
mlsStateSchema.index({
  roomId: 1,
  userName: 1,
  deviceId: 1,
  tenant_id: 1,
}, { unique: true });

const MLSState = mongoose.models.MLSState ??
  mongoose.model("MLSState", mlsStateSchema);

export default MLSState;
export { mlsStateSchema };
