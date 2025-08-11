import mongoose from "mongoose";

const encryptedMessageSchema = new mongoose.Schema({
  roomId: { type: String, index: true },
  from: { type: String, required: true },
  to: { type: [String], required: true },
  content: { type: String, required: true },
  mediaType: { type: String, default: "message/mls" },
  encoding: { type: String, default: "base64" },
  tenant_id: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
});

const HostEncryptedMessage = mongoose.models.HostEncryptedMessage ??
  mongoose.model("HostEncryptedMessage", encryptedMessageSchema);

export default HostEncryptedMessage;
export { encryptedMessageSchema };
