import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const systemKeySchema = new mongoose.Schema({
  domain: { type: String, required: true },
  privateKey: { type: String, required: true },
  publicKey: { type: String, required: true },
});

systemKeySchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
systemKeySchema.index({ domain: 1, tenant_id: 1 }, { unique: true });

const SystemKey = mongoose.models.SystemKey ??
  mongoose.model("SystemKey", systemKeySchema, "system_key");

export default SystemKey;
export { systemKeySchema };

