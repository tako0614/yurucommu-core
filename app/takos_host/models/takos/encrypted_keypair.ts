import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

// encryptedKeyPair schema was previously expected to live at
// ../takos/encrypted_keypair.ts but that file is missing. Define the
// schema locally to avoid a broken import while keeping the same shape.
const encryptedKeyPairSchema = new mongoose.Schema({
  domain: { type: String, required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "Account" },
  // hex/base64 encoded ciphertexts
  encryptedPrivateKey: { type: String, required: true },
  publicKey: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

encryptedKeyPairSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
encryptedKeyPairSchema.index({ domain: 1, tenant_id: 1 }, { unique: true });

const HostEncryptedKeyPair = mongoose.models.HostEncryptedKeyPair ??
  mongoose.model(
    "HostEncryptedKeyPair",
    encryptedKeyPairSchema,
    "encryptedkeypairs",
  );

export default HostEncryptedKeyPair;
export { encryptedKeyPairSchema };
