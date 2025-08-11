import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const encryptedKeyPairSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

encryptedKeyPairSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
encryptedKeyPairSchema.index({ userName: 1, tenant_id: 1 }, { unique: true });

const EncryptedKeyPair = mongoose.models.EncryptedKeyPair ??
  mongoose.model("EncryptedKeyPair", encryptedKeyPairSchema);

export default EncryptedKeyPair;
export { encryptedKeyPairSchema };
