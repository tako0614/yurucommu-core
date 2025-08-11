import mongoose from "mongoose";

const handshakeMessageSchema = new mongoose.Schema({
  roomId: { type: String, index: true },
  sender: { type: String, required: true },
  recipients: { type: [String], required: true },
  message: { type: String, required: true },
  tenant_id: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
});

const HostHandshakeMessage = mongoose.models.HostHandshakeMessage ??
  mongoose.model("HostHandshakeMessage", handshakeMessageSchema);

export default HostHandshakeMessage;
export { handshakeMessageSchema };
