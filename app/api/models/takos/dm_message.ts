import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const dmMessageSchema = new mongoose.Schema({
  from: { type: String, required: true, index: true },
  to: { type: String, required: true, index: true },
  type: { type: String, required: true },
  content: { type: String },
  attachments: { type: [mongoose.Schema.Types.Mixed] },
  createdAt: { type: Date, default: Date.now },
});

dmMessageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const DMMessage = mongoose.models.DMMessage ??
  mongoose.model("DMMessage", dmMessageSchema, "dm_messages");

export default DMMessage;
export { dmMessageSchema };
