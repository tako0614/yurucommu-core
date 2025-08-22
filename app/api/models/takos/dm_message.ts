import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const dmMessageSchema = new mongoose.Schema({
  from: { type: String, required: true, index: true },
  to: { type: String, required: true, index: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

dmMessageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const DMMessage = mongoose.models.DMMessage ??
  mongoose.model("DMMessage", dmMessageSchema, "dm_messages");

export default DMMessage;
export { dmMessageSchema };
