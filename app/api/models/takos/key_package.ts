import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const keyPackageSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
  },
  userName: { type: String, required: true, index: true },
  deviceId: { type: String },
  content: { type: String, required: true },
  mediaType: { type: String, default: "message/mls" },
  encoding: { type: String, default: "base64" },
  // MLS KeyPackageRef (SHA-256 hash hex of the raw KeyPackage bytes)
  keyPackageRef: { type: String, index: true },
  lastResort: { type: Boolean, default: false },
  groupInfo: { type: String },
  version: { type: String },
  cipherSuite: { type: Number },
  generator: { type: String },
  used: { type: Boolean, default: false },
  expiresAt: { type: Date },
  tenant_id: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
});

keyPackageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
keyPackageSchema.index({ userName: 1, deviceId: 1, tenant_id: 1 });

const KeyPackage = mongoose.models.KeyPackage ??
  mongoose.model("KeyPackage", keyPackageSchema);

export default KeyPackage;
export { keyPackageSchema };
