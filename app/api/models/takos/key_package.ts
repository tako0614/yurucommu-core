import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const keyPackageSchema = new mongoose.Schema({
  userName: { type: String, required: true, index: true },
  content: { type: String, required: true },
  mediaType: { type: String, default: "message/mls" },
  encoding: { type: String, default: "base64" },
  groupInfo: { type: String },
  used: { type: Boolean, default: false },
  expiresAt: { type: Date },
  tenant_id: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
});

keyPackageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
keyPackageSchema.index({ userName: 1, tenant_id: 1 });

const KeyPackage = mongoose.models.KeyPackage ??
  mongoose.model("KeyPackage", keyPackageSchema);

export default KeyPackage;
export { keyPackageSchema };
