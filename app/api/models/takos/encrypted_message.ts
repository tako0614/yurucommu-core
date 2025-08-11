import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const encryptedMessageSchema = new mongoose.Schema({
  roomId: { type: String, index: true },
  from: { type: String, required: true },
  to: { type: [String], required: true },
  content: { type: String, required: true },
  mediaType: { type: String, default: "message/mls" },
  encoding: { type: String, default: "base64" },
  createdAt: { type: Date, default: Date.now },
});

encryptedMessageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const EncryptedMessage = mongoose.models.EncryptedMessage ??
  mongoose.model("EncryptedMessage", encryptedMessageSchema);

export default EncryptedMessage;
export { encryptedMessageSchema };
