import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const faspClientProviderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  baseUrl: { type: String, required: true },
  serverId: { type: String, required: true },
  faspId: { type: String, required: true },
  publicKey: { type: String, default: "" },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  capabilities: { type: mongoose.Schema.Types.Mixed, default: {} },
  secret: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  approvedAt: { type: Date, default: null },
  rejectedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { collection: "fasp_client_providers" });

faspClientProviderSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
faspClientProviderSchema.index({ baseUrl: 1, tenant_id: 1 }, { unique: true });
faspClientProviderSchema.index({ serverId: 1, tenant_id: 1 }, { unique: true });

faspClientProviderSchema.pre("save", function (next) {
  (this as unknown as { updatedAt?: Date }).updatedAt = new Date();
  next();
});

const HostFaspClientProvider = mongoose.models.HostFaspClientProvider ??
  mongoose.model("HostFaspClientProvider", faspClientProviderSchema);

export default HostFaspClientProvider;
export { faspClientProviderSchema };