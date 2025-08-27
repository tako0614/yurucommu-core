import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const messageSchema = new mongoose.Schema({
  _id: { type: String },
  attributedTo: { type: String, required: true },
  actor_id: { type: String, required: true, index: true },
  type: {
    type: String,
    enum: ["Note", "Image", "Video", "Audio", "Document"],
    default: "Note",
    required: true,
  },
  content: { type: String, default: "" },
  url: { type: String },
  mediaType: { type: String },
  name: { type: String, default: "" },
  extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  published: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  deleted_at: { type: Date },
  aud: {
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
  },
});

messageSchema.pre("validate", function (next) {
  if (this.type === "Note") {
    if (!this.content) this.invalidate("content", "content is required");
  } else {
    if (!this.url) this.invalidate("url", "url is required");
  }
  next();
});

messageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const Message = mongoose.models.Message ??
  mongoose.model("Message", messageSchema, "messages");

export default Message;
export { messageSchema };
