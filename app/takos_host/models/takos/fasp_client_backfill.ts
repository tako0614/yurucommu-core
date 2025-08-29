import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const faspClientBackfillSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now },
  continuedAt: { type: Date, default: null },
}, { collection: "fasp_client_backfills" });

faspClientBackfillSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const HostFaspClientBackfill = mongoose.models.HostFaspClientBackfill ??
  mongoose.model("HostFaspClientBackfill", faspClientBackfillSchema);

export default HostFaspClientBackfill;
export { faspClientBackfillSchema };