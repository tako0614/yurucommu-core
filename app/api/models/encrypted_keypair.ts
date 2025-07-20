import mongoose from "mongoose";

const encryptedKeyPairSchema = new mongoose.Schema({
  userName: { type: String, required: true, unique: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const EncryptedKeyPair = mongoose.models.EncryptedKeyPair ??
  mongoose.model("EncryptedKeyPair", encryptedKeyPairSchema);

export default EncryptedKeyPair;
export { encryptedKeyPairSchema };
