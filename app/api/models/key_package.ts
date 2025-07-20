import mongoose from "mongoose";

const keyPackageSchema = new mongoose.Schema({
  userName: { type: String, required: true, index: true },
  content: { type: String, required: true },
  mediaType: { type: String, default: "message/mls" },
  encoding: { type: String, default: "base64" },
  createdAt: { type: Date, default: Date.now },
});

const KeyPackage = mongoose.models.KeyPackage ??
  mongoose.model("KeyPackage", keyPackageSchema);

export default KeyPackage;
export { keyPackageSchema };
