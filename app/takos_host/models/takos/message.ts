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

// テナントスコープを付与して正規モデル名で登録
messageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

// 送信時に env が伝搬しないケースに備え、
// tenant_id が空のときは actor のホスト名から補完する
messageSchema.pre("save", function (next) {
  // deno-lint-ignore no-explicit-any
  const self = this as mongoose.Document & any;
  const cur = (self.tenant_id ?? "").trim();
  if (!cur) {
    const src: unknown = self.actor_id ?? self.attributedTo;
    if (typeof src === "string" && src) {
      let host = "";
      try {
        // URL 形式 (期待値)
        host = new URL(src).hostname;
      } catch {
        // フォールバック: handle 形式 name@host
        const at = src.includes("@") ? src.split("@")[1] : "";
        host = at || "";
      }
      if (host) self.tenant_id = host.toLowerCase();
    }
  }
  next();
});

const Message = mongoose.models.Message ??
  mongoose.model("Message", messageSchema, "messages");

export default Message;
export { messageSchema };

