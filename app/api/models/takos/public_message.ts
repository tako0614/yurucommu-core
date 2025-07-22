import mongoose from "mongoose";

const publicMessageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: [String], required: true },
  content: { type: String, required: true },
  mediaType: { type: String, default: "message/mls" },
  encoding: { type: String, default: "base64" },
  createdAt: { type: Date, default: Date.now },
});

const PublicMessage = mongoose.models.PublicMessage ??
  mongoose.model("PublicMessage", publicMessageSchema);

export default PublicMessage;
export { publicMessageSchema };
