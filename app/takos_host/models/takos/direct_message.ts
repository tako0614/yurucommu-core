import mongoose from "mongoose";
import { directMessageSchema } from "../../../takos/models/takos/direct_message.ts";
import tenantScope from "../plugins/tenant_scope.ts";

// members removed in base schema; keep tenant scoping and index
directMessageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
directMessageSchema.index({ owner: 1, id: 1, tenant_id: 1 }, { unique: true });

const HostDirectMessage = mongoose.models.HostDirectMessage ??
  mongoose.model("HostDirectMessage", directMessageSchema, "direct_messages");

export default HostDirectMessage;
export { directMessageSchema };