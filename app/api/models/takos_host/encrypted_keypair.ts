import mongoose from "mongoose";

const encryptedKeyPairSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  content: { type: String, required: true },
  tenant_id: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
});

encryptedKeyPairSchema.index({ userName: 1, tenant_id: 1 }, { unique: true });

const EncryptedKeyPair = mongoose.models.EncryptedKeyPair ??
  mongoose.model("EncryptedKeyPair", encryptedKeyPairSchema);

export default EncryptedKeyPair;
export { encryptedKeyPairSchema };
